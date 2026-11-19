"""Synthetic contractor-style floor plans for the PDF import E2E tests.

Nothing here is derived from a real drawing. PDFs are written into a pytest tmp dir at test time and never committed.
The apartment is the same two-room plan as in frontend/tests/walls.test.js: 7 walls on an 8 x 5 m footprint.

Hebrew: the scale label uses a system TrueType font with Hebrew glyphs when one can be found (Arial on Windows,
DejaVu on Linux); otherwise the label falls back to Latin ("SCALE 1:50") and only the "1:N" text is detected.
"""

from __future__ import annotations

import io
import os
from pathlib import Path

from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

PT_PER_CM_AT_1 = 72 / 2.54
OX, OY = 300, 200  # footprint offset on the sheet, cm

# (x1, y1, x2, y2, thickness) centre lines in footprint cm
WALLS = [
    (0, 0, 800, 0, 20),
    (0, 500, 800, 500, 20),
    (0, 0, 0, 500, 20),
    (800, 0, 800, 500, 20),
    (400, 0, 400, 500, 10),
    (400, 250, 800, 250, 10),
    (0, 300, 150, 300, 10),
]
# Filled rectangles (x, y, w, h) as the contractor would draw them: outer walls overlap at the corners.
FILLED = [(-10, -10, 820, 20), (-10, 490, 820, 20), (-10, 10, 20, 480), (790, 10, 20, 480), (395, 10, 10, 480), (405, 245, 385, 10), (10, 295, 140, 10)]
# Same walls as parallel thin lines (x1, y1, x2, y2) plus outlines.
OUTLINES = [(-10, -10, 820, 520), (10, 10, 780, 480)]
LINES = [(395, 10, 395, 490), (405, 10, 405, 490), (405, 245, 790, 245), (405, 255, 790, 255), (10, 295, 150, 295), (10, 305, 150, 305)]

HEBREW_FONT_CANDIDATES = [
    r"C:\Windows\Fonts\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]


def truth() -> list[tuple[float, float, float, float, float]]:
    """Expected walls as the importer reports them: shifted so the footprint's outer faces start at (0, 0)."""
    return [(x1 + 10, y1 + 10, x2 + 10, y2 + 10, t) for x1, y1, x2, y2, t in WALLS]


def _hebrew_font() -> str | None:
    for path in HEBREW_FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont("HebrewSans", path))
                return "HebrewSans"
            except Exception:
                continue
    return None


class _Sheet:
    def __init__(self, target, ratio: int, width_cm=1500, height_cm=1000):
        self.k = PT_PER_CM_AT_1 / ratio  # points per real-world cm
        self.h = height_cm * self.k
        self.pdf = canvas.Canvas(str(target), pagesize=(width_cm * self.k, self.h))

    def x(self, cm):
        return cm * self.k

    def y(self, cm):
        return self.h - cm * self.k

    def fill_rect(self, x, y, w, h, gray=0.0):
        self.pdf.setFillGray(gray)
        self.pdf.rect(self.x(x), self.y(y + h), w * self.k, h * self.k, stroke=0, fill=1)

    def stroke_rect(self, x, y, w, h, width_pt=0.5):
        self.pdf.setLineWidth(width_pt)
        self.pdf.setStrokeGray(0)
        self.pdf.rect(self.x(x), self.y(y + h), w * self.k, h * self.k, stroke=1, fill=0)

    def line(self, x1, y1, x2, y2, width_pt=0.5):
        self.pdf.setLineWidth(width_pt)
        self.pdf.setStrokeGray(0)
        self.pdf.line(self.x(x1), self.y(y1), self.x(x2), self.y(y2))

    def text(self, x, y, s, size=10, font=None):
        self.pdf.setFillGray(0)
        self.pdf.setFont(font or "Helvetica", size)
        self.pdf.drawString(self.x(x), self.y(y), s)


def _noise(sheet: _Sheet):
    for i in range(40):  # hatching
        sheet.line(OX + 20 + i * 18, OY + 20, OX + 20 + i * 18 + 15, OY + 35, 0.2)
    sheet.stroke_rect(OX + 420, OY + 20, 90, 200, 0.4)  # furniture outlines
    sheet.stroke_rect(OX + 100, OY + 330, 200, 90, 0.4)
    sheet.stroke_rect(OX + 120, OY + 340, 45, 45, 0.4)
    sheet.line(OX, OY - 80, OX + 800, OY - 80, 0.4)  # dimension line with ticks
    sheet.line(OX, OY - 90, OX, OY - 70, 0.4)
    sheet.line(OX + 800, OY - 90, OX + 800, OY - 70, 0.4)


def _walls(sheet: _Sheet, style: str):
    if style == "filled":
        for x, y, w, h in FILLED:
            sheet.fill_rect(x + OX, y + OY, w, h)
    else:  # "lines": parallel thin strokes
        for x, y, w, h in OUTLINES:
            sheet.stroke_rect(x + OX, y + OY, w, h, 0.5)
        for x1, y1, x2, y2 in LINES:
            sheet.line(x1 + OX, y1 + OY, x2 + OX, y2 + OY, 0.5)


def _scale_texts(sheet: _Sheet, texts: list[str]):
    font = _hebrew_font()
    for i, label in enumerate(texts):
        if font and i == 0:
            sheet.text(OX, OY + 620, f'קנ"מ {label}', 12, font)
        else:
            sheet.text(OX + i * 200, OY + 660, f"SCALE {label}" if i == 0 else label, 12)


def apartment(path: Path, ratio: int = 50, style: str = "filled", scale_texts: list[str] | None = None) -> Path:
    """Single-page apartment. scale_texts=None prints "1:<ratio>"; [] prints no scale at all."""
    texts = [f"1:{ratio}"] if scale_texts is None else scale_texts
    sheet = _Sheet(path, ratio)
    _walls(sheet, style)
    _noise(sheet)
    _scale_texts(sheet, texts)
    sheet.pdf.save()
    return path


# ---------------------------------------------------------------- "realistic" contractor sheet (A2 at 1:20)

# Footprint centre lines (x1, y1, x2, y2, thickness) in footprint cm; the partition at x=350 has a 90 cm door opening.
REAL_WALLS = [
    (0, 0, 700, 0, 20),
    (0, 450, 700, 450, 20),
    (0, 0, 0, 450, 20),
    (700, 0, 700, 450, 20),
    (350, 0, 350, 170, 10),
    (350, 260, 350, 450, 10),
    (350, 330, 700, 330, 10),
    (0, 300, 120, 300, 10),
]
REAL_OX, REAL_OY = 100, 130  # footprint offset on the sheet, cm
REAL_TITLE_BLOCK = (890, 10, 288, 820)  # x, y, w, h on the sheet, cm
REAL_LEGEND = (100, 700, 760, 100)

# 7-segment style digits on a 6 x 10 grid, as polylines: scale text drawn as vector outlines, not as text.
_GLYPHS = {
    "1": [[(1, 2), (3, 0), (3, 10)]],
    "2": [[(0, 2), (1, 0.5), (5, 0.5), (6, 2), (6, 4.5), (0, 10), (6, 10)]],
    "0": [[(0, 0), (6, 0), (6, 10), (0, 10), (0, 0)]],
}


def real_truth() -> list[tuple[float, float, float, float, float]]:
    """Expected walls of the realistic sheet in importer coordinates (outer faces start at 0, 0)."""
    return [(x1 + 10, y1 + 10, x2 + 10, y2 + 10, t) for x1, y1, x2, y2, t in REAL_WALLS]


def _hatched_band(sheet: _Sheet, horizontal: bool, c: float, a: float, b: float, t: float, ox: float, oy: float):
    """Two thin lines t apart plus 45 degree hatching between them, as drawn in contractor plans."""
    step = 1.3 * t
    if horizontal:
        sheet.line(a + ox, c - t / 2 + oy, b + ox, c - t / 2 + oy, 0.5)
        sheet.line(a + ox, c + t / 2 + oy, b + ox, c + t / 2 + oy, 0.5)
        x = a
        while x + t <= b:
            sheet.line(x + ox, c - t / 2 + oy, x + t + ox, c + t / 2 + oy, 0.2)
            x += step
    else:
        sheet.line(c - t / 2 + ox, a + oy, c - t / 2 + ox, b + oy, 0.5)
        sheet.line(c + t / 2 + ox, a + oy, c + t / 2 + ox, b + oy, 0.5)
        y = a
        while y + t <= b:
            sheet.line(c - t / 2 + ox, y + oy, c + t / 2 + ox, y + t + oy, 0.2)
            y += step


def _outline_text(sheet: _Sheet, x: float, y: float, s: str, size_cm: float = 14):
    k = size_cm / 10
    cx = x
    for ch in s:
        if ch == ":":
            for dy in (3, 7):
                sheet.fill_rect(cx + 1 * k, y + dy * k, 1.2 * k, 1.2 * k)
            cx += 4 * k
            continue
        for stroke in _GLYPHS[ch]:
            for (px, py), (qx, qy) in zip(stroke, stroke[1:]):
                sheet.line(cx + px * k, y + py * k, cx + qx * k, y + qy * k, 0.8)
        cx += 9 * k


def realistic(path: Path, with_stray: bool = True) -> Path:
    """A2 sheet at 1:20: hatched double-line walls with a door opening, dimension lines, furniture outlines,
    a title block (box on the frame with table rows and text), a legend table at the bottom, scale text drawn
    as vector outlines (no extractable "1:20") and one long thin line pair crossing the plan."""
    ox, oy = REAL_OX, REAL_OY
    sheet = _Sheet(path, 20, width_cm=1188, height_cm=840)
    sheet.stroke_rect(10, 10, 1168, 820, 0.6)  # drawing frame

    # walls: outer and inner outline of the exterior, hatched bands, partitions with the door opening
    sheet.stroke_rect(ox - 10, oy - 10, 720, 470, 0.5)
    sheet.stroke_rect(ox + 10, oy + 10, 680, 430, 0.5)
    _hatched_band(sheet, True, 0, -10, 710, 20, ox, oy)
    _hatched_band(sheet, True, 450, -10, 710, 20, ox, oy)
    _hatched_band(sheet, False, 0, 10, 440, 20, ox, oy)
    _hatched_band(sheet, False, 700, 10, 440, 20, ox, oy)
    _hatched_band(sheet, False, 350, 10, 170, 10, ox, oy)
    _hatched_band(sheet, False, 350, 260, 440, 10, ox, oy)
    _hatched_band(sheet, True, 330, 360, 690, 10, ox, oy)
    _hatched_band(sheet, True, 300, 10, 120, 10, ox, oy)

    # door swing and leaf in the opening
    sheet.pdf.setLineWidth(0.3)
    sheet.pdf.arc(sheet.x(ox + 350 - 90), sheet.y(oy + 260 + 90), sheet.x(ox + 350 + 90), sheet.y(oy + 260 - 90), 90, 90)
    sheet.line(ox + 350, oy + 260, ox + 350 - 90, oy + 260, 0.3)

    # dimension lines with ticks, furniture outlines (kept clear of the walls), a round table
    sheet.line(ox - 10, oy - 70, ox + 710, oy - 70, 0.4)
    for x in (ox - 10, ox + 350, ox + 710):
        sheet.line(x, oy - 80, x, oy - 60, 0.4)
    sheet.stroke_rect(ox + 440, oy + 70, 160, 190, 0.4)  # bed
    sheet.stroke_rect(ox + 440, oy + 270, 70, 25, 0.4)
    sheet.stroke_rect(ox + 60, oy + 360, 200, 70, 0.4)  # sofa
    sheet.pdf.setLineWidth(0.4)
    sheet.pdf.circle(sheet.x(ox + 200), sheet.y(oy + 160), 45 * sheet.k, stroke=1, fill=0)
    sheet.text(ox + 450, oy + 300, "Bedroom 12.4", 7)
    sheet.text(ox + 70, oy + 395, "Living", 7)

    # title block: a box on the frame with 38 equally spaced rows, two columns and lots of text
    tx, ty, tw, th = REAL_TITLE_BLOCK
    sheet.stroke_rect(tx, ty, tw, th, 0.6)
    for i in range(1, 38):
        sheet.line(tx, ty + 20 * i + 10, tx + tw, ty + 20 * i + 10, 0.3)
    for dx in (90, 200):
        sheet.line(tx + dx, ty + 10, tx + dx, ty + 770, 0.3)
    for i in range(36):
        sheet.text(tx + 8, ty + 20 * i + 24, f"Item {i} note", 6)
        sheet.text(tx + 98, ty + 20 * i + 24, f"Rev {i % 7}", 6)
    _outline_text(sheet, tx + 20, ty + 790, "1:20")
    sheet.text(tx + 100, ty + 800, "Scale", 7)

    # legend table at the bottom: 5 equally spaced rows, 4 columns, text
    lx, ly, lw, lh = REAL_LEGEND
    for i in range(6):
        sheet.line(lx, ly + 20 * i, lx + lw, ly + 20 * i, 0.4)
    for j in range(5):
        sheet.line(lx + j * lw / 4, ly, lx + j * lw / 4, ly + lh, 0.4)
    for i in range(5):
        for j in range(4):
            sheet.text(lx + j * lw / 4 + 6, ly + 20 * i + 14, f"Legend {i}.{j}", 6)

    if with_stray:  # an axis line with its parallel neighbour, running right through the plan
        sheet.line(ox - 60, oy + 160, ox + 760, oy + 160, 0.3)
        sheet.line(ox - 60, oy + 185, ox + 760, oy + 185, 0.3)
    sheet.pdf.save()
    return path


def both_scales(path: Path) -> Path:
    """A 1:50 plan with a second, 1:20 detail label on the sheet."""
    return apartment(path, 50, scale_texts=["1:50", "1:20"])


def image_only(path: Path) -> Path:
    """A scan: the walls exist only as pixels in one embedded raster image, no vector walls, no text."""
    from PIL import Image, ImageDraw

    sheet = _Sheet(path, 50)
    img = Image.new("RGB", (1500, 1000), "white")
    d = ImageDraw.Draw(img)
    for x, y, w, h in FILLED:
        d.rectangle([x + OX, y + OY, x + OX + w, y + OY + h], fill="black")
    buf = io.BytesIO()
    img.save(buf, "PNG")
    buf.seek(0)
    sheet.pdf.drawImage(ImageReader(buf), 0, 0, width=1500 * sheet.k, height=1000 * sheet.k)
    sheet.pdf.save()
    return path


def two_pages(path: Path) -> Path:
    """Page 1 is a text-only cover sheet, page 2 holds the plan at 1:50."""
    sheet = _Sheet(path, 50)
    sheet.text(100, 200, "Cover sheet", 18)
    sheet.pdf.showPage()
    # Same sheet size on page 2; drawing continues on the same canvas.
    _walls(sheet, "filled")
    _noise(sheet)
    _scale_texts(sheet, ["1:50"])
    sheet.pdf.save()
    return path


def corrupt(path: Path) -> Path:
    path.write_bytes(b"%PDF-1.7\n" + os.urandom(2048))
    return path


def not_a_pdf(path: Path) -> Path:
    path.write_text("just some text, not a drawing\n" * 20)
    return path


def too_large(path: Path) -> Path:
    """A valid-looking header followed by padding, over the 20 MB limit."""
    with path.open("wb") as f:
        f.write(b"%PDF-1.7\n")
        f.truncate(21 * 1024 * 1024)
    return path
