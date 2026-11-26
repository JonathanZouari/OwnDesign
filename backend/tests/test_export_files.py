"""PDF, PNG and DXF output, checked by reading the files back. No database."""

import copy
import io
from datetime import date

import pytest
from PIL import Image
from pypdf import PdfReader

from app.exports import layout as L
from app.exports.pdf import ExportInfo, render_pdf
from app.exports.png import render_png
from app.schemas import Geometry
from tests.test_export_layout import empty, room
from tests.test_geometry import VALID

INFO = ExportInfo(project_name="Flat A", version_no=3, version_label="After the meeting", exported_on=date(2026, 11, 26))
NOTICE = "Conceptual plan only. Not for construction."
SCALE_NOTICE = "Fit to page. Scale not guaranteed."


def plan(mutate=None) -> Geometry:
    raw = copy.deepcopy(VALID)
    if mutate:
        mutate(raw)
    return Geometry.model_validate(raw)


def two_rooms(raw):
    empty(raw)
    room(raw, "r1", "Living room", 0, 0, 500, 400)
    room(raw, "r2", "Bedroom", 500, 0, 350, 400)
    raw["openings"] = [{"id": "d", "wallId": "r1w0", "type": "door", "offset": 60, "width": 90},
                       {"id": "w", "wallId": "r2w2", "type": "window", "offset": 100, "width": 120}]
    raw["furniture"] = [{"id": "f", "type": "sofa", "x": 250, "y": 300, "w": 220, "d": 90, "rotation": 30}]


def pdf_text(content: bytes) -> tuple[PdfReader, str]:
    reader = PdfReader(io.BytesIO(content))
    return reader, " ".join(page.extract_text() for page in reader.pages)


# ---- PDF -------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("paper", ["a4", "a3"])
def test_pdf_is_one_page_of_the_chosen_paper(paper):
    reader, _ = pdf_text(render_pdf(plan(two_rooms), INFO, paper))
    assert len(reader.pages) == 1
    box = reader.pages[0].mediabox
    expected = sorted(side * L.PT_PER_MM for side in L.PAPER_MM[paper])
    assert sorted([float(box.width), float(box.height)]) == pytest.approx(expected, abs=0.5)


def test_pdf_orientation_follows_the_plan():
    wide = render_pdf(plan(lambda raw: (empty(raw), room(raw, "r", "R", 0, 0, 2000, 400))), INFO, "a4")
    tall = render_pdf(plan(lambda raw: (empty(raw), room(raw, "r", "R", 0, 0, 400, 2000))), INFO, "a4")
    wide_box = PdfReader(io.BytesIO(wide)).pages[0].mediabox
    tall_box = PdfReader(io.BytesIO(tall)).pages[0].mediabox
    assert wide_box.width > wide_box.height
    assert tall_box.height > tall_box.width


def test_pdf_has_labels_measurements_identification_and_notices():
    _, text = pdf_text(render_pdf(plan(two_rooms), INFO, "a4"))
    for expected in ("Living room", "Bedroom", "~ 20.0 m²", "~ 14.0 m²", "Room areas are approximate.", "5.00 m", "3.50 m", "4.00 m",
                     "Flat A", "Version 3", "After the meeting", "2026-11-26", NOTICE, SCALE_NOTICE):
        assert expected in text, expected


def test_pdf_keeps_user_text_as_text():
    def mutate(raw):
        two_rooms(raw)
        raw["rooms"][0]["name"] = "<b>Hall</b> & {x}"
    _, text = pdf_text(render_pdf(plan(mutate), INFO, "a4"))
    assert "<b>Hall</b> & {x}" in text


def test_pdf_draws_hebrew_room_and_project_names():
    def mutate(raw):
        two_rooms(raw)
        raw["rooms"][0]["name"] = "סלון 2"
    info = ExportInfo("דירה ברחוב הרצל", 1, "", date(2026, 11, 26))
    _, text = pdf_text(render_pdf(plan(mutate), info, "a4"))
    assert "סלון" in text and "הרצל" in text


def test_pdf_fits_very_long_names_on_the_page():
    info = ExportInfo("P" * 80, 500, "L" * 80, date(2026, 11, 26))
    def mutate(raw):
        two_rooms(raw)
        raw["rooms"][0]["name"] = "N" * 80
    reader, text = pdf_text(render_pdf(plan(mutate), info, "a4"))
    assert len(reader.pages) == 1 and "Version 500" in text


def test_pdf_of_an_empty_plan_still_identifies_it():
    _, text = pdf_text(render_pdf(plan(empty), INFO, "a4"))
    assert "Blank canvas" in text and NOTICE in text


def test_pdf_of_the_largest_allowed_plan():
    def mutate(raw):
        empty(raw)
        for i in range(100):
            room(raw, f"r{i}", f"Room {i}", (i % 10) * 400, (i // 10) * 400, 400, 400)
        raw["walls"] += [{"id": f"p{i}", "x1": i * 4, "y1": 5000, "x2": i * 4, "y2": 5100, "thickness": 10,
                          "kind": "partition"} for i in range(600)]
        raw["openings"] = [{"id": f"o{i}", "wallId": f"p{i}", "type": "window", "offset": 10, "width": 50} for i in range(600)]
        raw["furniture"] = [{"id": f"f{i}", "type": "sofa", "x": (i % 40) * 100, "y": 6000 + (i // 40) * 100,
                             "w": 80, "d": 60, "rotation": i % 360} for i in range(1000)]
    geometry = plan(mutate)
    assert len(geometry.walls) == 1000
    reader, text = pdf_text(render_pdf(geometry, INFO, "a3"))
    assert len(reader.pages) == 1 and "Room 99" in text


# ---- PNG -------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("paper, portrait", [("a4", (2480, 3508)), ("a3", (3508, 4961))])
def test_png_is_the_paper_size_at_300_dpi_on_white(paper, portrait):
    image = Image.open(io.BytesIO(render_png(plan(lambda raw: (empty(raw), room(raw, "r", "R", 0, 0, 400, 900))), INFO, paper)))
    assert image.size == portrait
    assert image.info["dpi"] == pytest.approx((300, 300), abs=0.01)
    assert image.mode == "RGB"
    assert image.getpixel((0, 0)) == (255, 255, 255)
    landscape = Image.open(io.BytesIO(render_png(plan(lambda raw: (empty(raw), room(raw, "r", "R", 0, 0, 900, 400))), INFO, paper)))
    assert landscape.size == portrait[::-1]


def test_png_contains_the_drawing():
    image = Image.open(io.BytesIO(render_png(plan(two_rooms), INFO, "a4"))).convert("L")
    dark = sum(image.resize((248, 351)).histogram()[:100])
    assert dark > 200  # walls and text, not a blank page
