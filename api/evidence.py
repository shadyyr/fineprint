"""The admission gate.

No financial fact enters the canonical model unless it links to extracted
source text and survives deterministic verification against it. This module is
where that is enforced, and it is the answer to "how do you know the model did
not make this up?"

A claim must clear three checks:

  1. The cited line_id exists in the document's text layer.
  2. The quoted text really occurs in that line.
  3. The amount re-parsed from that text equals the amount claimed.

Anything that fails becomes an UnverifiedClaim: shown to the user as an
unconfirmed observation, excluded from every calculation. It never reaches
`costs` or `aid`.

Matching tolerates typographic noise but not semantic drift. Case and runs of
whitespace or dot-leader characters are normalized away, because those carry no
meaning in an award letter. The amount itself is compared exactly.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ingest import LayoutLine
from models import (
    Evidence,
    ExtractionCitation,
    UnverifiedClaim,
    Verification,
)

# Characters that act as filler in an award letter's layout: whitespace and
# the dot/ellipsis leaders that pad a label out to its amount.
_FILLER = set(" \t\n\r .·•…_")

_AMOUNT_RE = re.compile(r"\$?\s?-?[\d,]+(?:\.\d{1,2})?")


def parse_amount(text: str) -> float | None:
    """Parse the first monetary amount in `text`, or None."""
    match = _AMOUNT_RE.search(text)
    if not match:
        return None
    cleaned = match.group(0).replace("$", "").replace(",", "").replace(" ", "")
    try:
        return float(cleaned)
    except ValueError:
        return None


def all_amounts(text: str) -> list[float]:
    out: list[float] = []
    for raw in _AMOUNT_RE.findall(text):
        cleaned = raw.replace("$", "").replace(",", "").replace(" ", "")
        try:
            out.append(float(cleaned))
        except ValueError:
            continue
    return out


def _normalize(text: str) -> tuple[str, list[int]]:
    """Normalize for matching, keeping a map back to original indices.

    Returns (normalized_text, index_map) where index_map[i] is the offset in
    the original string that normalized character i came from. The map is what
    lets a match on the normalized form still produce an exact bounding box.
    """
    chars: list[str] = []
    index_map: list[int] = []
    in_filler = False

    for i, ch in enumerate(text):
        if ch in _FILLER:
            if not in_filler and chars:
                chars.append(" ")
                index_map.append(i)
            in_filler = True
        else:
            chars.append(ch.lower())
            index_map.append(i)
            in_filler = False

    while chars and chars[-1] == " ":
        chars.pop()
        index_map.pop()

    return "".join(chars), index_map


def locate(quote: str, line_text: str) -> tuple[int, int] | None:
    """Find `quote` inside `line_text`, returning original-string offsets."""
    exact = line_text.find(quote)
    if exact >= 0:
        return exact, exact + len(quote)

    norm_line, index_map = _normalize(line_text)
    norm_quote, _ = _normalize(quote)
    if not norm_quote:
        return None

    at = norm_line.find(norm_quote)
    if at < 0:
        return None

    start = index_map[at]
    end = index_map[at + len(norm_quote) - 1] + 1
    return start, end


@dataclass
class Resolution:
    """Outcome of verifying one claim's citations."""

    evidence: list[Evidence]
    failure: UnverifiedClaim | None = None

    @property
    def ok(self) -> bool:
        return self.failure is None


class EvidenceResolver:
    """Resolves model citations into verified, coordinate-bearing evidence."""

    def __init__(self, lines: dict[str, LayoutLine]) -> None:
        self._lines = lines
        self._seq = 0
        self._unverified_seq = 0

    def _next_id(self, prefix: str) -> str:
        self._seq += 1
        return f"ev_{prefix}_{self._seq}"

    def _next_unverified_id(self, prefix: str) -> str:
        # Failure paths can exit before evidence sequencing advances (for
        # example, two nonexistent line ids). Keep a separate counter so
        # multiple rejected claims never receive the same canonical id.
        self._unverified_seq += 1
        return f"unv_{prefix}_{self._unverified_seq}"

    def resolve(
        self,
        *,
        label: str,
        amount: float | None,
        citations: list[ExtractionCitation],
        prefix: str = "item",
    ) -> Resolution:
        """Verify one claim. Returns its evidence, or the reason it failed."""
        if not citations:
            return Resolution(
                evidence=[],
                failure=UnverifiedClaim(
                    id=self._next_unverified_id(prefix),
                    claimed_label=label,
                    claimed_amount=amount,
                    cited_line_id=None,
                    reason="no_citation",
                    detail="The model reported this figure without citing any line.",
                ),
            )

        records: list[Evidence] = []
        amount_seen = False

        for citation in citations:
            line = self._lines.get(citation.line_id)
            if line is None:
                return Resolution(
                    evidence=[],
                    failure=UnverifiedClaim(
                        id=self._next_unverified_id(prefix),
                        claimed_label=label,
                        claimed_amount=amount,
                        cited_line_id=citation.line_id,
                        reason="line_not_found",
                        detail=(
                            f"Cited line {citation.line_id} does not exist in this "
                            "document."
                        ),
                    ),
                )

            span = locate(citation.quote, line.text)
            if span is None:
                return Resolution(
                    evidence=[],
                    failure=UnverifiedClaim(
                        id=self._next_unverified_id(prefix),
                        claimed_label=label,
                        claimed_amount=amount,
                        cited_line_id=citation.line_id,
                        reason="quote_not_found",
                        detail=(
                            f"The quoted text does not appear in {citation.line_id}. "
                            f"That line reads: {line.text!r}"
                        ),
                    ),
                )

            start, end = span
            quoted = line.text[start:end]

            # The amount must be present in text the model actually cited.
            # Checking the quoted span rather than the whole line stops a
            # citation from borrowing a number out of a neighbouring column.
            amount_bbox = None
            amount_text = None
            matched_here = False
            if amount is not None:
                for raw in _AMOUNT_RE.finditer(quoted):
                    value = parse_amount(raw.group(0))
                    if value is not None and abs(value - amount) < 0.005:
                        matched_here = True
                        amount_seen = True
                        amount_text = raw.group(0).strip()
                        a_start = start + raw.start()
                        a_end = start + raw.end()
                        amount_bbox = line.substring_bbox(a_start, a_end)
                        break

            bbox = line.substring_bbox(start, end)
            if bbox is None:
                return Resolution(
                    evidence=[],
                    failure=UnverifiedClaim(
                        id=self._next_unverified_id(prefix),
                        claimed_label=label,
                        claimed_amount=amount,
                        cited_line_id=citation.line_id,
                        reason="quote_not_found",
                        detail="The quoted text has no geometry in the document.",
                    ),
                )

            records.append(
                Evidence(
                    id=self._next_id(prefix),
                    line_id=line.line_id,
                    page=line.page,
                    quote=quoted,
                    bbox=list(bbox),
                    amount_bbox=list(amount_bbox) if amount_bbox else None,
                    amount_text=amount_text,
                    verification=Verification(
                        quote_found=True, amount_matched=matched_here
                    ),
                )
            )

        # A priced claim whose amount appears in none of its citations is the
        # dangerous case: the label is real, the number is not.
        if amount is not None and not amount_seen:
            cited = ", ".join(c.line_id for c in citations)
            return Resolution(
                evidence=[],
                failure=UnverifiedClaim(
                    id=self._next_unverified_id(prefix),
                    claimed_label=label,
                    claimed_amount=amount,
                    cited_line_id=citations[0].line_id,
                    reason="amount_mismatch",
                    detail=(
                        f"{amount:,.0f} does not appear in the cited text ({cited})."
                    ),
                ),
            )

        return Resolution(evidence=records)
