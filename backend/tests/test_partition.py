import json
from pathlib import Path

import pytest
from fastapi import HTTPException
from app.routes.partition import Edit, preview


@pytest.fixture
def apartment():
    return json.loads((Path(__file__).resolve().parents[2]/"frontend/assets/sample-apartment.json").read_text(encoding="utf8"))


@pytest.mark.parametrize(("mode","area"), [("move",42.4),("end",41.2),("start",41.2)])
def test_partition_updates_partial_shared_edge(apartment, mode, area):
    data=preview(Edit(geometry=apartment,wall_id="living_1",mode=mode,offset=30))["data"]
    result=data["geometry"]
    assert result["furniture"]==apartment["furniture"]
    assert result["rooms"]==apartment["rooms"]
    widths=lambda p: {o["id"]:o["width"] for o in p["openings"]}
    assert widths(result)==widths(apartment)
    by_name={row["room"]:row for row in data["areas"]}
    name=next(r["name"] for r in apartment["rooms"] if r["id"]=="living")
    assert by_name[name]["after"]==area
    hall=next(r["name"] for r in apartment["rooms"] if r["id"]=="hall")
    assert by_name[hall]["after"]<by_name[hall]["before"]
    assert abs(sum(r["after"]-r["before"] for r in data["areas"]))<0.01


def test_preview_refuses_overlapping_rooms_and_exterior_wall(apartment):
    for wall,offset in (("living_2",10),("living_1",500)):
        with pytest.raises(HTTPException) as exc:
            preview(Edit(geometry=apartment,wall_id=wall,mode="move",offset=offset))
        assert exc.value.status_code==422

@pytest.mark.parametrize("mode", ["ellipse","bay","parallel"])
@pytest.mark.parametrize("offset", [-30,30])
def test_middle_handle_keeps_endpoints_and_shared_profile(apartment, mode, offset):
    result = preview(Edit(geometry=apartment,wall_id="living_1",mode=mode,offset=offset))["data"]["geometry"]
    def profile(room):
        return {(w["x1"],w["y1"],w["x2"],w["y2"]) for w in result["walls"]
                if w["roomId"]==room and 0<=w["x1"]<w["x2"]<=800 and min(w["y1"],w["y2"])>=470 and max(w["y1"],w["y2"])<=530}
    edges = sorted(profile("living"))
    assert set(edges)==profile("hall")
    assert edges[0][:2]==(0,500) and edges[-1][2:]==(800,500)
    assert (400,500+offset) in {(x,y) for x,y,_,_ in edges}
    slope = lambda e:(e[3]-e[1])/(e[2]-e[0])
    if mode=="parallel":
        assert edges == [(0,500,400,500+offset),(400,500+offset,800,500)]
    if mode=="bay":
        assert all(slope(e)==0 for e in edges[1:-1])
    if mode=="ellipse":
        assert len(edges)>=16
        for x,y,_,_ in edges:
            assert ((x-400)/400)**2+((y-500)/offset)**2==pytest.approx(1)
    assert result["furniture"]==apartment["furniture"]


def test_curve_protects_opening_width(apartment):
    result=preview(Edit(geometry=apartment,wall_id="living_3",mode="ellipse",offset=30))["data"]["geometry"]
    assert {o["id"]:o["width"] for o in result["openings"]}=={o["id"]:o["width"] for o in apartment["openings"]}
    with pytest.raises(HTTPException):
        preview(Edit(geometry=apartment,wall_id="living_3",mode="bay",offset=30))
