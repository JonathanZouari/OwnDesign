"""PNG export: the PDF page rasterised at 300 DPI on white, so both formats show exactly the same sheet."""

import io
import threading

import pypdfium2
from PIL import Image

from app.exports.pdf import ExportInfo, render_pdf
from app.schemas import Geometry

DPI = 300
# PDFium is not thread-safe (pypdfium2 docs, "Incompatibility with Threading"), and routes run in a threadpool:
# every PDFium call goes through this lock, or two parallel PNG exports could crash the whole server process.
PDFIUM = threading.Lock()


def render_png(geometry: Geometry, info: ExportInfo, paper: str) -> bytes:
    pdf = render_pdf(geometry, info, paper)  # reportlab needs no lock
    with PDFIUM:
        document = pypdfium2.PdfDocument(pdf)
        try:
            page = document[0]
            # The standard pixel size of the paper at 300 DPI (A4 is 2480 x 3508).
            size = (round(page.get_width() / 72 * DPI), round(page.get_height() / 72 * DPI))
            image = page.render(scale=DPI / 72, fill_color=(255, 255, 255, 255)).to_pil()
        finally:
            document.close()
    image = image.convert("RGB")
    if image.size != size:  # pdfium rounds up (2481 wide for A4): trim the extra pixel, or pad with white
        image = image.crop((0, 0, *size))
    out = io.BytesIO()
    image.save(out, "PNG", dpi=(DPI, DPI))
    return out.getvalue()
