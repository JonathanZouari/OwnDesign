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
