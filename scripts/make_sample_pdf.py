"""Render fixtures/sample_offer.pdf from scripts/letter_content.py.

Draws each line at the exact position letter_content declares, so the text
layer PyMuPDF later extracts is byte-identical to the strings the fixture
quotes, and the geometry matches the fixture's bounding boxes.

ReportLab measures y from the bottom of the page; letter_content measures
baselines from the top, matching PyMuPDF and pdf.js. The single conversion
lives in `_y` below.

Usage:  ../.venv/bin/python make_sample_pdf.py
"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas

from letter_content import PAGE_HEIGHT, PAGE_WIDTH, build_lines

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "fixtures" / "sample_offer.pdf"

RULE = HexColor("#9aa4b2")


def _y(baseline: float) -> float:
    """Top-origin baseline -> ReportLab's bottom-origin y."""
    return PAGE_HEIGHT - baseline


def draw(path: Path) -> None:
    c = canvas.Canvas(str(path), pagesize=(PAGE_WIDTH, PAGE_HEIGHT))
    c.setTitle("2026-2027 Financial Aid Offer")
    c.setAuthor("Meridian State University (synthetic sample)")
    c.setSubject(
        "Synthetic financial aid offer letter generated for FinePrint. "
        "Not a real award letter and not real student data."
    )

    lines = build_lines()
    pages = sorted({ln.page for ln in lines})

    for page in pages:
        for ln in (l for l in lines if l.page == page):
            c.setFont(ln.font, ln.size)
            c.drawString(ln.x, _y(ln.baseline), ln.text)

            # Rule under the letterhead and each section heading, for the
            # look of a real award letter. Purely decorative: no text, so it
            # cannot perturb the extracted line numbering.
            if ln.key in {"hdr_school", "sec_costs", "sec_aid", "sec_conditions"}:
                c.setStrokeColor(RULE)
                c.setLineWidth(0.6)
                y = _y(ln.baseline) - 5
                c.line(ln.x, y, PAGE_WIDTH - 72, y)

        c.showPage()

    c.save()


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    draw(OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size:,} bytes)")
