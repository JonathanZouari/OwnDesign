from copy import deepcopy

from app.routes.layout_audit import AuditRequest, check_layout
from tests.test_geometry import VALID


def test_rotated_furniture_and_opening_clearance():
    plan = deepcopy(VALID)
    corners = [(0, 0), (400, 0), (400, 300), (0, 300)]
    plan["walls"] = [
        {**VALID["walls"][0], "id": f"w{i+1}", "x1": x, "y1": y, "x2": a, "y2": b}
        for i, ((x, y), (a, b)) in enumerate(zip(corners, corners[1:] + corners[:1]))
    ]
    item = plan["furniture"][0]
    item.update(x=100, y=120, w=120, d=40)
    plan["openings"][0]["width"] = 80

    def rules():
        return {f["rule"] for f in check_layout(AuditRequest(geometry=plan))["data"]["findings"]}

    assert rules() == {"window", "narrow"}
    item["rotation"] = 90
    assert rules() == {"window", "narrow", "blocked"}
    plan["openings"].append({**plan["openings"][0], "id": "o2", "wallId": "w2", "type": "window"})
    item.update(x=390, y=220)
    assert rules() == {"narrow", "fit"}
    item["x"] = 500
    assert rules() == {"narrow", "unassigned"}
    plan["walls"].pop()
    assert rules() == {"incomplete", "unassigned"}

def test_elliptical_room_checks_the_whole_rotated_item():
    plan = deepcopy(VALID)
    plan["walls"], plan["openings"] = [], []
    plan["rooms"][0]["ellipse"] = {"cx": 0, "cy": 0, "width": 600, "length": 400, "rotation": 90}
    item = plan["furniture"][0]
    item.update(x=175, y=0, w=90, d=20, rotation=0)

    def rules():
        return {row["rule"] for row in check_layout(AuditRequest(geometry=plan))["data"]["findings"]}

    assert rules() == {"window", "fit"}
    item["rotation"] = 90
    assert rules() == {"window"}
    item.update(x=195, y=290)
    assert rules() == {"window", "unassigned"}
