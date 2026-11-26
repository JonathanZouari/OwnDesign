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


def test_postprocess_drops_boxes_that_are_not_numbers():
    found = M.postprocess(boxes_for([(float("nan"), 0.5, 0.2, 0.2)]), logits_for([(COUCH, 0.9)]))
    assert found == []


def test_transparent_png_is_put_on_white():
    out = io.BytesIO()
    Image.new("RGBA", (8, 8), (0, 0, 0, 0)).save(out, "PNG")
    assert M.load_image(out.getvalue()).getpixel((0, 0)) == (255, 255, 255)


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


@pytest.fixture
def fresh(monkeypatch, tmp_path):
    """An empty private cache and no detector loaded yet."""
    cache = tmp_path / "models"
    monkeypatch.setattr(M, "CACHE_DIR", cache)
    monkeypatch.setattr(M, "_detector", None)
    monkeypatch.setattr(M, "_failed_at", None)
    return cache


def pin(monkeypatch, data: bytes):
    monkeypatch.setattr(M, "MODEL_SHA256", hashlib.sha256(data).hexdigest())


def test_model_with_the_wrong_hash_is_refused(monkeypatch, fresh):
    monkeypatch.setattr(M, "_download", lambda: b"tampered model")
    with pytest.raises(M.ModelUnavailable):
        M.load_detector()
    assert not (fresh / M.MODEL_OBJECT).exists()


def test_session_is_built_from_the_checked_bytes(monkeypatch, fresh):
    data = b"pretend model"
    pin(monkeypatch, data)
    monkeypatch.setattr(M, "_download", lambda: data)
    seen = []
    monkeypatch.setattr(M, "_session", lambda model: seen.append(model) or FakeSession(boxes_for([]), logits_for([])))
    M.load_detector()
    assert seen == [data]  # bytes, never a path that could be swapped after the check
    assert (fresh / M.MODEL_OBJECT).read_bytes() == data
    assert oct(fresh.stat().st_mode & 0o777) == "0o700"


def test_cached_model_with_the_right_hash_is_not_downloaded_again(monkeypatch, fresh):
    data = b"pretend model"
    pin(monkeypatch, data)
    fresh.mkdir(mode=0o700)
    (fresh / M.MODEL_OBJECT).write_bytes(data)
    monkeypatch.setattr(M, "_download", lambda: pytest.fail("should use the cached file"))
    assert M._model_bytes() == data


def test_corrupted_cache_is_replaced(monkeypatch, fresh):
    good = b"good model"
    pin(monkeypatch, good)
    fresh.mkdir(mode=0o700)
    (fresh / M.MODEL_OBJECT).write_bytes(b"half a download")
    monkeypatch.setattr(M, "_download", lambda: good)
    assert M._model_bytes() == good
    assert (fresh / M.MODEL_OBJECT).read_bytes() == good


@pytest.mark.parametrize("unsafe", ["open to others", "symlink"])
def test_unsafe_cache_folder_is_not_used(monkeypatch, fresh, tmp_path, unsafe):
    data = b"pretend model"
    pin(monkeypatch, data)
    if unsafe == "symlink":
        target = tmp_path / "elsewhere"
        target.mkdir(mode=0o700)
        fresh.symlink_to(target)
    else:
        fresh.mkdir()
        fresh.chmod(0o777)
    monkeypatch.setattr(M, "_download", lambda: data)
    assert M._private_cache() is None
    assert M._model_bytes() == data  # still works, from memory
    assert not any(p.name == M.MODEL_OBJECT for p in tmp_path.rglob("*"))


def test_missing_model_is_not_downloaded_again_at_once(monkeypatch, fresh):
    calls = []

    def missing():
        calls.append(1)
        raise RuntimeError("Object not found")

    monkeypatch.setattr(M, "_download", missing)
    for _ in range(3):
        with pytest.raises(M.ModelUnavailable):
            M.load_detector()
    assert len(calls) == 1
    monkeypatch.setattr(M, "_failed_at", M._failed_at - M.RETRY_AFTER_FAILURE - 1)  # a minute later it tries again
    with pytest.raises(M.ModelUnavailable):
        M.load_detector()
    assert len(calls) == 2


def test_only_uploadable_formats_are_decoded():
    with pytest.raises(M.ImageError):
        M.load_image(image_bytes(fmt="GIF"))


def test_large_jpeg_is_decoded_at_a_reduced_size():
    image = M.load_image(image_bytes((4000, 3000), fmt="JPEG"))
    assert max(image.size) <= 2000 and image.size[0] / image.size[1] == pytest.approx(4 / 3, rel=0.01)


# ---- the real model ----------------------------------------------------------------------------------------------


@pytest.mark.skipif(not (M.CACHE_DIR / M.MODEL_OBJECT).exists(), reason="detection model not downloaded on this machine")
def test_real_model_finds_living_room_furniture(monkeypatch):
    monkeypatch.setattr(M, "_detector", None)
    detector = M.load_detector()
    found = {d.item_class for d in detector.detect((STITCH / "render-concept-a.jpg").read_bytes())}
    assert {"couch", "chair", "dining table"} <= found


def test_unloadable_model_is_unavailable_and_not_retried_at_once(monkeypatch, fresh):
    data = b"not an onnx file"
    pin(monkeypatch, data)
    calls = []
    monkeypatch.setattr(M, "_download", lambda: calls.append(1) or data)
    for _ in range(2):
        with pytest.raises(M.ModelUnavailable):
            M.load_detector()
    assert len(calls) == 1


def test_first_load_right_after_the_machine_starts(monkeypatch, fresh):
    """time.monotonic() counts from boot: on a machine up for under a minute the first load must still run."""
    data = b"pretend model"
    pin(monkeypatch, data)
    monkeypatch.setattr(M.time, "monotonic", lambda: 5.0)
    monkeypatch.setattr(M, "_download", lambda: data)
    monkeypatch.setattr(M, "_session", lambda model: FakeSession(boxes_for([]), logits_for([])))
    assert M.load_detector() is not None
