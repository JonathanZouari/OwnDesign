"""Item detection: image loading, pre- and post-processing, model download checks. No database.

The real model runs only in test_real_model_finds_living_room_furniture, and only when it is available locally.
"""

import hashlib
import io
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.detection import model as M
from app.detection.classes import CLASSES

STITCH = Path(__file__).resolve().parents[2] / "design" / "stitch"
COUCH, PERSON, CHAIR = 63, 1, 62


def image_bytes(size=(64, 48), colour="white", fmt="PNG", exif_orientation=None) -> bytes:
    out = io.BytesIO()
    image = Image.new("RGB", size, colour)
    if exif_orientation:
        exif = Image.Exif()
        exif[0x0112] = exif_orientation
        image.save(out, fmt, exif=exif)
    else:
        image.save(out, fmt)
    return out.getvalue()


def logits_for(entries, queries=300, classes=91):
    """Model output where query i has class entries[i][0] at probability entries[i][1]; all else near zero."""
    logits = np.full((queries, classes), -20.0, dtype=np.float32)
    for i, (cls, probability) in enumerate(entries):
        logits[i, cls] = np.log(probability / (1 - probability))
    return logits


def boxes_for(entries, queries=300):
    boxes = np.full((queries, 4), 0.5, dtype=np.float32)
    for i, box in enumerate(entries):
        boxes[i] = box
    return boxes


# ---- classes ---------------------------------------------------------------------------------------------------


def test_only_home_classes_with_catalog_types_from_the_editor():
    names = {c.item_class for c in CLASSES.values()}
    assert names == {"couch", "chair", "bed", "dining table", "tv", "toilet", "sink", "refrigerator", "oven",
                     "microwave", "potted plant", "vase", "clock", "book"}
    catalog = Path(__file__).resolve().parents[2] / "frontend" / "js" / "catalog.js"
    for item in CLASSES.values():
        if item.catalog_type:
            assert f'type: "{item.catalog_type}"' in catalog.read_text()
    assert CLASSES[COUCH].label == "Sofa" and CLASSES[COUCH].catalog_type == "sofa"
    assert PERSON not in CLASSES


def test_classes_match_the_database_check():
    sql = (Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "20261126120000_owned_items.sql").read_text()
    for item in CLASSES.values():
        assert f"'{item.item_class}'" in sql


# ---- image loading ---------------------------------------------------------------------------------------------


@pytest.mark.parametrize("fmt", ["PNG", "JPEG", "WEBP"])
def test_loads_supported_images_as_rgb(fmt):
    image = M.load_image(image_bytes(fmt=fmt))
    assert image.mode == "RGB" and image.size == (64, 48)


def test_phone_photo_rotation_is_applied():
    # EXIF orientation 6: the camera was turned; the photo is shown rotated 90 degrees.
    assert M.load_image(image_bytes((64, 48), fmt="JPEG", exif_orientation=6)).size == (48, 64)


@pytest.mark.parametrize("data", [b"", b"not an image", image_bytes()[:40]])
def test_unreadable_image_is_refused(data):
    with pytest.raises(M.ImageError):
        M.load_image(data)


def test_oversized_image_is_refused_before_decoding(monkeypatch):
    monkeypatch.setattr(M, "MAX_PIXELS", 1000)
    with pytest.raises(M.ImageError):
        M.load_image(image_bytes((64, 48)))


# ---- pre- and post-processing ----------------------------------------------------------------------------------


def test_preprocess_resizes_and_normalises():
    tensor = M.preprocess(Image.new("RGB", (1376, 768), "white"))
    assert tensor.shape == (1, 3, 512, 512) and tensor.dtype == np.float32
    expected = (1 - np.array(M.MEAN)) / np.array(M.STD)
    assert tensor[0, :, 0, 0] == pytest.approx(expected, rel=1e-5)


def test_postprocess_keeps_home_classes_above_the_threshold():
    logits = logits_for([(COUCH, 0.93), (PERSON, 0.99), (CHAIR, 0.40), (CHAIR, 0.39)])
    boxes = boxes_for([(0.5, 0.5, 0.4, 0.2), (0.5, 0.5, 0.1, 0.1), (0.2, 0.3, 0.1, 0.2), (0.7, 0.7, 0.1, 0.1)])
    found = M.postprocess(boxes, logits)
    assert [(d.item_class, round(d.confidence, 2)) for d in found] == [("couch", 0.93), ("chair", 0.4)]
    sofa = found[0]
    assert sofa.label == "Sofa" and sofa.catalog_type == "sofa"
    # Centre-based box from the model becomes a top-left box, relative to the image.
    assert sofa.box == pytest.approx((0.3, 0.4, 0.4, 0.2))


def test_postprocess_clamps_boxes_to_the_image():
    found = M.postprocess(boxes_for([(0.02, 0.98, 0.2, 0.2)]), logits_for([(COUCH, 0.9)]))
    x, y, w, h = found[0].box
    assert (x, y) == pytest.approx((0.0, 0.88)) and x + w <= 1 and y + h <= 1 and w > 0 and h > 0


def test_postprocess_of_nothing_is_empty():
    assert M.postprocess(boxes_for([]), logits_for([])) == []


class FakeSession:
    def __init__(self, boxes, logits):
        self.output = (boxes[None], logits[None])
        self.seen = None

    def get_inputs(self):
        return [type("Input", (), {"name": "input"})()]

    def run(self, _, feeds):
        self.seen = feeds["input"]
        return self.output


def test_detector_runs_the_session_on_the_prepared_image():
    session = FakeSession(boxes_for([(0.5, 0.5, 0.2, 0.2)]), logits_for([(COUCH, 0.8)]))
    found = M.Detector(session).detect(image_bytes())
    assert session.seen.shape == (1, 3, 512, 512)
    assert [d.item_class for d in found] == ["couch"]


# ---- model file ------------------------------------------------------------------------------------------------


def test_model_with_the_wrong_hash_is_refused(monkeypatch, tmp_path):
    monkeypatch.setattr(M, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(M, "_download", lambda: b"tampered model")
    with pytest.raises(M.ModelUnavailable):
        M.load_detector()
    assert not (tmp_path / M.MODEL_OBJECT).exists()


def test_cached_model_with_the_right_hash_is_not_downloaded_again(monkeypatch, tmp_path):
    data = b"pretend model"
    monkeypatch.setattr(M, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(M, "MODEL_SHA256", hashlib.sha256(data).hexdigest())
    (tmp_path / M.MODEL_OBJECT).write_bytes(data)
    monkeypatch.setattr(M, "_download", lambda: pytest.fail("should use the cached file"))
    monkeypatch.setattr(M, "_session", lambda path: ("session for", path))
    assert M._model_path() == tmp_path / M.MODEL_OBJECT


def test_corrupted_cache_is_replaced(monkeypatch, tmp_path):
    good = b"good model"
    monkeypatch.setattr(M, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(M, "MODEL_SHA256", hashlib.sha256(good).hexdigest())
    (tmp_path / M.MODEL_OBJECT).write_bytes(b"half a download")
    monkeypatch.setattr(M, "_download", lambda: good)
    assert M._model_path().read_bytes() == good


def test_missing_model_is_unavailable(monkeypatch, tmp_path):
    monkeypatch.setattr(M, "CACHE_DIR", tmp_path)

    def missing():
        raise RuntimeError("Object not found")

    monkeypatch.setattr(M, "_download", missing)
    with pytest.raises(M.ModelUnavailable):
        M.load_detector()


# ---- the real model ----------------------------------------------------------------------------------------------


@pytest.mark.skipif(not (M.CACHE_DIR / M.MODEL_OBJECT).exists(), reason="detection model not downloaded on this machine")
def test_real_model_finds_living_room_furniture():
    detector = M.load_detector()
    found = {d.item_class for d in detector.detect((STITCH / "render-concept-a.jpg").read_bytes())}
    assert {"couch", "chair", "dining table"} <= found
