import copy

import pytest
from pydantic import ValidationError

from app.schemas import Geometry

VALID = {
    "schema": 1,
    "units": "cm",
    "rooms": [{"id": "r1", "name": "Living room", "type": "living"}],
    "walls": [
        {"id": "w1", "x1": 0, "y1": 0, "x2": 400, "y2": 0, "thickness": 20, "kind": "exterior", "roomId": "r1"},
        {"id": "w2", "x1": 400, "y1": 0, "x2": 400, "y2": 300, "thickness": 10, "kind": "partition"},
    ],
    "openings": [{"id": "o1", "wallId": "w1", "type": "door", "offset": 50, "width": 90}],
    "furniture": [{"id": "f1", "type": "sofa", "x": 100, "y": 100, "w": 200, "d": 90, "rotation": 0}],
}


def variant(mutate):
    plan = copy.deepcopy(VALID)
    mutate(plan)
    return plan


def test_valid_plan_round_trips():
    assert Geometry.model_validate(VALID).model_dump(by_alias=True, exclude_none=True) == {
        **VALID,
        "walls": [{**w, **{k: float(w[k]) for k in ("x1", "y1", "x2", "y2", "thickness")}} for w in VALID["walls"]],
    }


def test_empty_plan_is_valid():
    Geometry.model_validate({"schema": 1, "units": "cm", "rooms": [], "walls": [], "openings": [], "furniture": []})


@pytest.mark.parametrize(
    "mutate",
    [
        lambda p: p.update(schema=2),
        lambda p: p.update(units="in"),
        lambda p: p.update(extra="x"),
        lambda p: p["walls"][0].update(x2=float("inf")),
        lambda p: p["walls"][0].update(x2=float("nan")),
        lambda p: p["walls"][0].update(x2=10_000_000),
        lambda p: p["walls"][0].update(x2=0),  # zero-length wall
        lambda p: p["walls"][0].update(thickness=0),
        lambda p: p["walls"][0].update(kind="curtain"),
        lambda p: p["walls"][0].update(roomId="missing"),
        lambda p: p["walls"][1].update(id="w1"),  # duplicate id
        lambda p: p["openings"][0].update(wallId="missing"),
        lambda p: p["openings"][0].update(offset=350),  # 350 + 90 > 400
        lambda p: p["openings"][0].update(offset=-1),
        lambda p: p["openings"][0].update(width=0),
        lambda p: p["openings"][0].update(type="arch"),
        lambda p: p["furniture"][0].update(w=-5),
        lambda p: p["furniture"][0].update(id="<script>"),
        lambda p: p["rooms"][0].update(name="x" * 500),
        lambda p: p.update(walls=p["walls"] * 2000),
    ],
)
def test_invalid_plans_are_rejected(mutate):
    with pytest.raises(ValidationError):
        Geometry.model_validate(variant(mutate))
