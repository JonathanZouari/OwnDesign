"""DXF export: a basic editable 2D drawing (DXF R2010, centimetres) on four layers.

The plan's y axis grows downward and CAD's grows upward, so every point goes through `_cad` (y -> -y).
Room names, areas and dimensions are left out in this release (specs/plan-export.md).
"""

import io
import math

import ezdxf
from ezdxf import zoom

from app.exports import layout as L
from app.exports.pdf import NOTICE
from app.schemas import Geometry

# Layer name -> AutoCAD colour index (7: black/white, 1: red, 3: green, 8: grey).
LAYERS = {"WALLS": 7, "OPENINGS": 3, "FURNITURE": 8, "NOTES": 1}
CENTIMETRES = 5  # $INSUNITS


def _cad(point: L.Point) -> L.Point:
    return point[0], -point[1]


def _angle(centre: L.Point, point: L.Point) -> float:
    return math.degrees(math.atan2(point[1] - centre[1], point[0] - centre[0])) % 360


def render_dxf(geometry: Geometry) -> bytes:
    doc = ezdxf.new("R2010", setup=False)
    doc.header["$INSUNITS"] = CENTIMETRES
    doc.header["$MEASUREMENT"] = 1  # metric
    for name, colour in LAYERS.items():
        doc.layers.add(name, color=colour)
    msp = doc.modelspace()

    for piece in L.wall_pieces(geometry):
        corners = [_cad(p) for p in L.outline(piece.wall, piece.start, piece.end)]
        msp.add_lwpolyline(corners, close=True, dxfattribs={"layer": "WALLS"})

    walls = {wall.id: wall for wall in geometry.walls}
    for opening in geometry.openings:
        symbol = L.opening_symbol(walls[opening.wallId], opening)
        for start, end in symbol.lines:
            msp.add_line(_cad(start), _cad(end), dxfattribs={"layer": "OPENINGS"})
        if symbol.arc:
            centre = _cad(symbol.arc.centre)
            a, b = _angle(centre, _cad(symbol.arc.start)), _angle(centre, _cad(symbol.arc.end))
            # A DXF arc always runs counter-clockwise from its start angle; take the quarter turn, not the rest.
            start, end = (a, b) if (b - a) % 360 <= 180 else (b, a)
            msp.add_arc(centre, symbol.arc.radius, start, end, dxfattribs={"layer": "OPENINGS"})

    for item in geometry.furniture:
        msp.add_lwpolyline([_cad(p) for p in L.furniture_corners(item)], close=True, dxfattribs={"layer": "FURNITURE"})

    bounds = L.plan_bounds(geometry)
    height = max(10.0, bounds.w / 80)
    note = msp.add_text(NOTICE, height=height, dxfattribs={"layer": "NOTES"})
    note.set_placement((bounds.x, -(bounds.y + bounds.h) - 3 * height))

    zoom.extents(msp)  # open on the whole drawing
    out = io.StringIO()
    doc.write(out)
    return out.getvalue().encode("utf-8")
