"""PDF export: one A4 or A3 page, the whole plan fitted to it, with labels, identification and the notices.

User text (room, project and version names) is drawn with drawString only, so it is never parsed as markup.
Hebrew is put into display order with python-bidi before drawing; Heebo covers Hebrew and Latin.
"""

import io
import math
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from bidi import get_display
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from app.exports import layout as L
from app.schemas import Geometry

FONT = "Heebo"
pdfmetrics.registerFont(TTFont(FONT, str(Path(__file__).parent / "fonts" / "Heebo.ttf")))

NOTICE = "Conceptual plan only. Not for construction."
SCALE_NOTICE = "Fit to page. Scale not guaranteed."
AREA_NOTICE = "Room areas are approximate."

INK = (0.11, 0.11, 0.10)
WALL = {"exterior": (0.17, 0.17, 0.16), "partition": (0.38, 0.36, 0.35)}
FURNITURE_FILL = (0.95, 0.93, 0.91)
FURNITURE_LINE = (0.55, 0.50, 0.47)
MUTED = (0.36, 0.30, 0.27)
ACCENT = (0.62, 0.24, 0.09)  # the app's terracotta, for the notice
ARC_STEPS = 16


@dataclass(frozen=True)
class ExportInfo:
    project_name: str
    version_no: int
    version_label: str
    exported_on: date


def _shown(text: str, base: str | None = None) -> str:
    return get_display(text, base_dir=base) if base else get_display(text)


def _fit(text: str, size: float, width: float) -> str:
    """Shortens text with an ellipsis until it fits the width."""
    if pdfmetrics.stringWidth(text, FONT, size) <= width:
        return text
    while text and pdfmetrics.stringWidth(text + "…", FONT, size) > width:
        text = text[:-1]
    return text.rstrip() + "…"


def _polygon(pdf: canvas.Canvas, page: L.Sheet, points: list[L.Point], fill: bool) -> None:
    path = pdf.beginPath()
    path.moveTo(*page.to_page(*points[0]))
    for point in points[1:]:
        path.lineTo(*page.to_page(*point))
    path.close()
    pdf.drawPath(path, stroke=1, fill=1 if fill else 0)


def _arc_points(arc: L.Arc) -> list[L.Point]:
    cx, cy = arc.centre
    a0 = math.atan2(arc.start[1] - cy, arc.start[0] - cx)
    a1 = math.atan2(arc.end[1] - cy, arc.end[0] - cx)
    sweep = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi  # the short way round: a quarter turn
    return [(cx + arc.radius * math.cos(a0 + sweep * i / ARC_STEPS), cy + arc.radius * math.sin(a0 + sweep * i / ARC_STEPS)) for i in range(ARC_STEPS + 1)]


def _drawing(pdf: canvas.Canvas, page: L.Sheet, geometry: Geometry) -> None:
    walls = {wall.id: wall for wall in geometry.walls}
    # Same order as the editor: furniture under the walls, openings over them, labels on top.
    pdf.setLineWidth(0.5)
    pdf.setFillColorRGB(*FURNITURE_FILL)
    pdf.setStrokeColorRGB(*FURNITURE_LINE)
    for item in geometry.furniture:
        _polygon(pdf, page, L.furniture_corners(item), fill=True)

    pdf.setLineWidth(0.3)
    for piece in L.wall_pieces(geometry):
        pdf.setFillColorRGB(*WALL[piece.wall.kind])
        pdf.setStrokeColorRGB(*WALL[piece.wall.kind])
        _polygon(pdf, page, L.outline(piece.wall, piece.start, piece.end), fill=True)

    pdf.setStrokeColorRGB(*INK)
    for opening in geometry.openings:
        symbol = L.opening_symbol(walls[opening.wallId], opening)
        pdf.setLineWidth(0.6)
        for start, end in symbol.lines:
            pdf.line(*page.to_page(*start), *page.to_page(*end))
        if symbol.arc:
            pdf.setDash(2, 2)
            points = [page.to_page(*point) for point in _arc_points(symbol.arc)]
            for start, end in zip(points, points[1:]):
                pdf.line(*start, *end)
            pdf.setDash()


def _labels(pdf: canvas.Canvas, page: L.Sheet, geometry: Geometry) -> None:
    size = 6.5
    pdf.setFont(FONT, size)
    pdf.setFillColorRGB(*MUTED)
    for label in L.dimension_labels(geometry):
        nx, ny = label.normal
        x, y = page.to_page(label.mid[0] + nx * label.clearance, label.mid[1] + ny * label.clearance)
        # Step out from the wall face by enough to clear the horizontal text: half its width beside a vertical
        # wall, half its height beside a horizontal one. The normal's y flips with the page's y axis.
        out = abs(nx) * pdfmetrics.stringWidth(label.text, FONT, size) / 2 + abs(ny) * size * 0.6 + 2.5
        x, y = x + nx * out, y - ny * out
        pdf.drawCentredString(x, y - size * 0.35, label.text)

    for label in L.room_labels(geometry):
        x, y = page.to_page(*label.centre)
        pdf.setFillColorRGB(*INK)
        pdf.setFont(FONT, 9)
        pdf.drawCentredString(x, y + 2, _shown(_fit(label.name, 9, page.area.w / 3)))
        pdf.setFillColorRGB(*MUTED)
        pdf.setFont(FONT, 7.5)
        pdf.drawCentredString(x, y - 8, label.area)

    if not geometry.walls and not geometry.furniture:
        x, y = page.to_page(page.bounds.x + page.bounds.w / 2, page.bounds.y + page.bounds.h / 2)
        pdf.setFillColorRGB(*MUTED)
        pdf.setFont(FONT, 12)
        pdf.drawCentredString(x, y, "Blank canvas")


def _footer(pdf: canvas.Canvas, page: L.Sheet, info: ExportInfo) -> None:
    left = page.area.x
    width = page.area.w
    top = page.area.y - 6
    pdf.setStrokeColorRGB(*MUTED)
    pdf.setLineWidth(0.4)
    pdf.line(left, top, left + width, top)

    pdf.setFillColorRGB(*INK)
    pdf.setFont(FONT, 11)
    pdf.drawString(left, top - 16, _shown(_fit(info.project_name, 11, width), "L"))

    version = f"Version {info.version_no}"
    if info.version_label:
        version += f" · {info.version_label}"
    line = _fit(f"{version} · Exported {info.exported_on.isoformat()}", 8, width)
    pdf.setFillColorRGB(*MUTED)
    pdf.setFont(FONT, 8)
    pdf.drawString(left, top - 30, _shown(line, "L"))

    pdf.setFillColorRGB(*ACCENT)
    pdf.drawString(left, top - 44, NOTICE)
    pdf.setFillColorRGB(*MUTED)
    pdf.drawString(left, top - 56, f"{SCALE_NOTICE}  {AREA_NOTICE}")


def render_pdf(geometry: Geometry, info: ExportInfo, paper: str) -> bytes:
    page = L.sheet(geometry, paper)
    out = io.BytesIO()
    pdf = canvas.Canvas(out, pagesize=(page.width, page.height), pageCompression=1)
    pdf.setTitle(f"{info.project_name} - version {info.version_no}")
    pdf.setCreator("Atelier")
    _drawing(pdf, page, geometry)
    _labels(pdf, page, geometry)
    _footer(pdf, page, info)
    pdf.showPage()
    pdf.save()
    return out.getvalue()
