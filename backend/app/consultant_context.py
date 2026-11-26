"""Builds the structured plan context the consultant reasons over.

Pure functions over a validated Geometry: no database, no network. Rooms have no outline in the plan
model, so the outline, the area and "which furniture is in the room" are derived here from the walls
that carry the room's id. When the walls do not form one closed loop the outline is reported as
unknown and no area is given: the consultant must not guess one.
"""

import hashlib
import json
import math
from collections import Counter
from dataclasses import dataclass, field

from app.schemas import Geometry

SNAP_CM = 2.0  # wall endpoints this close are the same corner
MAX_LISTED_OBJECTS = 60  # whole-plan context lists this many items, the rest is summarised as counts
MAX_SCOPED_OBJECTS = 20
SCOPE_TYPES = ("plan", "room", "object")


class ContextError(ValueError):
    """The requested scope does not exist in this plan."""


@dataclass(frozen=True)
class Outline:
    known: bool
    points: list[tuple[float, float]] = field(default_factory=list)
    reason: str | None = None  # no_walls | open_outline | ambiguous


def room_outline(geometry: Geometry, room_id: str) -> Outline:
    walls = [wall for wall in geometry.walls if wall.roomId == room_id]
    if not walls:
        return Outline(False, reason="no_walls")
    nodes: list[tuple[float, float]] = []

    def node_for(x: float, y: float) -> int:
        for index, (nx, ny) in enumerate(nodes):
            if math.hypot(nx - x, ny - y) <= SNAP_CM:
                return index
        nodes.append((x, y))
        return len(nodes) - 1

    edges = [(node_for(w.x1, w.y1), node_for(w.x2, w.y2)) for w in walls]
    degree: Counter = Counter()
    for a, b in edges:
        degree[a] += 1
        degree[b] += 1
    if any(count > 2 for count in degree.values()):
        return Outline(False, reason="ambiguous")
    if any(count < 2 for count in degree.values()):
        return Outline(False, reason="open_outline")
    adjacent: dict[int, list[int]] = {}
    for a, b in edges:
        adjacent.setdefault(a, []).append(b)
        adjacent.setdefault(b, []).append(a)
    order = [0]
    previous, current = None, 0
    while True:
        nexts = [n for n in adjacent[current] if n != previous] or adjacent[current]
        following = nexts[0]
        if following == 0:
            break
        order.append(following)
        previous, current = current, following
        if len(order) > len(nodes):
            return Outline(False, reason="ambiguous")
    if len(order) != len(nodes) or len(nodes) < 3:  # a second, separate loop belongs to the same room id
        return Outline(False, reason="ambiguous")
    return Outline(True, [nodes[i] for i in order])


def polygon_area_m2(points: list[tuple[float, float]]) -> float:
    total = 0.0
    for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1]):
        total += x1 * y2 - x2 * y1
    return abs(total) / 2 / 10_000


def _on_segment(px, py, ax, ay, bx, by) -> bool:
    cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
    if abs(cross) > 1e-6 * max(1.0, math.hypot(bx - ax, by - ay)):
        return False
    return min(ax, bx) - 1e-9 <= px <= max(ax, bx) + 1e-9 and min(ay, by) - 1e-9 <= py <= max(ay, by) + 1e-9


def _inside(px: float, py: float, points: list[tuple[float, float]]) -> bool:
    inside = False
    for (ax, ay), (bx, by) in zip(points, points[1:] + points[:1]):
        if _on_segment(px, py, ax, ay, bx, by):
            return True  # the boundary counts as inside
        if (ay > py) != (by > py) and px < (bx - ax) * (py - ay) / (by - ay) + ax:
            inside = not inside
    return inside


def objects_in_room(geometry: Geometry, outline: Outline) -> list:
    """Furniture whose centre lies inside the outline (or on it)."""
    if not outline.known:
        return []
    return [item for item in geometry.furniture if _inside(item.x, item.y, outline.points)]


def room_openings(geometry: Geometry, room_id: str) -> list[dict]:
    wall_ids = {wall.id for wall in geometry.walls if wall.roomId == room_id}
    return [
        {"id": o.id, "type": o.type, "wall_id": o.wallId, "offset": round(o.offset), "width": round(o.width)}
        for o in geometry.openings
        if o.wallId in wall_ids
    ]


def resolve_scope(geometry: Geometry, scope: dict) -> dict:
    """Checks the scope against THIS plan and returns it normalised. Unknown ids are an error."""
    kind = scope.get("type")
    if kind == "plan":
        return {"type": "plan"}
    if kind == "room":
        if scope.get("id") not in {room.id for room in geometry.rooms}:
            raise ContextError("That room is not in the plan")
        return {"type": "room", "id": scope["id"]}
    if kind == "object":
        ids = list(dict.fromkeys(scope.get("ids") or []))
        known = {item.id for item in geometry.furniture}
        if not ids or len(ids) > MAX_SCOPED_OBJECTS:
            raise ContextError(f"Select between 1 and {MAX_SCOPED_OBJECTS} objects")
        if any(i not in known for i in ids):
            raise ContextError("A selected object is not in the plan")
        return {"type": "object", "ids": ids}
    raise ContextError("Unknown context type")


def _object(item) -> dict:
    return {
        "id": item.id,
        "type": item.type,
        "x": round(item.x),
        "y": round(item.y),
        "w": round(item.w),
        "d": round(item.d),
        "rotation": round(item.rotation),
    }


def _room_summary(geometry: Geometry, room) -> dict:
    outline = room_outline(geometry, room.id)
    data = {"id": room.id, "name": room.name, "type": room.type, "outline_known": outline.known}
    if outline.known:
        data["area_m2"] = round(polygon_area_m2(outline.points), 1)
    else:
        data["outline_problem"] = outline.reason
    return data


def build_context(*, geometry: Geometry, scope: dict, source: dict, project: dict, brief, finishes: list, role: str) -> dict:
    scope = resolve_scope(geometry, scope)
    context: dict = {
        "units": geometry.units,
        "role": role,
        "property_type": project.get("property_type"),
        "source": {k: source[k] for k in ("kind", "version_no") if k in source},
        "scope": scope,
    }
    if scope["type"] == "plan":
        context["rooms"] = [_room_summary(geometry, room) for room in geometry.rooms]
        context["walls"] = len(geometry.walls)
        context["openings"] = len(geometry.openings)
        context["furniture_counts"] = dict(Counter(item.type for item in geometry.furniture))
        listed = geometry.furniture[:MAX_LISTED_OBJECTS]
        context["objects"] = [_object(item) for item in listed]
        if len(geometry.furniture) > len(listed):
            context["objects_omitted"] = len(geometry.furniture) - len(listed)
        context["brief"] = brief
        context["finishes"] = finishes
    elif scope["type"] == "room":
        room = next(r for r in geometry.rooms if r.id == scope["id"])
        context["room"] = _room_summary(geometry, room)
        context["room"]["openings"] = room_openings(geometry, room.id)
        context["objects"] = [_object(item) for item in objects_in_room(geometry, room_outline(geometry, room.id))][:MAX_LISTED_OBJECTS]
        context["brief"] = brief
        context["finishes"] = [f for f in finishes if f.get("room_id") == room.id]
    else:
        wanted = set(scope["ids"])
        context["objects"] = [_object(item) for item in geometry.furniture if item.id in wanted]
        context["brief"] = brief
    return context


def context_ref(geometry: Geometry, scope: dict, source: dict) -> dict:
    """The small record stored with a message: what the answer was based on, not the plan itself."""
    canonical = json.dumps(geometry.model_dump(by_alias=True), sort_keys=True, separators=(",", ":"))
    return {
        "source": {k: source[k] for k in ("kind", "version_id", "version_no") if k in source},
        "scope": scope,
        "plan_hash": hashlib.sha256(canonical.encode()).hexdigest(),
    }
