"""RF-DETR Small (Apache 2.0), int8 ONNX, run with ONNX Runtime on CPU (specs/item-detection.md).

The model file lives in the private `models` bucket (uploaded by scripts/publish_model.py). It is downloaded on
first use, accepted only if its SHA-256 matches MODEL_SHA256, and kept in CACHE_DIR. Photos never leave the server.
"""

import hashlib
import io
import os
import stat
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from app.detection.classes import CLASSES

BUCKET = "models"
MODEL_OBJECT = "rfdetr-small-int8.onnx"
MODEL_SHA256 = "2ff4bf2d1f28aba55731e1d3fdbfa8d2880976417c1bcba484106f1c8a6cac1b"  # rfdetr 1.12.1, onnxruntime 1.32 int8
CACHE_DIR = Path(tempfile.gettempdir()) / "atelier-models"

INPUT_SIZE = 512
MEAN = (0.485, 0.456, 0.406)  # ImageNet, as RF-DETR was trained
STD = (0.229, 0.224, 0.225)
MIN_CONFIDENCE = 0.4  # decided in the spec; the browser marks results below 0.6 as "Not sure"
MAX_PIXELS = 40_000_000  # a 5 MB file can still declare a huge size; refuse before decoding


class ImageError(ValueError):
    """The image cannot be read or is too large."""


class ModelUnavailable(RuntimeError):
    """The model file is missing or not the pinned one."""


@dataclass(frozen=True)
class Detection:
    item_class: str
    label: str
    catalog_type: str | None
    confidence: float
    box: tuple[float, float, float, float]  # left, top, width, height, relative to the image (0..1)


def load_image(data: bytes) -> Image.Image:
    try:
        try:
            image = Image.open(io.BytesIO(data), formats=["JPEG", "PNG", "WEBP"])  # what uploads accept
        except Image.DecompressionBombError:
            raise ImageError("This image is too large to analyse") from None
        width, height = image.size
        if width * height > MAX_PIXELS:
            raise ImageError("This image is too large to analyse")
        image.draft("RGB", (2 * INPUT_SIZE, 2 * INPUT_SIZE))  # JPEG only: decode at a reduced size, the model needs 512
        image.load()
        image = ImageOps.exif_transpose(image)  # phone photos store their rotation separately
    except ImageError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
        raise ImageError("This image cannot be read") from error
    if image.mode in ("RGBA", "LA", "PA") or (image.mode == "P" and "transparency" in image.info):
        background = Image.new("RGB", image.size, "white")  # transparent parts as white paper, not black
        background.paste(image.convert("RGBA"), mask=image.convert("RGBA").getchannel("A"))
        return background
    return image.convert("RGB")


def preprocess(image: Image.Image) -> np.ndarray:
    pixels = np.asarray(image.resize((INPUT_SIZE, INPUT_SIZE), Image.Resampling.BILINEAR), dtype=np.float32) / 255.0
    pixels = (pixels - np.array(MEAN, dtype=np.float32)) / np.array(STD, dtype=np.float32)
    return pixels.transpose(2, 0, 1)[None].astype(np.float32)


def postprocess(boxes: np.ndarray, logits: np.ndarray, threshold: float = MIN_CONFIDENCE) -> list[Detection]:
    """boxes: (queries, 4) centre x, centre y, width, height, relative. logits: (queries, classes).

    Each query keeps only its strongest class (not RF-DETR's top-k over every class), so a query that scores a
    person above a sofa is dropped rather than reported as a weaker sofa.
    """
    probabilities = 1 / (1 + np.exp(-logits.astype(np.float64)))
    found = []
    for query in range(probabilities.shape[0]):
        class_id = int(probabilities[query].argmax())
        confidence = float(probabilities[query, class_id])
        item = CLASSES.get(class_id)
        if item is None or confidence < threshold:
            continue
        cx, cy, w, h = (float(v) for v in boxes[query])
        if not all(np.isfinite((cx, cy, w, h))):
            continue
        left, top = max(0.0, cx - w / 2), max(0.0, cy - h / 2)
        right, bottom = min(1.0, cx + w / 2), min(1.0, cy + h / 2)
        if right <= left or bottom <= top:
            continue
        found.append(Detection(item.item_class, item.label, item.catalog_type, round(confidence, 3),
                               (left, top, right - left, bottom - top)))
    return sorted(found, key=lambda d: -d.confidence)


class Detector:
    def __init__(self, session):
        self.session = session
        self.input_name = session.get_inputs()[0].name

    def detect(self, data: bytes) -> list[Detection]:
        tensor = preprocess(load_image(data))
        boxes, logits = self.session.run(None, {self.input_name: tensor})  # ONNX Runtime's run is thread-safe
        return postprocess(boxes[0], logits[0])


# ---- model file --------------------------------------------------------------------------------------------------
# The bytes are hashed and the session is built from those same bytes, so a file swapped on disk after the check can
# never be loaded. The cache lives in a folder only this user owns, written through a fresh temporary file.

RETRY_AFTER_FAILURE = 60  # seconds before a missing or wrong model is downloaded again

_lock = threading.Lock()
_detector: Detector | None = None
_failed_at = 0.0


def _download() -> bytes:
    from app.db import service

    return service().storage.from_(BUCKET).download(MODEL_OBJECT)


def _private_cache() -> Path | None:
    """The cache folder, or None when it is not safely ours (then the model is only kept in memory)."""
    try:
        CACHE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = os.lstat(CACHE_DIR)
    except OSError:
        return None
    if stat.S_ISLNK(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        return None
    return CACHE_DIR


def _model_bytes() -> bytes:
    cache = _private_cache()
    path = cache / MODEL_OBJECT if cache else None
    if path and path.is_file() and not path.is_symlink():
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() == MODEL_SHA256:
            return data
    try:
        data = _download()
    except Exception as error:
        raise ModelUnavailable("The detection model could not be downloaded") from error
    if hashlib.sha256(data).hexdigest() != MODEL_SHA256:
        raise ModelUnavailable("The detection model is not the pinned file")
    if cache:
        handle, partial = tempfile.mkstemp(dir=cache, suffix=".part")  # O_EXCL, never follows a planted link
        with os.fdopen(handle, "wb") as out:
            out.write(data)
        os.replace(partial, path)
    return data


def _session(model: bytes):
    import onnxruntime

    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = 2  # leave cores for the other requests
    return onnxruntime.InferenceSession(model, options, providers=["CPUExecutionProvider"])


def load_detector() -> Detector:
    """The shared detector, loaded once. Raises ModelUnavailable if the model file is missing or wrong."""
    global _detector, _failed_at
    with _lock:
        if _detector is None:
            if time.monotonic() - _failed_at < RETRY_AFTER_FAILURE:
                raise ModelUnavailable("The detection model failed to load a moment ago")
            try:
                model = _model_bytes()
                try:
                    _detector = Detector(_session(model))
                except Exception as error:  # a file ONNX Runtime cannot load is as unusable as a missing one
                    raise ModelUnavailable("The detection model could not be loaded") from error
            except ModelUnavailable:
                _failed_at = time.monotonic()
                raise
        return _detector
