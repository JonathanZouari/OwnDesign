"""Unit tests of the YOLOv8 room scan: decoding, post-processing, colour and the real model. No network."""

import io
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app import vision

FIXTURES = Path(__file__).parent / "fixtures"
COUCH, CHAIR, PERSON, TV = 57, 56, 0, 62


def encode(img: Image.Image, fmt="JPEG", **kw) -> bytes:
    buffer = io.BytesIO()
    img.save(buffer, fmt, **kw)
    return buffer.getvalue()


def raw_output(*boxes):
    """A YOLOv8 output tensor [1, 84, 8400] with the given (cx, cy, w, h, class, score) rows in model pixels."""
    out = np.zeros((1, 84, 8400), dtype=np.float32)
    for i, (cx, cy, w, h, cls, score) in enumerate(boxes):
        out[0, :4, i] = (cx, cy, w, h)
        out[0, 4 + cls, i] = score
    return out


# ---- decode ----------------------------------------------------------------------------------------------------


def test_decode_rgb_from_png_with_alpha():
    img = vision.decode_image(encode(Image.new("RGBA", (64, 48), (10, 20, 30, 128)), "PNG"))
    assert img.mode == "RGB" and img.size == (64, 48)


@pytest.mark.parametrize("size", [(1, 1), (31, 400), (400, 31)])
def test_decode_refuses_tiny_images(size):
    with pytest.raises(vision.ImageError):
        vision.decode_image(encode(Image.new("RGB", size)))


def test_decode_refuses_corrupt_and_truncated_data():
    good = encode(Image.new("RGB", (100, 100), "red"))
    for data in (b"\xff\xd8\xff" + b"\x00" * 50, good[: len(good) // 2], b""):
        with pytest.raises(vision.ImageError):
            vision.decode_image(data)


def test_decode_refuses_decompression_bomb():
    # A tiny PNG that claims 8000 x 8000 = 64 MP, above the 40 MP ceiling.
    data = encode(Image.new("L", (8000, 8000)), "PNG", optimize=True)
    assert len(data) < 200_000
    with pytest.raises(vision.ImageError):
        vision.decode_image(data)


def test_decode_applies_exif_rotation():
    img = Image.new("RGB", (80, 40), "blue")
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90 degrees on display
    decoded = vision.decode_image(encode(img, exif=exif))
    assert decoded.size == (40, 80)


# ---- letterbox and post-processing ------------------------------------------------------------------------------


def test_letterbox_keeps_aspect_and_centres():
    tensor, scale, pad = vision.letterbox(Image.new("RGB", (1280, 640), "white"))
    assert tensor.shape == (1, 3, 640, 640) and tensor.dtype == np.float32
    assert scale == pytest.approx(0.5) and pad == (0, 160)
    assert tensor.max() <= 1.0 and tensor.min() >= 0.0


def test_postprocess_maps_back_to_normalised_original_coordinates():
    # Original 1280 x 640 -> scale 0.5, pad (0, 160). A couch filling the left half of the original.
    out = raw_output((160, 320, 320, 320, COUCH, 0.9))
    [found] = vision.postprocess(out, scale=0.5, pad=(0, 160), size=(1280, 640))
    assert found["class_id"] == COUCH and found["confidence"] == pytest.approx(0.9)
    assert found["box"] == pytest.approx([0.0, 0.0, 0.5, 1.0])


def test_postprocess_threshold_filters_and_non_interior_classes():
    out = raw_output(
        (100, 100, 50, 50, CHAIR, 0.34),  # below the 0.35 threshold
        (300, 300, 50, 50, PERSON, 0.99),  # not furniture
        (500, 500, 50, 50, TV, 0.35),  # exactly at the threshold: kept
    )
    found = vision.postprocess(out, scale=1.0, pad=(0, 0), size=(640, 640))
    assert [f["class_id"] for f in found] == [TV]


def test_postprocess_nms_merges_overlaps_of_one_class_only():
    out = raw_output(
        (200, 200, 100, 100, CHAIR, 0.9),
        (205, 205, 100, 100, CHAIR, 0.8),  # same chair: suppressed
        (205, 205, 100, 100, COUCH, 0.7),  # other class at the same place: kept
        (500, 500, 100, 100, CHAIR, 0.6),  # second chair elsewhere: kept
    )
    found = vision.postprocess(out, scale=1.0, pad=(0, 0), size=(640, 640))
    assert sorted((f["class_id"], round(f["confidence"], 1)) for f in found) == [(CHAIR, 0.6), (CHAIR, 0.9), (COUCH, 0.7)]


def test_postprocess_caps_results_and_sorts_by_confidence():
    boxes = [(20 + (i % 15) * 40, 20 + (i // 15) * 40, 10, 10, CHAIR, 0.4 + i / 100) for i in range(45)]
    found = vision.postprocess(raw_output(*boxes), scale=1.0, pad=(0, 0), size=(640, 640))
    assert len(found) == vision.MAX_DETECTIONS == 30
    scores = [f["confidence"] for f in found]
    assert scores == sorted(scores, reverse=True)


def test_postprocess_clips_boxes_to_the_image_and_drops_degenerate_ones():
    out = raw_output((0, 0, 100, 100, CHAIR, 0.9), (700, 300, 0, 0, COUCH, 0.9))
    [found] = vision.postprocess(out, scale=1.0, pad=(0, 0), size=(640, 640))
    x, y, w, h = found["box"]
    assert x == 0 and y == 0 and 0 < w <= 1 and 0 < h <= 1


def test_postprocess_empty_output():
    assert vision.postprocess(raw_output(), scale=1.0, pad=(0, 0), size=(640, 640)) == []


# ---- characterisation ---------------------------------------------------------------------------------------------


def test_dominant_color_of_a_solid_box():
    hex_, name = vision.dominant_color(Image.new("RGB", (100, 100), (200, 30, 30)), [0, 0, 1, 1])
    assert name == "red" and hex_.startswith("#") and len(hex_) == 7 and hex_ == hex_.lower()


def test_dominant_color_reads_only_the_box():
    img = Image.new("RGB", (200, 100), "white")
    img.paste((20, 20, 20), (100, 0, 200, 100))
    assert vision.dominant_color(img, [0.5, 0, 0.5, 1])[1] == "black"
    assert vision.dominant_color(img, [0, 0, 0.5, 1])[1] == "white"


def test_dominant_color_of_a_one_pixel_box_does_not_fail():
    hex_, _ = vision.dominant_color(Image.new("RGB", (640, 480), "green"), [0.5, 0.5, 0.0001, 0.0001])
    assert hex_.startswith("#")


def test_characterise_labels_categories_and_positions():
    img = Image.new("RGB", (300, 100), (120, 120, 120))
    found = [
        {"class_id": COUCH, "confidence": 0.91234, "box": [0.0, 0.2, 0.3, 0.6]},
        {"class_id": 58, "confidence": 0.5, "box": [0.7, 0.1, 0.2, 0.3]},
    ]
    sofa, plant = vision.characterise(img, found)
    assert sofa == {
        "label": "Sofa", "category": "seating", "confidence": 0.912, "box": [0.0, 0.2, 0.3, 0.6],
        "color_hex": sofa["color_hex"], "color_name": "grey", "position": "left",
    }
    assert (plant["label"], plant["category"], plant["position"]) == ("Plant", "plants", "right")


def test_every_interior_class_has_a_valid_category():
    assert vision.INTERIOR_CLASSES
    assert {c for _, c in vision.INTERIOR_CLASSES.values()} <= set(vision.CATEGORIES)
    assert PERSON not in vision.INTERIOR_CLASSES


# ---- the real model -----------------------------------------------------------------------------------------------


@pytest.fixture(scope="module")
def detector():
    return vision.load_detector()


def test_model_file_matches_its_checksum(detector):
    assert detector is vision.load_detector()  # loaded once


def test_blank_image_has_no_detections(detector):
    assert detector.detect(Image.new("RGB", (640, 480), (240, 240, 240))) == []


def test_real_room_photo_finds_furniture(detector):
    img = vision.decode_image((FIXTURES / "room.jpg").read_bytes())
    labels = {d["label"] for d in detector.detect(img)}
    assert labels & {"Sofa", "Chair", "Table", "Bed"}, labels


def test_scan_returns_characterised_detections(detector):
    result = vision.scan((FIXTURES / "room.jpg").read_bytes(), detector)
    assert result and all(set(d) == {"label", "category", "confidence", "box", "color_hex", "color_name", "position"} for d in result)
    assert all(0 <= v <= 1 for d in result for v in d["box"])


# ---- review fixes: phone photos, shapes, memory, concurrency ---------------------------------------------------


def test_decode_accepts_mpo_phone_jpegs():
    buffer = io.BytesIO()
    Image.new("RGB", (120, 90), "red").save(buffer, "MPO", save_all=True, append_images=[Image.new("RGB", (60, 45))])
    assert Image.open(io.BytesIO(buffer.getvalue())).format == "MPO"
    assert vision.decode_image(buffer.getvalue()).size == (120, 90)


@pytest.mark.parametrize("size", [(32, 60000), (60000, 32), (40, 801)])
def test_decode_refuses_extreme_aspect_ratios(size):
    with pytest.raises(vision.ImageError):
        vision.decode_image(encode(Image.new("L", size), "PNG", optimize=True))


def test_decode_accepts_the_largest_allowed_aspect_ratio_and_detection_runs():
    img = vision.decode_image(encode(Image.new("RGB", (32 * 20, 32), "white"), "PNG"))
    tensor, scale, pad = vision.letterbox(img)
    assert tensor.shape == (1, 3, 640, 640)


def test_decode_shrinks_large_photos_to_the_working_size():
    img = vision.decode_image(encode(Image.new("RGB", (4000, 3000), "white")))
    assert max(img.size) == vision.WORK_SIDE and img.size == (1280, 960)


def test_dominant_color_at_the_far_edges_does_not_fail():
    img = Image.new("RGB", (640, 480), "blue")
    for box in ([1.0, 0.5, 0.0, 0.1], [0.5, 1.0, 0.1, 0.0], [0.9999, 0.9999, 0.0001, 0.0001]):
        assert vision.dominant_color(img, box)[0].startswith("#")


def test_characterise_drops_boxes_that_round_to_nothing():
    img = Image.new("RGB", (640, 480))
    assert vision.characterise(img, [{"class_id": 56, "confidence": 0.9, "box": [0.5, 0.5, 0.00001, 0.2]}]) == []


def test_scan_is_refused_when_every_slot_is_taken(monkeypatch):
    monkeypatch.setattr(vision, "BUSY_SECONDS", 0.05)
    held = [vision._slots.acquire() for _ in range(vision.MAX_PARALLEL)]
    try:
        with pytest.raises(vision.DetectorBusy):
            vision.scan(encode(Image.new("RGB", (64, 64))), detector=None)
    finally:
        for _ in held:
            vision._slots.release()


def test_concurrent_scans_never_exceed_the_slot_limit():
    import threading
    import time
    from concurrent.futures import ThreadPoolExecutor

    lock, state = threading.Lock(), {"now": 0, "peak": 0}

    class Slow:
        def detect(self, img):
            with lock:
                state["now"] += 1
                state["peak"] = max(state["peak"], state["now"])
            time.sleep(0.05)
            with lock:
                state["now"] -= 1
            return []

    data = encode(Image.new("RGB", (64, 64)))
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(lambda _: vision.scan(data, Slow()), range(8)))
    assert results == [[]] * 8 and state["peak"] <= vision.MAX_PARALLEL


def test_concurrent_first_loads_build_one_session():
    from concurrent.futures import ThreadPoolExecutor

    vision._load.cache_clear()
    with ThreadPoolExecutor(4) as pool:
        loaded = list(pool.map(lambda _: vision.load_detector(), range(4)))
    assert all(d is loaded[0] for d in loaded)


def test_an_altered_model_file_is_refused(monkeypatch):
    from fastapi import HTTPException

    vision._load.cache_clear()
    monkeypatch.setattr(vision, "MODEL_SHA256", "0" * 64)
    try:
        with pytest.raises(HTTPException) as error:
            vision.get_detector()
        assert error.value.status_code == 503
    finally:
        vision._load.cache_clear()
