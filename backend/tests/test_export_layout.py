"""Plan export geometry and page layout: pure functions, no database."""

import copy
import math

import pytest

from app.exports import layout as L
from app.schemas import Geometry
from tests.test_geometry import VALID


def plan(mutate=None) -> Geometry:
    raw = copy.deepcopy(VALID)
    if mutate:
        mutate(raw)
    return Geometry.model_validate(raw)


def room(raw, rid, name, x, y, w, h, thickness=20):
    raw["rooms"].append({"id": rid, "name": name, "type": "living"})
    pts = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
    for i, (x1, y1) in enumerate(pts):
        x2, y2 = pts[(i + 1) % 4]
        raw["walls"].append({"id": f"{rid}w{i}", "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                             "thickness": thickness, "kind": "exterior", "roomId": rid})


def empty(raw):
    raw.update(rooms=[], walls=[], openings=[], furniture=[])


# ---- geometry shared by every format ----------------------------------------------------------------------------


def test_wall_pieces_leave_a_gap_for_each_opening():
    geometry = plan()  # w1 is 400 cm with a 90 cm door at 50 cm
    pieces = {(p.wall.id, round(p.start), round(p.end)) for p in L.wall_pieces(geometry)}
    # The wall's own ends get square caps of half its thickness (as in the editor); the gap edges do not.
    assert pieces == {("w1", -10, 50), ("w1", 140, 410), ("w2", -5, 305)}


def test_wall_pieces_merge_overlapping_openings_and_drop_slivers():
    def mutate(raw):
        raw["openings"] = [
            {"id": "a", "wallId": "w1", "type": "window", "offset": 0, "width": 100},
            {"id": "b", "wallId": "w1", "type": "window", "offset": 80, "width": 100},
            {"id": "c", "wallId": "w1", "type": "door", "offset": 180, "width": 219.9},  # leaves a 0.1 cm sliver
        ]
    pieces = [p for p in L.wall_pieces(plan(mutate)) if p.wall.id == "w1"]
    assert pieces == []


def test_outline_is_a_rectangle_of_the_wall_thickness():
    wall = plan().walls[0]  # horizontal, 20 cm thick
    corners = L.outline(wall, 0, 400)
    assert sorted(corners) == sorted([(0, -10), (400, -10), (400, 10), (0, 10)])


def test_furniture_corners_follow_the_editor_rotation():
    item = plan().furniture[0].model_copy(update={"rotation": 90, "x": 0, "y": 0, "w": 200, "d": 90})
    corners = L.furniture_corners(item)
    # SVG rotate(90) in a y-down plan turns the long side vertical.
    xs = [round(x) for x, _ in corners]
    ys = [round(y) for _, y in corners]
    assert (max(xs) - min(xs), max(ys) - min(ys)) == (90, 200)
    flat = lambda points: [value for point in points for value in point]
    assert flat(L.furniture_corners(item.model_copy(update={"rotation": -270}))) == pytest.approx(flat(corners))


def test_door_symbol_is_a_leaf_and_a_quarter_arc():
    geometry = plan()
    door = geometry.openings[0]
    symbol = L.opening_symbol(geometry.walls[0], door)
    (hinge, leaf_end), = symbol.lines
    assert hinge == pytest.approx((50, 0))
    assert math.dist(hinge, leaf_end) == pytest.approx(90)
    assert symbol.arc.centre == pytest.approx((50, 0))
    assert symbol.arc.radius == pytest.approx(90)
    assert symbol.arc.start == pytest.approx(leaf_end)
    assert symbol.arc.end == pytest.approx((140, 0))


def test_window_symbol_is_two_lines_along_the_wall_and_two_jambs():
    geometry = plan(lambda raw: raw["openings"][0].update(type="window"))
    symbol = L.opening_symbol(geometry.walls[0], geometry.openings[0])
    assert symbol.arc is None
    assert len(symbol.lines) == 4


def test_room_labels_use_the_editor_area_and_mark_it_approximate():
    labels = L.room_labels(plan(lambda raw: room(raw, "r2", "Bedroom", 0, 500, 400, 350)))
    bedroom = next(label for label in labels if label.name == "Bedroom")
    assert bedroom.area == "~ 14.0 m²"  # 400 x 350 cm, as the editor computes it
    assert bedroom.centre == pytest.approx((200, 675))


def test_room_without_walls_has_no_label():
    labels = L.room_labels(plan(lambda raw: raw["walls"][0].pop("roomId")))
    assert labels == []


def test_dimension_labels_skip_short_walls_and_shared_positions():
    def mutate(raw):
        empty(raw)
        room(raw, "a", "A", 0, 0, 300, 300)
        room(raw, "b", "B", 300, 0, 300, 300)  # shares the wall at x = 300 with room A
        raw["walls"].append({"id": "short", "x1": 0, "y1": 400, "x2": 79, "y2": 400, "thickness": 10, "kind": "partition"})
    labels = L.dimension_labels(plan(mutate))
    assert len(labels) == 7  # 8 room walls, one shared position, the 79 cm wall skipped
    assert {label.text for label in labels} == {"3.00 m"}


def test_bounds_cover_walls_and_rotated_furniture():
    def mutate(raw):
        raw["furniture"][0].update(x=-500, y=-500, w=200, d=200, rotation=45)
    bounds = L.plan_bounds(plan(mutate))
    assert bounds.x == pytest.approx(-500 - math.hypot(200, 200) / 2)
    assert bounds.x + bounds.w == pytest.approx(400 + 10)  # wall end plus half the thickest wall there


def test_bounds_of_an_empty_plan_are_a_default_sheet():
    bounds = L.plan_bounds(plan(empty))
    assert (bounds.w, bounds.h) == (600, 400)


# ---- page layout -----------------------------------------------------------------------------------------------


@pytest.mark.parametrize("paper, size_mm", [("a4", (210, 297)), ("a3", (297, 420))])
def test_wide_plan_gets_landscape_and_tall_plan_gets_portrait(paper, size_mm):
    wide = plan(lambda raw: (empty(raw), room(raw, "r", "R", 0, 0, 2000, 500)))
    tall = plan(lambda raw: (empty(raw), room(raw, "r", "R", 0, 0, 500, 2000)))
    short, long = (side * L.PT_PER_MM for side in size_mm)
    assert (L.sheet(wide, paper).width, L.sheet(wide, paper).height) == pytest.approx((long, short))
    assert (L.sheet(tall, paper).width, L.sheet(tall, paper).height) == pytest.approx((short, long))


def test_whole_plan_fits_inside_the_drawing_area_wherever_it_is():
    far = plan(lambda raw: (empty(raw), room(raw, "r", "R", 90_000, -90_000, 9_000, 4_000)))
    page = L.sheet(far, "a4")
    bounds = L.plan_bounds(far)
    for x, y in [(bounds.x, bounds.y), (bounds.x + bounds.w, bounds.y + bounds.h)]:
        px, py = page.to_page(x, y)
        assert page.area.x - 0.01 <= px <= page.area.x + page.area.w + 0.01
        assert page.area.y - 0.01 <= py <= page.area.y + page.area.h + 0.01


def test_page_flips_the_y_axis():
    page = L.sheet(plan(), "a4")
    _, top = page.to_page(0, 0)
    _, lower = page.to_page(0, 300)
    assert top > lower  # PDF y grows upward, plan y grows downward


def test_a3_draws_the_same_plan_larger_than_a4():
    geometry = plan()
    assert L.sheet(geometry, "a3").scale > L.sheet(geometry, "a4").scale


def test_single_straight_wall_does_not_divide_by_zero():
    flat = plan(lambda raw: (empty(raw), raw["walls"].append(
        {"id": "w", "x1": 0, "y1": 0, "x2": 500, "y2": 0, "thickness": 10, "kind": "partition"})))
    assert math.isfinite(L.sheet(flat, "a4").scale)


@pytest.mark.parametrize("name, expected", [
    ("Flat A", "flat-a"),
    ("  Dira ברחוב הרצל 5 ", "dira-5"),
    ("<script>alert(1)</script>", "script-alert-1-script"),
    ("דירה", "plan"),
    ("x" * 200, "x" * 60),
])
def test_file_name_is_ascii_and_safe(name, expected):
    assert L.file_name(name, 3, "pdf") == f"{expected}-v3.pdf"
