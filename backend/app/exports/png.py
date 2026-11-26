"""PNG export: the PDF page rasterised at 300 DPI on white, so both formats show exactly the same sheet."""

import io

import pypdfium2
from PIL import Image

from app.exports.pdf import ExportInfo, render_pdf
from app.schemas import Geometry

DPI = 300


def render_png(geometry: Geometry, info: ExportInfo, paper: str) -> bytes:
    document = pypdfium2.PdfDocument(render_pdf(geometry, info, paper))
    try:
        page = document[0]
        # The standard pixel size of the paper at 300 DPI (A4 is 2480 x 3508); pdfium rounds up, so trim the extra pixel.
        size = (round(page.get_width() / 72 * DPI), round(page.get_height() / 72 * DPI))
        rendered = page.render(scale=DPI / 72, fill_color=(255, 255, 255, 255)).to_pil().convert("RGB")
    finally:
        document.close()
    image = Image.new("RGB", size, "white")
    image.paste(rendered.crop((0, 0, min(size[0], rendered.width), min(size[1], rendered.height))))
    out = io.BytesIO()
    image.save(out, "PNG", dpi=(DPI, DPI), optimize=False)
    return out.getvalue()
