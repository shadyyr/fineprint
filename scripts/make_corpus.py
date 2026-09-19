"""Generate the synthetic multi-layout validation corpus.

These documents are deliberately fictional and contain no student data.  Each
layout stresses a different extraction assumption:

* ``college_financing_plan.pdf`` -- standardized form/table vocabulary.
* ``narrative_offer.pdf`` -- amounts embedded in prose sentences.
* ``per_term_offer.pdf`` -- Fall/Spring columns plus a period-unknown award.

The checked-in PDFs are generated artifacts, but this script is the source of
truth for their visible text.  Replay responses and hand-checked expectations
live separately under ``corpus/`` so regenerating a PDF cannot silently rewrite
the answer key.

Usage:  .venv/bin/python scripts/make_corpus.py
"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "corpus" / "letters"
WIDTH, HEIGHT = letter

INK = HexColor("#172033")
MUTED = HexColor("#5d6879")
RULE = HexColor("#b9c2cf")
PALE = HexColor("#eef3f8")


def _text(c: canvas.Canvas, x: float, y_from_top: float, value: str,
          *, font: str = "Helvetica", size: float = 10,
          color=INK) -> None:
    c.setFillColor(color)
    c.setFont(font, size)
    c.drawString(x, HEIGHT - y_from_top, value)


def _meta(c: canvas.Canvas, title: str, institution: str) -> None:
    c.setTitle(title)
    c.setAuthor(f"{institution} (fictional synthetic sample)")
    c.setSubject(
        "Synthetic financial-aid document generated for FinePrint validation. "
        "No real institution, applicant, award, or student data."
    )


def _header(c: canvas.Canvas, institution: str, title: str, subtitle: str) -> None:
    _text(c, 54, 58, institution.upper(), font="Helvetica-Bold", size=15)
    _text(c, 54, 79, title, font="Helvetica-Bold", size=12)
    _text(c, 54, 96, subtitle, size=9, color=MUTED)
    c.setStrokeColor(RULE)
    c.setLineWidth(0.8)
    c.line(54, HEIGHT - 106, WIDTH - 54, HEIGHT - 106)


def _footer(c: canvas.Canvas, label: str) -> None:
    _text(
        c,
        54,
        754,
        f"{label} · SYNTHETIC VALIDATION DOCUMENT · NOT A REAL AID OFFER",
        size=7.5,
        color=MUTED,
    )


def college_financing_plan(path: Path) -> None:
    """A Shopping Sheet / College Financing Plan-inspired tabular form."""
    c = canvas.Canvas(str(path), pagesize=letter)
    _meta(c, "Synthetic College Financing Plan", "Harbor City College")
    _header(
        c,
        "Harbor City College",
        "COLLEGE FINANCING PLAN - 2026-2027",
        "Undergraduate on-campus estimate · all figures cover one academic year",
    )

    sections = [
        (
            "ESTIMATED COST OF ATTENDANCE",
            [
                ("Tuition and fees", "$31,200"),
                ("Housing and meals", "$12,800"),
                ("Books and supplies", "$1,100"),
                ("Transportation", "$900"),
                ("Other education costs", "$700"),
                ("Estimated Cost of Attendance", "$46,700"),
            ],
        ),
        (
            "GRANTS AND SCHOLARSHIPS",
            [
                ("Federal Pell Grant", "$6,000"),
                ("State Opportunity Grant", "$2,500"),
                ("Harbor Need-Based Scholarship", "$8,000"),
            ],
        ),
        (
            "LOANS AND WORK OPTIONS",
            [
                ("Federal Direct Subsidized Loan", "$3,500"),
                ("Federal Direct Unsubsidized Loan", "$2,000"),
                ("Federal Work-Study", "$2,400"),
            ],
        ),
    ]

    y = 136
    for heading, rows in sections:
        c.setFillColor(PALE)
        c.rect(54, HEIGHT - y - 18, WIDTH - 108, 20, fill=1, stroke=0)
        _text(c, 62, y + 1, heading, font="Helvetica-Bold", size=9)
        y += 29
        for label, amount in rows:
            bold = label == "Estimated Cost of Attendance"
            font = "Helvetica-Bold" if bold else "Helvetica"
            _text(c, 68, y, label, font=font, size=9.5)
            _text(c, 465, y, amount, font=font, size=9.5)
            c.setStrokeColor(RULE)
            c.setLineWidth(0.25)
            c.line(64, HEIGHT - y - 5, WIDTH - 64, HEIGHT - y - 5)
            y += 23
        y += 12

    _text(
        c,
        54,
        657,
        "All figures above cover the full 2026-2027 academic year.",
        font="Helvetica-Bold",
        size=9,
    )
    _text(
        c,
        54,
        675,
        "Personal expenses and health insurance are not included; no estimates are provided.",
        size=9,
    )
    _text(
        c,
        54,
        696,
        "Work-study is earned through eligible employment and is not credited to the student bill.",
        size=9,
    )
    _footer(c, "Harbor City College")
    c.save()


def narrative_offer(path: Path) -> None:
    """A prose-heavy award letter with amounts inside sentences."""
    c = canvas.Canvas(str(path), pagesize=letter)
    _meta(c, "Synthetic Narrative Financial Aid Award", "Riverbend Liberal Arts College")
    _header(
        c,
        "Riverbend Liberal Arts College",
        "Your 2026-2027 Financial Aid Award",
        "A narrative award notice",
    )

    lines = [
        (140, "Congratulations on your admission. This letter explains the resources available to you."),
        (170, "Your estimated tuition and mandatory fees for the 2026-2027 academic year are $29,750."),
        (192, "Campus housing and meals for the same academic year are estimated at $13,600."),
        (214, "Books and course materials are estimated at $950 for the year."),
        (252, "We have awarded you a Riverbend Access Grant of $11,250 for the 2026-2027 academic year."),
        (274, "You are also eligible for a Founders Scholarship of $18,000."),
        (296, "Your offer includes a Federal Direct Subsidized Loan of $3,500 for the academic year."),
        (318, "A Federal Work-Study opportunity of up to $2,000 is available during the 2026-2027 year."),
        (356, "The Founders Scholarship may be renewed for up to four years if you maintain a 3.20 GPA."),
        (378, "The renewal language does not state whether the $18,000 figure is yearly or a program total."),
        (416, "Loans must be repaid. Work-study is paid as wages only for hours actually worked."),
        (438, "Transportation, personal expenses, and health insurance are not included, and no estimates"),
        (454, "are provided for those costs."),
        (492, "Please review every part of this notice before accepting any loan amount."),
    ]
    for y, value in lines:
        _text(c, 62, y, value, size=9.5)

    c.setStrokeColor(RULE)
    c.roundRect(52, HEIGHT - 476, WIDTH - 104, 354, 5, fill=0, stroke=1)
    _footer(c, "Riverbend Liberal Arts College")
    c.save()


def per_term_offer(path: Path) -> None:
    """A Fall/Spring two-column table with explicit per-semester amounts."""
    c = canvas.Canvas(str(path), pagesize=letter)
    _meta(c, "Synthetic Per-Term Financial Aid Worksheet", "Summit Technical College")
    _header(
        c,
        "Summit Technical College",
        "Financial Aid Worksheet - 2026-2027",
        "Each amount in the Fall and Spring columns applies to that semester only",
    )

    _text(
        c,
        54,
        130,
        "CHARGE OR AWARD                         FALL 2026        SPRING 2027",
        font="Courier-Bold",
        size=9.2,
    )
    c.setStrokeColor(RULE)
    c.line(54, HEIGHT - 139, WIDTH - 54, HEIGHT - 139)

    rows = [
        ("COSTS", None, None),
        ("Tuition", "$14,000", "$14,400"),
        ("Required fees", "$650", "$675"),
        ("Campus housing", "$4,800", "$4,900"),
        ("Meal plan", "$2,900", "$2,950"),
        ("Term Charges", "$22,350", "$22,925"),
        ("AID AND FINANCING", None, None),
        ("Federal Pell Grant", "$3,200", "$3,300"),
        ("Summit STEM Grant", "$4,900", "$5,100"),
        ("Direct Subsidized Loan", "$1,700", "$1,800"),
        ("Direct Unsubsidized Loan", "$950", "$1,050"),
        ("Federal Work-Study", "$1,100", "$1,300"),
        ("Term Aid Package", "$11,850", "$12,550"),
    ]
    y = 165
    for label, fall, spring in rows:
        if fall is None:
            c.setFillColor(PALE)
            c.rect(54, HEIGHT - y - 14, WIDTH - 108, 18, fill=1, stroke=0)
            _text(c, 60, y, label, font="Courier-Bold", size=9.2)
            y += 25
            continue
        row = f"{label:<35}{fall:>12}{spring:>19}"
        font = "Courier-Bold" if label in {"Term Charges", "Term Aid Package"} else "Courier"
        _text(c, 60, y, row, font=font, size=9.2)
        c.setStrokeColor(RULE)
        c.setLineWidth(0.25)
        c.line(58, HEIGHT - y - 5, WIDTH - 58, HEIGHT - y - 5)
        y += 23

    _text(
        c,
        54,
        518,
        "Separate notice: Technology Achievement Scholarship $10,000.",
        font="Helvetica-Bold",
        size=9.5,
    )
    _text(
        c,
        54,
        538,
        "The separate notice does not say whether this scholarship is per semester, per year, or total.",
        size=9,
    )
    _text(c, 54, 568, "Books are required, but this worksheet provides no books estimate.", size=9)
    _text(
        c,
        54,
        588,
        "Transportation, personal expenses, and health insurance are not included.",
        size=9,
    )
    _text(
        c,
        54,
        620,
        "Work-study is earned as wages for hours worked and does not reduce the bill automatically.",
        size=9,
    )
    _footer(c, "Summit Technical College")
    c.save()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    builders = {
        "college_financing_plan.pdf": college_financing_plan,
        "narrative_offer.pdf": narrative_offer,
        "per_term_offer.pdf": per_term_offer,
    }
    for name, build in builders.items():
        path = OUT / name
        build(path)
        print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
