"""Single source of truth for the FinePrint synthetic sample offer letter.

Both the PDF generator (scripts/make_sample_pdf.py) and the fixture generator
(scripts/make_fixture.py) consume this module, so the committed fixture's
bounding boxes are guaranteed to describe the committed PDF. That property is
what lets /debug/boxes validate against known-good ground truth in M3.

Deliberately dependency-free: exact Adobe Helvetica AFM advance widths are
inlined below, so text extents are computed identically to how ReportLab will
lay them out with the same base-14 font.

The letter is synthetic. "Meridian State University" and the student named in
it do not exist. Per master context section 6.11, never substitute a real
student's aid letter here.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# --- Page geometry (US Letter, portrait, unrotated) -------------------------

PAGE_WIDTH = 612.0
PAGE_HEIGHT = 792.0
ROTATION = 0

LEFT = 72.0           # body text / section heading x
TABLE_LEFT = 90.0     # table rows are indented under their section heading
AMOUNT_RIGHT = 380.0  # table amounts are right-aligned to this x

# --- Adobe Helvetica / Helvetica-Bold advance widths (units per 1000em) -----
# Only the glyphs this letter uses. Missing glyphs fall back to 556.

_REGULAR = {
    " ": 278, "!": 278, '"': 355, "#": 556, "$": 556, "%": 889, "&": 667,
    "'": 191, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333,
    ".": 278, "/": 278, ":": 278, ";": 278, "?": 556, "@": 1015,
    "A": 667, "B": 667, "C": 722, "D": 722, "E": 667, "F": 611, "G": 778,
    "H": 722, "I": 278, "J": 500, "K": 667, "L": 556, "M": 833, "N": 722,
    "O": 778, "P": 667, "Q": 778, "R": 722, "S": 667, "T": 611, "U": 722,
    "V": 667, "W": 944, "X": 667, "Y": 667, "Z": 611,
    "a": 556, "b": 556, "c": 500, "d": 556, "e": 556, "f": 278, "g": 556,
    "h": 556, "i": 222, "j": 222, "k": 500, "l": 222, "m": 833, "n": 556,
    "o": 556, "p": 556, "q": 556, "r": 333, "s": 500, "t": 278, "u": 556,
    "v": 500, "w": 722, "x": 500, "y": 500, "z": 500,
    "–": 556, "’": 191, "·": 278,
}
for _d in "0123456789":
    _REGULAR[_d] = 556

_BOLD = {
    " ": 278, "!": 333, '"': 474, "#": 556, "$": 556, "%": 889, "&": 722,
    "'": 238, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333,
    ".": 278, "/": 278, ":": 333, ";": 333, "?": 611, "@": 975,
    "A": 722, "B": 722, "C": 722, "D": 722, "E": 667, "F": 611, "G": 778,
    "H": 722, "I": 278, "J": 556, "K": 722, "L": 611, "M": 833, "N": 722,
    "O": 778, "P": 667, "Q": 778, "R": 722, "S": 667, "T": 611, "U": 722,
    "V": 667, "W": 944, "X": 667, "Y": 667, "Z": 611,
    "a": 556, "b": 611, "c": 556, "d": 611, "e": 556, "f": 333, "g": 611,
    "h": 611, "i": 278, "j": 278, "k": 556, "l": 278, "m": 889, "n": 611,
    "o": 611, "p": 611, "q": 611, "r": 389, "s": 556, "t": 333, "u": 611,
    "v": 556, "w": 778, "x": 556, "y": 556, "z": 500,
    "–": 556, "’": 238, "·": 278,
}
for _d in "0123456789":
    _BOLD[_d] = 556


def string_width(text: str, font: str, size: float) -> float:
    """Advance width of `text` in points. Matches ReportLab's stringWidth."""
    table = _BOLD if font.endswith("Bold") else _REGULAR
    return sum(table.get(ch, 556) for ch in text) * size / 1000.0


# --- Line model -------------------------------------------------------------


@dataclass
class Line:
    """One rendered text line, positioned by its baseline.

    `text` is the full visible string, already including the dot leader and
    right-aligned amount for table rows, so the PDF and the extracted text
    layer contain byte-identical content.
    """

    page: int
    x: float          # left edge of the drawn string
    baseline: float   # distance from page top to the text baseline
    text: str
    font: str = "Helvetica"
    size: float = 10.0
    key: str | None = None  # stable handle for fixture evidence lookup

    @property
    def width(self) -> float:
        return string_width(self.text, self.font, self.size)

    def bbox(self) -> tuple[float, float, float, float]:
        """Normalized [x0, y0, x1, y1], 0-1, top-left origin.

        Matches PyMuPDF's convention (top-left origin) and therefore pdf.js's
        viewport space. Ascent/descent use the Helvetica nominal 0.718/0.207
        em ratios so the box hugs the glyphs rather than the full line box.
        """
        ascent = self.size * 0.718
        descent = self.size * 0.207
        return (
            self.x / PAGE_WIDTH,
            (self.baseline - ascent) / PAGE_HEIGHT,
            (self.x + self.width) / PAGE_WIDTH,
            (self.baseline + descent) / PAGE_HEIGHT,
        )

    def substring_bbox(self, quote: str) -> tuple[float, float, float, float]:
        """Normalized bbox tightened to `quote` within this line.

        Interpolates by advance width, which is exact for a single-font line.
        This is the same narrowing the API performs in evidence.py, so a
        highlight can land on just the amount instead of the whole row.
        """
        idx = self.text.find(quote)
        if idx < 0:
            raise ValueError(f"quote {quote!r} not present in line {self.text!r}")
        pre = string_width(self.text[:idx], self.font, self.size)
        span = string_width(quote, self.font, self.size)
        ascent = self.size * 0.718
        descent = self.size * 0.207
        return (
            (self.x + pre) / PAGE_WIDTH,
            (self.baseline - ascent) / PAGE_HEIGHT,
            (self.x + pre + span) / PAGE_WIDTH,
            (self.baseline + descent) / PAGE_HEIGHT,
        )


def row(page: int, baseline: float, label: str, amount: str, key: str,
        font: str = "Helvetica", size: float = 10.0) -> Line:
    """A table row: label, dot leader, right-aligned amount.

    The leader is padded so the amount's right edge lands on AMOUNT_RIGHT,
    which is what makes the generated PDF look like a real award letter
    rather than two loose columns.
    """
    dot_w = string_width(".", font, size)
    label_w = string_width(label + " ", font, size)
    amount_w = string_width(" " + amount, font, size)
    gap = AMOUNT_RIGHT - TABLE_LEFT - label_w - amount_w
    n_dots = max(2, int(gap // dot_w))
    text = f"{label} {'.' * n_dots} {amount}"
    return Line(page=page, x=TABLE_LEFT, baseline=baseline, text=text,
                font=font, size=size, key=key)


# --- The letter -------------------------------------------------------------

LEAD = 14.0  # default baseline-to-baseline spacing


def build_lines() -> list[Line]:
    L: list[Line] = []

    # ---------------- Page 1: letterhead, costs, aid table ----------------
    L.append(Line(1, LEFT, 80, "MERIDIAN STATE UNIVERSITY", "Helvetica-Bold", 16, key="hdr_school"))
    L.append(Line(1, LEFT, 96, "Office of Student Financial Aid", "Helvetica", 9.5))
    L.append(Line(1, LEFT, 109, "1400 University Avenue · Meridian, IL 60555", "Helvetica", 9.5))

    L.append(Line(1, LEFT, 146, "2026–2027 FINANCIAL AID OFFER", "Helvetica-Bold", 13, key="hdr_title"))

    L.append(Line(1, LEFT, 172, "Student: Jordan A. Rivera", "Helvetica", 10, key="hdr_student"))
    L.append(Line(1, LEFT, 186, "Student ID: MSU-00418822", "Helvetica", 10))
    L.append(Line(1, LEFT, 200, "Date: March 14, 2026", "Helvetica", 10))

    L.append(Line(1, LEFT, 230, "Dear Jordan,", "Helvetica", 10))
    L.append(Line(1, LEFT, 252, "Congratulations on your admission to Meridian State University. We are pleased to", "Helvetica", 10))
    L.append(Line(1, LEFT, 266, "offer you the following financial aid package for the 2026–2027 academic year.", "Helvetica", 10))

    # The misleading headline. This is the number the demo opens on.
    L.append(Line(1, LEFT, 300, "TOTAL FINANCIAL AID PACKAGE:  $45,400", "Helvetica-Bold", 14, key="headline_total"))

    L.append(Line(1, LEFT, 340, "ESTIMATED COST OF ATTENDANCE", "Helvetica-Bold", 11, key="sec_costs"))
    L.append(row(1, 362, "Tuition and Fees", "$34,800", key="cost_tuition"))
    L.append(row(1, 378, "Housing (Standard Double Room)", "$9,200", key="cost_housing"))
    L.append(row(1, 394, "Meal Plan (Silver, 14 meals per week)", "$6,100", key="cost_meals"))
    L.append(row(1, 410, "Direct Billed Costs", "$50,100", key="cost_direct_subtotal",
                 font="Helvetica-Bold"))
    L.append(row(1, 426, "Books and Supplies (estimated)", "$1,200", key="cost_books"))
    L.append(row(1, 442, "Total Cost of Attendance", "$51,300", key="cost_coa_total",
                 font="Helvetica-Bold"))

    L.append(Line(1, LEFT, 482, "YOUR FINANCIAL AID OFFER", "Helvetica-Bold", 11, key="sec_aid"))
    L.append(row(1, 504, "Meridian Opportunity Grant", "$12,400", key="aid_meridian_grant"))
    L.append(row(1, 520, "Federal Pell Grant", "$4,500", key="aid_pell"))
    # No period stated anywhere on this row. The prose on page 2 says
    # "renewable for up to four years", which does not disambiguate whether
    # $20,000 is per year or the four-year total. This is the demo ambiguity.
    L.append(row(1, 536, "Presidential Merit Scholarship", "$20,000", key="aid_merit"))
    L.append(row(1, 552, "Federal Direct Subsidized Loan", "$3,500", key="aid_sub_loan"))
    L.append(row(1, 568, "Federal Direct Unsubsidized Loan", "$2,000", key="aid_unsub_loan"))
    L.append(row(1, 584, "Federal Work-Study", "$3,000", key="aid_work_study"))
    L.append(row(1, 600, "Total Financial Aid Package", "$45,400", key="aid_package_total",
                 font="Helvetica-Bold"))

    L.append(Line(1, LEFT, 636, "Please review the important information on the following page before", "Helvetica", 9.5))
    L.append(Line(1, LEFT, 649, "accepting or declining any portion of this offer.", "Helvetica", 9.5))

    L.append(Line(1, LEFT, 720, "Meridian State University · Office of Student Financial Aid · Page 1 of 2", "Helvetica", 8))

    # ---------------- Page 2: conditions and terms ----------------
    # Conditions live on page 2 on purpose: clicking the scholarship in the
    # analysis panel jumps the viewer to a different page, which is the
    # section 7.3 interaction the demo is built around.
    L.append(Line(2, LEFT, 80, "IMPORTANT INFORMATION ABOUT YOUR AWARD", "Helvetica-Bold", 12, key="sec_conditions"))

    L.append(Line(2, LEFT, 112, "Presidential Merit Scholarship", "Helvetica-Bold", 10, key="cond_merit_head"))
    L.append(Line(2, LEFT, 128, "The Presidential Merit Scholarship is renewable for up to four years of undergraduate", "Helvetica", 10, key="cond_merit_1"))
    L.append(Line(2, LEFT, 142, "study, contingent upon maintaining a cumulative grade point average of 3.25 or higher", "Helvetica", 10, key="cond_merit_2"))
    L.append(Line(2, LEFT, 156, "and enrollment in at least 12 credit hours per semester.", "Helvetica", 10, key="cond_merit_3"))

    L.append(Line(2, LEFT, 188, "Federal Direct Loans", "Helvetica-Bold", 10, key="cond_loans_head"))
    L.append(Line(2, LEFT, 204, "Federal Direct Loans must be repaid with interest. You are not required to accept the", "Helvetica", 10, key="cond_loans_1"))
    L.append(Line(2, LEFT, 218, "full loan amount offered. Interest rates are set annually by the U.S. Department of", "Helvetica", 10, key="cond_loans_2"))
    L.append(Line(2, LEFT, 232, "Education and are not included in this offer.", "Helvetica", 10, key="cond_loans_3"))

    L.append(Line(2, LEFT, 264, "Federal Work-Study", "Helvetica-Bold", 10, key="cond_ws_head"))
    L.append(Line(2, LEFT, 280, "Federal Work-Study is an opportunity to earn wages through approved part-time", "Helvetica", 10, key="cond_ws_1"))
    L.append(Line(2, LEFT, 294, "employment. Earnings are paid biweekly for hours actually worked and are not", "Helvetica", 10, key="cond_ws_2"))
    L.append(Line(2, LEFT, 308, "credited directly to your student account.", "Helvetica", 10, key="cond_ws_3"))

    L.append(Line(2, LEFT, 340, "Costs Not Included", "Helvetica-Bold", 10, key="cond_missing_head"))
    # Names the gap without quantifying it. FinePrint must surface these as
    # missing rather than inventing amounts (master context section 15).
    L.append(Line(2, LEFT, 356, "This offer reflects direct billed costs and estimated books and supplies. It does not", "Helvetica", 10, key="cond_missing_1"))
    L.append(Line(2, LEFT, 370, "include transportation, personal expenses, or health insurance, which vary by student.", "Helvetica", 10, key="cond_missing_2"))

    L.append(Line(2, LEFT, 402, "Your award is based on the information reported on your 2026–2027 FAFSA and is", "Helvetica", 10, key="cond_fafsa_1"))
    L.append(Line(2, LEFT, 416, "subject to revision if that information changes or if additional aid is received.", "Helvetica", 10, key="cond_fafsa_2"))

    L.append(Line(2, LEFT, 720, "Meridian State University · Office of Student Financial Aid · Page 2 of 2", "Helvetica", 8))

    return L


def lines_by_key() -> dict[str, Line]:
    return {ln.key: ln for ln in build_lines() if ln.key}


def line_ids() -> dict[str, str]:
    """Map content key -> the line_id the ingest pipeline will assign.

    Ingest numbers lines per page in reading order as p{page}_l{index}, so
    this mirrors that numbering for the committed fixture.
    """
    ids: dict[str, str] = {}
    counters: dict[int, int] = {}
    for ln in build_lines():
        counters[ln.page] = counters.get(ln.page, 0) + 1
        if ln.key:
            ids[ln.key] = f"p{ln.page}_l{counters[ln.page]}"
    return ids
