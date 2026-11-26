"""Room scan: find the furniture and objects in a photo with YOLOv8n (ONNX, CPU) and characterise each one.

The model is Ultralytics YOLOv8n trained on COCO, exported to ONNX (`backend/models/README.md`); it is AGPL-3.0.
Only COCO classes that belong in a home are kept. Each one gets a label, a category, its dominant colour and
its position in the photo. Nothing here touches the database: the route decides what to store.
"""

import hashlib
import io
import threading
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from app.schemas import ROOM_ITEM_CATEGORIES

MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "yolov8n.onnx"
MODEL_SHA256 = "8c8b6affc1f9a6482414338d996cc6799983d8da05078b7c44f16e3a3c5caa5e"

INPUT_SIZE = 640
CONFIDENCE = np.float32(0.35)
IOU = 0.45
MAX_DETECTIONS = 30
MAX_PIXELS = 40_000_000
MIN_SIDE = 32
MAX_PARALLEL = 2
BUSY_SECONDS = 10

CATEGORIES = ROOM_ITEM_CATEGORIES

# COCO class id -> (label, category). Everything else (people, vehicles, animals, food...) is dropped.
INTERIOR_CLASSES = {
    13: ("Bench", "seating"),
    28: ("Suitcase", "storage"),
    56: ("Chair", "seating"),
    57: ("Sofa", "seating"),
    58: ("Plant", "plants"),
    59: ("Bed", "sleeping"),
    60: ("Table", "tables"),
    61: ("Toilet", "bathroom"),
    62: ("TV", "electronics"),
    63: ("Laptop", "electronics"),
    68: ("Microwave", "appliances"),
    69: ("Oven", "appliances"),
    70: ("Toaster", "appliances"),
    71: ("Sink", "bathroom"),
    72: ("Refrigerator", "appliances"),
    73: ("Books", "decor"),
    74: ("Clock", "decor"),
    75: ("Vase", "decor"),
}

# Names for the dominant colour; the nearest one in RGB wins.
PALETTE = {
    "white": (245, 245, 242), "black": (25, 25, 25), "grey": (128, 128, 128), "beige": (222, 205, 175),
    "brown": (120, 80, 50), "red": (190, 40, 40), "orange": (230, 130, 40), "yellow": (230, 205, 70),
    "green": (60, 135, 70), "blue": (50, 90, 180), "purple": (120, 65, 150), "pink": (230, 155, 180),
}


class ImageError(ValueError):
    """The bytes are not an image this scan can read."""


class DetectorBusy(RuntimeError):
    """Too many scans are running; try again shortly."""


def decode_image(data: bytes) -> Image.Image:
    """An upright RGB image, or ImageError. The size is checked from the header before any pixel is decoded."""
    try:
        img = Image.open(io.BytesIO(data))
        if img.format not in {"JPEG", "PNG", "WEBP"}:
            raise ImageError("unsupported image format")
        if img.width * img.height > MAX_PIXELS:
            raise ImageError("the image has too many pixels")
        img.load()
        img = ImageOps.exif_transpose(img).convert("RGB")
    except ImageError:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError) as error:
        raise ImageError("the image could not be read") from error
    if min(img.size) < MIN_SIDE:
        raise ImageError("the image is too small")
    return img


def letterbox(img: Image.Image) -> tuple[np.ndarray, float, tuple[int, int]]:
    """Scaled to fit 640 x 640 on grey, as YOLOv8 was trained. Returns the NCHW tensor, the scale and the padding."""
    scale = min(INPUT_SIZE / img.width, INPUT_SIZE / img.height)
    width, height = round(img.width * scale), round(img.height * scale)
    pad = ((INPUT_SIZE - width) // 2, (INPUT_SIZE - height) // 2)
    canvas = Image.new("RGB", (INPUT_SIZE, INPUT_SIZE), (114, 114, 114))
    canvas.paste(img.resize((width, height), Image.Resampling.BILINEAR), pad)
    tensor = np.asarray(canvas, dtype=np.float32).transpose(2, 0, 1)[None] / 255.0
    return np.ascontiguousarray(tensor), scale, pad


def _nms(boxes: np.ndarray, scores: np.ndarray) -> list[int]:
    order = scores.argsort()[::-1]
    keep = []
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    while order.size:
        best, rest = order[0], order[1:]
        keep.append(int(best))
        x1 = np.maximum(boxes[best, 0], boxes[rest, 0])
        y1 = np.maximum(boxes[best, 1], boxes[rest, 1])
        x2 = np.minimum(boxes[best, 2], boxes[rest, 2])
        y2 = np.minimum(boxes[best, 3], boxes[rest, 3])
        overlap = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
        iou = overlap / (areas[best] + areas[rest] - overlap + 1e-9)
        order = rest[iou <= IOU]
    return keep


def postprocess(output: np.ndarray, scale: float, pad: tuple[int, int], size: tuple[int, int]) -> list[dict]:
    """YOLOv8 output [1, 84, N] -> interior detections with boxes [x, y, w, h] normalised to the original image."""
    rows = output[0].T  # N x 84: cx, cy, w, h, 80 class scores
    class_ids = rows[:, 4:].argmax(axis=1)
    scores = rows[np.arange(len(rows)), 4 + class_ids]
    mask = (scores >= CONFIDENCE) & np.isin(class_ids, list(INTERIOR_CLASSES))
    rows, class_ids, scores = rows[mask], class_ids[mask], scores[mask]
    if not len(rows):
        return []

    width, height = size
    cx, cy, w, h = rows[:, 0], rows[:, 1], rows[:, 2], rows[:, 3]
    boxes = np.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], axis=1)
    boxes[:, [0, 2]] = ((boxes[:, [0, 2]] - pad[0]) / scale).clip(0, width)
    boxes[:, [1, 3]] = ((boxes[:, [1, 3]] - pad[1]) / scale).clip(0, height)
    real = (boxes[:, 2] - boxes[:, 0] >= 1) & (boxes[:, 3] - boxes[:, 1] >= 1)
    boxes, class_ids, scores = boxes[real], class_ids[real], scores[real]

    # Per-class NMS in one pass: shifting each class far apart means boxes of different classes never overlap.
    shifted = boxes + (class_ids * (max(width, height) + 1))[:, None]
    keep = _nms(shifted, scores)[:MAX_DETECTIONS]
    return [
        {
            "class_id": int(class_ids[i]),
            "confidence": float(scores[i]),
            "box": [
                float(boxes[i, 0] / width), float(boxes[i, 1] / height),
                float((boxes[i, 2] - boxes[i, 0]) / width), float((boxes[i, 3] - boxes[i, 1]) / height),
            ],
        }
        for i in keep
    ]


def dominant_color(img: Image.Image, box: list[float]) -> tuple[str, str]:
    """The most common colour in the middle 60% of the box (edges are usually background): hex and a name."""
    x, y, w, h = box
    left, top = (x + w * 0.2) * img.width, (y + h * 0.2) * img.height
    right, bottom = (x + w * 0.8) * img.width, (y + h * 0.8) * img.height
    left, top = int(left), int(top)
    right, bottom = max(int(round(right)), left + 1), max(int(round(bottom)), top + 1)
    crop = img.crop((left, top, min(right, img.width), min(bottom, img.height)))
    crop.thumbnail((48, 48))
    quantized = crop.quantize(colors=4)
    palette = quantized.getpalette() or []
    _, index = max(quantized.getcolors())
    rgb = tuple(palette[index * 3 : index * 3 + 3])
    name = min(PALETTE, key=lambda n: sum((a - b) ** 2 for a, b in zip(rgb, PALETTE[n])))
    return "#{:02x}{:02x}{:02x}".format(*rgb), name


def characterise(img: Image.Image, detections: list[dict]) -> list[dict]:
    result = []
    for found in detections:
        label, category = INTERIOR_CLASSES[found["class_id"]]
        box = [round(v, 4) for v in found["box"]]
        centre = box[0] + box[2] / 2
        color_hex, color_name = dominant_color(img, box)
        result.append({
            "label": label,
            "category": category,
            "confidence": round(found["confidence"], 3),
            "box": box,
            "color_hex": color_hex,
            "color_name": color_name,
            "position": "left" if centre < 1 / 3 else "right" if centre > 2 / 3 else "centre",
        })
    return result


class Detector:
    def __init__(self, session):
        self._session = session
        self._input = session.get_inputs()[0].name
        self._slots = threading.BoundedSemaphore(MAX_PARALLEL)

    def detect(self, img: Image.Image) -> list[dict]:
        tensor, scale, pad = letterbox(img)
        if not self._slots.acquire(timeout=BUSY_SECONDS):
            raise DetectorBusy("the room scanner is busy")
        try:
            output = self._session.run(None, {self._input: tensor})[0]
        finally:
            self._slots.release()
        return characterise(img, postprocess(output, scale, pad, img.size))


@lru_cache(maxsize=1)
def load_detector() -> Detector:
    """Loads the model once per process after checking it is the exact file recorded in models/README.md."""
    import onnxruntime

    data = MODEL_PATH.read_bytes()
    if hashlib.sha256(data).hexdigest() != MODEL_SHA256:
        raise RuntimeError(f"{MODEL_PATH.name} does not match its recorded checksum")
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = 2
    options.log_severity_level = 3
    return Detector(onnxruntime.InferenceSession(data, options, providers=["CPUExecutionProvider"]))


def get_detector() -> Detector:
    """A FastAPI dependency, so tests can replace the model with a fake."""
    return load_detector()


def scan(data: bytes, detector: Detector) -> list[dict]:
    return detector.detect(decode_image(data))
