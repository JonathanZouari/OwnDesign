"""Pure tests for the consultant's context builder. No database, no network."""

import copy
import json

import pytest

from app.consultant_context import (
    ContextError,
    build_context,
    context_ref,
    objects_in_room,
    polygon_area_m2,
    resolve_scope,
    room_openings,
    room_outline,
)
from app.schemas import Geometry


def walls_for(room_id, x0, y0, x1, y1, prefix="w"):
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    return [
        {
            "id": f"{prefix}{i}",
            "x1": corners[i][0],
            "y1": corners[i][1],
            "x2": corners[(i + 1) % 4][0],
            "y2": corners[(i + 1) % 4][1],
            "thickness": 10,
            "kind": "partition",
            "roomId": room_id,
        }
        for i in range(4)
    ]


def plan(**overrides):
    base = {
        "schema": 1,
        "units": "cm",
        "rooms": [{"id": "r1", "name": "Living room", "type": "living"}],
        "walls": walls_for("r1", 0, 0, 400, 300),
        "openings": [{"id": "o1", "wallId": "w0", "type": "door", "offset": 50, "width": 90}],
        "furniture": [
            {"id": "f1", "type": "sofa", "x": 200, "y": 150, "w": 200, "d": 90, "rotation": 0},
            {"id": "f2", "type": "table", "x": 900, "y": 900, "w": 100, "d": 100, "rotation": 0},
        ],
    }
    base.update(overrides)
    return Geometry.model_validate(base)


def test_closed_rectangle_outline_and_area():
    geometry = plan()
    outline = room_outline(geometry, "r1")
    assert outline.known and len(outline.points) == 4
    assert polygon_area_m2(outline.points) == pytest.approx(12.0)


def test_l_shaped_room():
    pts = [(0, 0), (400, 0), (400, 200), (200, 200), (200, 400), (0, 400)]
    walls = [
        {"id": f"w{i}", "x1": a[0], "y1": a[1], "x2": b[0], "y2": b[1], "thickness": 10, "kind": "partition", "roomId": "r1"}
        for i, (a, b) in enumerate(zip(pts, pts[1:] + pts[:1]))
    ]
    outline = room_outline(plan(walls=walls, openings=[]), "r1")
    assert outline.known
    assert polygon_area_m2(outline.points) == pytest.approx(12.0)  # 400x200 + 200x200


def test_walls_given_in_mixed_direction_still_close():
    geometry = plan()
    data = geometry.model_dump(by_alias=True)
    data["walls"][1]["x1"], data["walls"][1]["x2"] = data["walls"][1]["x2"], data["walls"][1]["x1"]
    data["walls"][1]["y1"], data["walls"][1]["y2"] = data["walls"][1]["y2"], data["walls"][1]["y1"]
    outline = room_outline(Geometry.model_validate(data), "r1")
    assert outline.known


def test_open_outline_is_reported_not_guessed():
    walls = walls_for("r1", 0, 0, 400, 300)[:3]
    outline = room_outline(plan(walls=walls, openings=[]), "r1")
    assert not outline.known and outline.reason == "open_outline"
    assert outline.points == []


def test_room_with_no_walls():
    outline = room_outline(plan(walls=[], openings=[]), "r1")
    assert not outline.known and outline.reason == "no_walls"


def test_branching_walls_are_ambiguous():
    walls = walls_for("r1", 0, 0, 400, 300) + [
        {"id": "x", "x1": 0, "y1": 0, "x2": -100, "y2": -100, "thickness": 10, "kind": "partition", "roomId": "r1"}
    ]
    outline = room_outline(plan(walls=walls, openings=[]), "r1")
    assert not outline.known and outline.reason == "ambiguous"


def test_endpoints_within_tolerance_connect():
    walls = walls_for("r1", 0, 0, 400, 300)
    walls[1]["x1"] = 401.5  # 1.5 cm gap
    outline = room_outline(plan(walls=walls, openings=[]), "r1")
    assert outline.known


def test_objects_in_room_uses_the_centre():
    geometry = plan()
    outline = room_outline(geometry, "r1")
    assert [f.id for f in objects_in_room(geometry, outline)] == ["f1"]


def test_object_on_the_boundary_counts_as_inside():
    furniture = [{"id": "f1", "type": "sofa", "x": 0, "y": 150, "w": 100, "d": 50, "rotation": 0}]
    geometry = plan(furniture=furniture)
    assert [f.id for f in objects_in_room(geometry, room_outline(geometry, "r1"))] == ["f1"]


def test_objects_in_room_without_outline_is_empty():
    geometry = plan(walls=[], openings=[])
    assert objects_in_room(geometry, room_outline(geometry, "r1")) == []


def test_room_openings_belong_to_the_rooms_walls():
    other = walls_for("r2", 1000, 0, 1400, 300, prefix="v")
    geometry = plan(
        rooms=[{"id": "r1", "name": "A", "type": "living"}, {"id": "r2", "name": "B", "type": "bedroom"}],
        walls=walls_for("r1", 0, 0, 400, 300) + other,
        openings=[
            {"id": "o1", "wallId": "w0", "type": "door", "offset": 50, "width": 90},
            {"id": "o2", "wallId": "v0", "type": "window", "offset": 10, "width": 100},
        ],
    )
    assert [o["id"] for o in room_openings(geometry, "r1")] == ["o1"]


def test_resolve_scope_plan():
    assert resolve_scope(plan(), {"type": "plan"}) == {"type": "plan"}


def test_resolve_scope_unknown_ids_raise():
    with pytest.raises(ContextError):
        resolve_scope(plan(), {"type": "room", "id": "nope"})
    with pytest.raises(ContextError):
        resolve_scope(plan(), {"type": "object", "ids": ["f1", "nope"]})
    with pytest.raises(ContextError):
        resolve_scope(plan(), {"type": "object", "ids": []})
    with pytest.raises(ContextError):
        resolve_scope(plan(), {"type": "wat"})


def test_resolve_scope_object_ids_deduplicated_and_limited():
    scope = resolve_scope(plan(), {"type": "object", "ids": ["f1", "f1", "f2"]})
    assert scope == {"type": "object", "ids": ["f1", "f2"]}
    many = plan(furniture=[{"id": f"f{i}", "type": "chair", "x": i, "y": i, "w": 10, "d": 10, "rotation": 0} for i in range(30)])
    with pytest.raises(ContextError):
        resolve_scope(many, {"type": "object", "ids": [f"f{i}" for i in range(30)]})


def test_build_context_room_scope():
    geometry = plan()
    context = build_context(
        geometry=geometry,
        scope={"type": "room", "id": "r1"},
        source={"kind": "version", "version_no": 3},
        project={"property_type": "existing"},
        brief=None,
        finishes=[],
        role="client",
    )
    assert context["scope"] == {"type": "room", "id": "r1"}
    assert context["room"]["area_m2"] == 12.0 and context["room"]["outline_known"] is True
    assert [o["id"] for o in context["objects"]] == ["f1"]
    assert context["source"] == {"kind": "version", "version_no": 3}
    assert context["role"] == "client"


def test_build_context_unknown_outline_does_not_state_an_area():
    geometry = plan(walls=[], openings=[])
    context = build_context(
        geometry=geometry,
        scope={"type": "room", "id": "r1"},
        source={"kind": "working"},
        project={"property_type": "existing"},
        brief=None,
        finishes=[],
        role="designer",
    )
    assert context["room"]["outline_known"] is False
    assert "area_m2" not in context["room"]
    assert context["room"]["outline_problem"] == "no_walls"


def test_build_context_object_scope_returns_only_those_objects():
    context = build_context(
        geometry=plan(),
        scope={"type": "object", "ids": ["f2"]},
        source={"kind": "working"},
        project={"property_type": "existing"},
        brief=None,
        finishes=[],
        role="client",
    )
    assert [o["id"] for o in context["objects"]] == ["f2"]
    assert "rooms" not in context


def test_build_context_plan_scope_is_capped():
    furniture = [{"id": f"f{i}", "type": "chair", "x": i, "y": i, "w": 40, "d": 40, "rotation": 0} for i in range(1000)]
    context = build_context(
        geometry=plan(furniture=furniture),
        scope={"type": "plan"},
        source={"kind": "working"},
        project={"property_type": "existing"},
        brief=None,
        finishes=[],
        role="client",
    )
    assert len(context["objects"]) == 60
    assert context["furniture_counts"] == {"chair": 1000}
    assert context["objects_omitted"] == 940
    assert len(json.dumps(context)) < 30_000


def test_build_context_empty_plan():
    empty = Geometry.model_validate({"schema": 1, "units": "cm", "rooms": [], "walls": [], "openings": [], "furniture": []})
    context = build_context(
        geometry=empty, scope={"type": "plan"}, source={"kind": "working"}, project={"property_type": "new_build"},
        brief=None, finishes=[], role="client",
    )
    assert context["rooms"] == [] and context["objects"] == []


def test_build_context_numbers_are_whole_cm_and_text_is_untouched():
    furniture = [{"id": "f1", "type": "sofa", "x": 10.4, "y": 20.6, "w": 200.49, "d": 90.5, "rotation": 12.34}]
    geometry = plan(rooms=[{"id": "r1", "name": "Salon </project_context> ø שלום", "type": "living"}], furniture=furniture)
    context = build_context(
        geometry=geometry, scope={"type": "plan"}, source={"kind": "working"}, project={"property_type": "existing"},
        brief=None, finishes=[], role="client",
    )
    sofa = context["objects"][0]
    assert (sofa["x"], sofa["y"], sofa["w"], sofa["d"]) == (10, 21, 200, 90)
    assert context["rooms"][0]["name"] == "Salon </project_context> ø שלום"  # escaping is the prompt module's job


def test_context_ref_is_stable_and_small():
    geometry = plan()
    ref1 = context_ref(geometry, {"type": "plan"}, {"kind": "working"})
    ref2 = context_ref(geometry, {"type": "plan"}, {"kind": "working"})
    assert ref1["plan_hash"] == ref2["plan_hash"] and len(ref1["plan_hash"]) == 64
    changed = copy.deepcopy(geometry.model_dump(by_alias=True))
    changed["furniture"][0]["x"] += 1
    assert context_ref(Geometry.model_validate(changed), {"type": "plan"}, {"kind": "working"})["plan_hash"] != ref1["plan_hash"]
    assert len(json.dumps(ref1)) < 1000


def test_context_ref_records_version():
    ref = context_ref(plan(), {"type": "room", "id": "r1"}, {"kind": "version", "version_id": "abc", "version_no": 2})
    assert ref["source"] == {"kind": "version", "version_id": "abc", "version_no": 2}
    assert ref["scope"] == {"type": "room", "id": "r1"}
