"""Unit tests of the style profile built from inspiration image analyses. No database."""

from app.style import MAX_PROFILE_COLOURS, style_profile


def analysis(palette=(), objects=()):
    return {"palette": [{"hex": h, "name": n, "share": s} for h, n, s in palette],
            "objects": [{"label": label, "category": c, "confidence": 0.9} for label, c in objects]}


def test_no_images():
    assert style_profile([], total=0) == {"analysed": 0, "total": 0, "palette": [], "categories": []}


def test_analysed_and_total_count_separately():
    assert style_profile([analysis()], total=3)["analysed"] == 1
    assert style_profile([analysis()], total=3)["total"] == 3


def test_one_image():
    profile = style_profile([analysis([("#f0f0f0", "white", 0.7), ("#202020", "black", 0.3)], [("Sofa", "seating")])], total=1)
    assert profile["palette"] == [
        {"hex": "#f0f0f0", "name": "white", "share": 0.7, "images": 1},
        {"hex": "#202020", "name": "black", "share": 0.3, "images": 1},
    ]
    assert profile["categories"] == [{"category": "seating", "images": 1, "objects": 1}]


def test_shades_of_one_name_merge_and_the_biggest_shade_represents_them():
    profile = style_profile([
        analysis([("#e0d0b0", "beige", 0.6), ("#f0f0f0", "white", 0.4)]),
        analysis([("#d8c8a8", "beige", 0.2), ("#2050a0", "blue", 0.8)]),
    ], total=2)
    by_name = {c["name"]: c for c in profile["palette"]}
    assert by_name["beige"] == {"hex": "#e0d0b0", "name": "beige", "share": 0.4, "images": 2}
    assert by_name["blue"]["share"] == 0.4 and by_name["white"]["share"] == 0.2
    assert sum(c["share"] for c in profile["palette"]) == 1.0
    assert [c["name"] for c in profile["palette"]][:1] in (["beige"], ["blue"])


def test_palette_is_capped_and_sorted():
    names = ["white", "black", "grey", "beige", "brown", "red", "orange", "yellow"]
    images = [analysis([(f"#0000{i:02x}", name, 1.0)]) for i, name in enumerate(names)]
    images.append(analysis([("#ffffff", "white", 1.0)]))
    profile = style_profile(images, total=len(images))
    assert len(profile["palette"]) == MAX_PROFILE_COLOURS == 6
    assert profile["palette"][0]["name"] == "white"
    shares = [c["share"] for c in profile["palette"]]
    assert shares == sorted(shares, reverse=True)


def test_categories_count_images_and_objects_and_sort_by_images():
    profile = style_profile([
        analysis(objects=[("Chair", "seating"), ("Chair", "seating"), ("Plant", "plants")]),
        analysis(objects=[("Plant", "plants")]),
        analysis(objects=[]),
    ], total=3)
    assert profile["categories"] == [
        {"category": "plants", "images": 2, "objects": 2},
        {"category": "seating", "images": 1, "objects": 2},
    ]


def test_bad_rows_are_ignored():
    profile = style_profile([{"palette": None, "objects": None}, {}], total=2)
    assert profile["palette"] == [] and profile["categories"] == [] and profile["analysed"] == 2
