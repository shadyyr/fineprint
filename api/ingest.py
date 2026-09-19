"""PDF ingestion: text with exact geometry, plus page images for layout context.

Produces the numbered line dump that is the *authoritative* source for
extraction. The model cites these line ids; it never produces coordinates.

Two things here are load-bearing:

1. Per-character boxes. `rawdict` gives a bbox for every glyph, so narrowing a
   highlight to a substring ("$3,500" inside a full row) is exact rather than
   interpolated from font metrics.

2. Rotation. PyMuPDF reports geometry on the *unrotated* page, while pdf.js
   applies /Rotate when it builds a viewport. Left alone, every highlight on a
   rotated PDF lands in the wrong place. `page.rotation_matrix` maps our boxes
   into the same space pdf.js will render, and normalization then uses the
   rotated page dimensions.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass, field

import pymupdf

# A page with less text than this is treated as having no usable text layer.
# Well below any real one-page award letter, high enough to ignore the stray
# characters a scanner sometimes leaves behind.
MIN_CHARS_PER_PAGE = 120

# Raster resolution for the layout-context images sent to the model.
CONTEXT_IMAGE_DPI = 130

BBox = tuple[float, float, float, float]


@dataclass
class LayoutLine:
    """One line of extracted text with its geometry.

    `bbox` and `char_boxes` are normalized to 0-1 with a top-left origin,
    already rotated, so they can be multiplied straight against a pdf.js
    viewport without further conversion.
    """

    line_id: str
    page: int
    text: str
    bbox: BBox
    char_boxes: list[BBox] = field(repr=False, default_factory=list)

    def substring_bbox(self, start: int, end: int) -> BBox | None:
        """Union of the character boxes covering text[start:end]."""
        boxes = self.char_boxes[start:end]
        if not boxes:
            return None
        return (
            min(b[0] for b in boxes),
            min(b[1] for b in boxes),
            max(b[2] for b in boxes),
            max(b[3] for b in boxes),
        )


@dataclass
class PageRender:
    page: int
    width_pt: float
    height_pt: float
    rotation: int
    png_b64: str = field(repr=False, default="")


@dataclass
class IngestResult:
    lines: list[LayoutLine]
    pages: list[PageRender]
    char_count: int

    @property
    def text_layer_sufficient(self) -> bool:
        return bool(self.pages) and self.char_count >= MIN_CHARS_PER_PAGE * len(self.pages)

    def line_map(self) -> dict[str, LayoutLine]:
        return {ln.line_id: ln for ln in self.lines}

    def numbered_dump(self) -> str:
        """The authoritative text the model reads and cites.

        Page breaks are labelled so the model can reason about which page a
        condition appears on without being given coordinates.
        """
        out: list[str] = []
        current: int | None = None
        for ln in self.lines:
            if ln.page != current:
                out.append(f"--- PAGE {ln.page} ---")
                current = ln.page
            out.append(f"[{ln.line_id}] {ln.text}")
        return "\n".join(out)


def _normalize(
    rect: pymupdf.Rect, matrix: pymupdf.Matrix, width: float, height: float
) -> BBox:
    """Map an unrotated PyMuPDF rect into normalized, rotated, top-left space."""
    r = rect * matrix
    # The rotation can invert edge order; normalize() restores x0<=x1, y0<=y1.
    r.normalize()
    return (
        max(0.0, r.x0 / width),
        max(0.0, r.y0 / height),
        min(1.0, r.x1 / width),
        min(1.0, r.y1 / height),
    )


def ingest(pdf_bytes: bytes, *, render_images: bool = True) -> IngestResult:
    """Extract lines, geometry and page images from a PDF."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")

    lines: list[LayoutLine] = []
    pages: list[PageRender] = []
    char_count = 0

    try:
        for index, page in enumerate(doc, start=1):
            rotation = page.rotation
            matrix = page.rotation_matrix

            # page.rect is already the displayed (rotated) rectangle, which is
            # what pdf.js sizes its viewport from.
            width = page.rect.width
            height = page.rect.height

            raw = page.get_text("rawdict")

            line_no = 0
            page_lines: list[LayoutLine] = []

            for block in raw.get("blocks", []):
                # type 0 is text; images have no characters to cite.
                if block.get("type") != 0:
                    continue
                for line in block.get("lines", []):
                    text_parts: list[str] = []
                    char_boxes: list[BBox] = []

                    for span in line.get("spans", []):
                        for ch in span.get("chars", []):
                            text_parts.append(ch["c"])
                            char_boxes.append(
                                _normalize(
                                    pymupdf.Rect(ch["bbox"]), matrix, width, height
                                )
                            )

                    text = "".join(text_parts).rstrip()
                    if not text.strip():
                        continue
                    # rstrip may have dropped trailing glyphs; keep them aligned.
                    char_boxes = char_boxes[: len(text)]

                    line_no += 1
                    bbox = (
                        min(b[0] for b in char_boxes),
                        min(b[1] for b in char_boxes),
                        max(b[2] for b in char_boxes),
                        max(b[3] for b in char_boxes),
                    )
                    page_lines.append(
                        LayoutLine(
                            line_id=f"p{index}_l{line_no}",
                            page=index,
                            text=text,
                            bbox=bbox,
                            char_boxes=char_boxes,
                        )
                    )
                    char_count += len(text)

            # Reading order: top to bottom, then left to right. PDF content
            # streams are not required to be ordered, and a two-column layout
            # would otherwise interleave.
            page_lines.sort(key=lambda l: (round(l.bbox[1], 4), l.bbox[0]))
            for n, ln in enumerate(page_lines, start=1):
                ln.line_id = f"p{index}_l{n}"
            lines.extend(page_lines)

            png_b64 = ""
            if render_images:
                pix = page.get_pixmap(dpi=CONTEXT_IMAGE_DPI)
                png_b64 = base64.b64encode(pix.tobytes("png")).decode("ascii")

            pages.append(
                PageRender(
                    page=index,
                    width_pt=width,
                    height_pt=height,
                    rotation=rotation,
                    png_b64=png_b64,
                )
            )
    finally:
        doc.close()

    return IngestResult(lines=lines, pages=pages, char_count=char_count)
