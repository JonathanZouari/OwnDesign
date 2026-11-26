"""Geometry and page layout for plan exports. Pure functions over a validated Geometry, shared by every format.

Plan coordinates are centimetres with the origin top-left and y growing downward (as in the editor).
Page coordinates are PDF points with the origin bottom-left and y growing upward.
"""

import math
import re
from dataclasses import dataclass

from app.schemas import Furniture, Geometry, Opening, Wall

PT_PER_MM = 72 / 25.4
PAPER_MM = {"a4": (210, 297), "a3": (297, 420)}
MARGIN_MM = 12
FOOTER_MM = 24  # project, version, date and the notices
LABEL_GUTTER_PT = 24  # room for a wall-length label beside an outer wall
MIN_PIECE_CM = 1  # a wall remnant shorter than this beside an opening is not drawn
MIN_LABELLED_WALL_CM = 80  # same rule as the editor (frontend/js/editor/render.js)
EMPTY_BOUNDS = (0.0, 0.0, 600.0, 400.0)  # same as planBox() in frontend/js/plan.js

Point = tuple[float, float]


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    w: float
    h: float


@dataclass(frozen=True)
class Piece:
    """The part of a wall from `start` to `end` cm along it, between openings (beyond 0..length at a square cap)."""

    wall: Wall
    start: float
    end: float


@dataclass(frozen=True)
class Arc:
    centre: Point
    radius: float
    start: Point  # the arc runs from start to end, a quarter turn
    end: Point


@dataclass(frozen=True)
class Symbol:
    lines: list[tuple[Point, Point]]
    arc: Arc | None


@dataclass(frozen=True)
class RoomLabel:
    name: str
    area: str
    centre: Point


@dataclass(frozen=True)
class DimensionLabel:
    text: str
    mid: Point
    normal: Point  # unit vector; the label sits on this side of the wall
    clearance: float  # half the wall thickness, in cm


def wall_length(wall: Wall) -> float:
    return math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1)


def _unit(wall: Wall) -> tuple[float, float]:
    length = wall_length(wall)
    return (wall.x2 - wall.x1) / length, (wall.y2 - wall.y1) / length


def _along(wall: Wall, distance: float, side: float = 0.0) -> Point:
    """The point `distance` cm along the wall, shifted `side` cm along its normal (-uy, ux), as in the editor."""
    ux, uy = _unit(wall)
    return wall.x1 + ux * distance - uy * side, wall.y1 + uy * distance + ux * side


def wall_pieces(geometry: Geometry) -> list[Piece]:
    """Each wall split around its openings, so an opening is a real gap rather than something painted over."""
    gaps: dict[str, list[tuple[float, float]]] = {}
    for opening in geometry.openings:
        gaps.setdefault(opening.wallId, []).append((opening.offset, opening.offset + opening.width))
    pieces = []
    for wall in geometry.walls:
        cursor = 0.0
        length = wall_length(wall)
        half = wall.thickness / 2
        for start, end in sorted(gaps.get(wall.id, [])) + [(length, length)]:
            if start - cursor >= MIN_PIECE_CM:
                # Square caps at the wall's own ends, as the editor draws them (stroke-linecap: square),
                # so corners close; no cap beside an opening, which stays a clean gap.
                piece_start = -half if cursor == 0 else cursor
                piece_end = length + half if start >= length else start
                pieces.append(Piece(wall, piece_start, piece_end))
            cursor = max(cursor, end)
    return pieces


def outline(wall: Wall, start: float, end: float) -> list[Point]:
    """The four corners of the wall between `start` and `end`, at its full thickness."""
    half = wall.thickness / 2
    return [_along(wall, start, -half), _along(wall, end, -half), _along(wall, end, half), _along(wall, start, half)]


def furniture_corners(item: Furniture) -> list[Point]:
    """Corners of the item after SVG `translate(x y) rotate(r)`, which is how the editor draws it."""
    angle = math.radians(item.rotation)
    cos, sin = math.cos(angle), math.sin(angle)
    half_w, half_d = item.w / 2, item.d / 2
    return [
        (item.x + px * cos - py * sin, item.y + px * sin + py * cos)
        for px, py in ((-half_w, -half_d), (half_w, -half_d), (half_w, half_d), (-half_w, half_d))
    ]


def opening_symbol(wall: Wall, opening: Opening) -> Symbol:
    end = opening.offset + opening.width
    if opening.type == "door":
        # Door leaf standing open at 90 degrees, and the arc it sweeps when closing (as in the editor).
        hinge = _along(wall, opening.offset)
        leaf = _along(wall, opening.offset, opening.width)
        return Symbol(lines=[(hinge, leaf)], arc=Arc(centre=hinge, radius=opening.width, start=leaf, end=_along(wall, end)))
    quarter = wall.thickness / 4
    half = wall.thickness / 2
    return Symbol(
        lines=[
            (_along(wall, opening.offset, quarter), _along(wall, end, quarter)),
            (_along(wall, opening.offset, -quarter), _along(wall, end, -quarter)),
            (_along(wall, opening.offset, -half), _along(wall, opening.offset, half)),
            (_along(wall, end, -half), _along(wall, end, half)),
        ],
        arc=None,
    )


def arc_points(arc: Arc, steps: int = 16) -> list[Point]:
    """Points along the arc from its start to its end, the short way round (a quarter turn)."""
    cx, cy = arc.centre
    a0 = math.atan2(arc.start[1] - cy, arc.start[0] - cx)
    a1 = math.atan2(arc.end[1] - cy, arc.end[0] - cx)
    sweep = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
    return [(cx + arc.radius * math.cos(a0 + sweep * i / steps), cy + arc.radius * math.sin(a0 + sweep * i / steps)) for i in range(steps + 1)]


def _room_box(geometry: Geometry, room_id: str) -> Box | None:
    points = [(w.x1, w.y1) for w in geometry.walls if w.roomId == room_id] + [
        (w.x2, w.y2) for w in geometry.walls if w.roomId == room_id
    ]
    if not points:
        return None
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return Box(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))


def room_labels(geometry: Geometry) -> list[RoomLabel]:
    """Name and area of each room. The area is the editor's: the box around the room's wall centrelines."""
    labels = []
    for room in geometry.rooms:
        box = _room_box(geometry, room.id)
        if box is None:
            continue
        area = box.w * box.h / 10_000
        labels.append(RoomLabel(room.name, f"~ {area:.1f} m²", (box.x + box.w / 2, box.y + box.h / 2)))
    return labels


def dimension_labels(geometry: Geometry) -> list[DimensionLabel]:
    """One length label per distinct wall position, so two rooms sharing a wall are not labelled twice."""
    seen = set()
    labels = []
    for wall in geometry.walls:
        length = wall_length(wall)
        mid = ((wall.x1 + wall.x2) / 2, (wall.y1 + wall.y2) / 2)
        key = (round(mid[0]), round(mid[1]))
        if length < MIN_LABELLED_WALL_CM or key in seen:
            continue
        seen.add(key)
        ux, uy = _unit(wall)
        labels.append(DimensionLabel(f"{length / 100:.2f} m", mid, (uy, -ux), wall.thickness / 2))
    return labels


def plan_bounds(geometry: Geometry) -> Box:
    """Everything drawn: walls with their square caps at any angle, door swings on either side, furniture at any rotation."""
    points = []
    for wall in geometry.walls:
        half = wall.thickness / 2
        points += outline(wall, -half, wall_length(wall) + half)
    walls = {wall.id: wall for wall in geometry.walls}
    for opening in geometry.openings:
        if opening.type == "door":  # the leaf and its swing may reach outside the walls
            points += arc_points(opening_symbol(walls[opening.wallId], opening).arc)
    for item in geometry.furniture:
        reach = math.hypot(item.w, item.d) / 2
        points += [(item.x - reach, item.y - reach), (item.x + reach, item.y + reach)]
    if not points:
        return Box(*EMPTY_BOUNDS)
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return Box(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))


@dataclass(frozen=True)
class Sheet:
    width: float  # page size in points
    height: float
    area: Box  # where the plan is drawn, in page points
    scale: float  # points per centimetre
    bounds: Box  # the plan's bounds, in centimetres

    def to_page(self, x: float, y: float) -> Point:
        """Plan centimetres to page points, centred in the drawing area, with y flipped to grow upward."""
        drawn_w, drawn_h = self.bounds.w * self.scale, self.bounds.h * self.scale
        left = self.area.x + (self.area.w - drawn_w) / 2
        top = self.area.y + self.area.h - (self.area.h - drawn_h) / 2
        return left + (x - self.bounds.x) * self.scale, top - (y - self.bounds.y) * self.scale


def sheet(geometry: Geometry, paper: str) -> Sheet:
    """A4 or A3, in whichever orientation draws the plan larger, fitted to one page."""
    bounds = plan_bounds(geometry)
    plan_w, plan_h = max(bounds.w, 1.0), max(bounds.h, 1.0)
    short, long = (side * PT_PER_MM for side in PAPER_MM[paper])
    margin, footer, gutter = MARGIN_MM * PT_PER_MM, FOOTER_MM * PT_PER_MM, LABEL_GUTTER_PT
    best = None
    for width, height in ((short, long), (long, short)):
        area = Box(margin + gutter, margin + footer + gutter, width - 2 * (margin + gutter), height - 2 * (margin + gutter) - footer)
        scale = min(area.w / plan_w, area.h / plan_h)
        if best is None or scale > best.scale:
            best = Sheet(width, height, area, scale, bounds)
    return best


def file_name(project_name: str, version_no: int, extension: str) -> str:
    """ASCII-only, so it is safe in a Content-Disposition header and on every file system."""
    slug = re.sub(r"[^a-z0-9]+", "-", project_name.lower()).strip("-")[:60].strip("-")
    return f"{slug or 'plan'}-v{version_no}.{extension}"
