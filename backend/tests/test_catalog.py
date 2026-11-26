"""The catalog is shown to users as is: Hebrew text, while ids, surfaces and colors stay stable."""

import re

from app.catalog import MATERIALS, STYLES, SURFACES

HEBREW = re.compile(r"[֐-׿]")
LATIN = re.compile(r"[A-Za-z]")


def hebrew_only(text: str) -> bool:
    return bool(HEBREW.search(text)) and not LATIN.search(text)


def test_every_style_has_a_hebrew_label_and_description():
    for style in STYLES:
        assert hebrew_only(style["label"]), style["id"]
        assert hebrew_only(style["description"]), style["id"]


def test_every_material_has_a_hebrew_label():
    for material in MATERIALS:
        assert hebrew_only(material["label"]), material["id"]


def test_labels_are_unique():
    for items in (STYLES, MATERIALS):
        labels = [item["label"] for item in items]
        assert len(set(labels)) == len(labels)


def test_style_ids_are_unchanged():
    assert [s["id"] for s in STYLES] == ["modern", "scandinavian", "industrial", "mid-century", "japandi", "classic", "mediterranean", "bohemian"]


def test_material_ids_surfaces_and_colors_are_unchanged():
    assert SURFACES == ("floor", "walls", "ceiling", "cabinets")
    assert [(m["id"], " ".join(m["surfaces"]), m["color"]) for m in MATERIALS] == [
        ("oak-floor", "floor cabinets", "#c9a46b"),
        ("walnut-floor", "floor cabinets", "#6b4a32"),
        ("polished-concrete", "floor walls", "#9a9a97"),
        ("porcelain-stone", "floor walls", "#b8b2a7"),
        ("terracotta-tile", "floor walls", "#b9573a"),
        ("white-paint", "walls ceiling cabinets", "#f3efe6"),
        ("sage-paint", "walls cabinets", "#9caf88"),
        ("navy-paint", "walls cabinets", "#26364f"),
        ("lime-plaster", "walls", "#e4dccb"),
        ("black-metal", "cabinets", "#2b2b2b"),
    ]
