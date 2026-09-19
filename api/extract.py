"""Structured extraction.

The model interprets an unstandardized document. It does not do arithmetic, it
does not produce coordinates, and it is not trusted: everything it returns goes
through the admission gate in evidence.py before it can become a fact.

The contract with the model, enforced by the prompt and then verified in code:

  - The numbered text lines are the ONLY source of figures. Every item must
    cite a line_id and quote text from it verbatim.
  - Page images are layout context only -- they disambiguate columns, table
    grouping and which heading governs which row. A number that appears only
    in an image and not in the text lines does not exist.
  - Periods are never inferred. "unknown" is the correct answer whenever the
    document does not say.
"""

from __future__ import annotations

import os
from typing import Protocol

import anthropic

from ingest import IngestResult
from models import ExtractionResult

# The skill's default. Not downgraded for cost: extraction quality is the
# product, and a misread aid letter is the failure mode that matters.
DEFAULT_MODEL = os.environ.get("FINEPRINT_MODEL", "claude-opus-5")

MAX_TOKENS = 16000

SYSTEM = """\
You are a financial-aid document analyst. You convert an unstandardized college \
financial-aid offer letter into structured data.

SOURCE RULES -- these are absolute.

1. The numbered text lines are the ONLY authoritative source. Every item you \
report must cite at least one line_id and include a `quote` copied VERBATIM from \
that line, character for character. Do not paraphrase, reformat, reorder, or \
normalize spacing inside a quote.

2. Page images are layout context ONLY. Use them to understand column structure, \
which rows belong to which table, and which heading governs which amount. Never \
take a figure from an image. If a number is not in the text lines, it does not \
exist for your purposes.

3. Every quote you produce will be checked against the cited line automatically. \
Any item whose quote or amount cannot be found is discarded, so a careless \
citation loses the item entirely. Cite the single line that contains both the \
label and the amount whenever one exists.

CLASSIFICATION RULES.

4. aid_type is the most consequential field you set:
   - "gift": grants and scholarships, not repaid.
   - "loan": any borrowed money, including subsidized, unsubsidized, PLUS and \
private loans. Loans are never gift aid.
   - "work_study": wages earned by working. Not a grant, not guaranteed money.
   - "unknown": use this rather than guessing.

5. period: state a period ONLY if the document establishes it. If a row gives an \
amount with no stated period, set period to "unknown" -- even when the amount \
looks like a typical annual figure, even when other rows on the page are annual, \
and even when renewal language appears elsewhere. Guessing here is the single \
worst error you can make. Raise an ambiguity instead.

6. is_stated_total: set true for rows that total other rows ("Total Cost of \
Attendance", "Total Financial Aid Package", subtotals). Report them, flagged, so \
they are not double counted.

AMBIGUITIES AND GAPS.

7. Raise an ambiguity whenever the document leaves something materially unclear, \
especially an amount whose period is not stated. Give at least two concrete \
options a student could choose between.

8. missing_costs: list cost categories the letter names but does not price, and \
standard categories absent entirely (transportation, personal expenses, health \
insurance). Never invent an amount for them.

Report what the document says, not what a typical offer would say."""


class Extractor(Protocol):
    """Anything that can turn an ingested document into structured claims."""

    def extract(self, result: IngestResult) -> ExtractionResult: ...


def build_user_content(result: IngestResult) -> list[dict]:
    """Assemble the request: authoritative text first, images as context."""
    content: list[dict] = [
        {
            "type": "text",
            "text": (
                "AUTHORITATIVE TEXT LINES. Cite these by line_id and quote them "
                "verbatim. Every figure you report must come from here.\n\n"
                + result.numbered_dump()
            ),
        }
    ]

    for page in result.pages:
        if not page.png_b64:
            continue
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": page.png_b64,
                },
            }
        )
        content.append(
            {
                "type": "text",
                "text": (
                    f"Layout context for page {page.page}. Use it to understand "
                    "the structure only. Do not read figures from it."
                ),
            }
        )

    content.append(
        {
            "type": "text",
            "text": (
                "Extract the costs, aid, ambiguities and missing costs from this "
                "offer. Remember: quote verbatim, cite a line_id for everything, "
                "and use period \"unknown\" wherever the document does not say."
            ),
        }
    )
    return content


class ClaudeExtractor:
    """Structured extraction via the Anthropic API.

    Uses `messages.parse` with a Pydantic output format, so the response is
    schema-validated by the SDK before it reaches us. A malformed payload
    raises here rather than producing a half-populated model.

    Server-side refusal fallbacks are deliberately not enabled: they require
    the beta namespace, which would mean giving up the `parse` helper's
    validation, and reading amounts off an award letter has no realistic
    refusal surface. `stop_reason` is still checked defensively below.
    """

    def __init__(self, *, model: str = DEFAULT_MODEL, api_key: str | None = None):
        self.model = model
        self._client = anthropic.Anthropic(api_key=api_key) if api_key else anthropic.Anthropic()

    def extract(self, result: IngestResult) -> ExtractionResult:
        response = self._client.messages.parse(
            model=self.model,
            max_tokens=MAX_TOKENS,
            # Reading an arbitrary layout and deciding what is genuinely
            # ambiguous is exactly the kind of work adaptive thinking helps.
            thinking={"type": "adaptive"},
            system=SYSTEM,
            messages=[{"role": "user", "content": build_user_content(result)}],
            output_format=ExtractionResult,
        )

        if response.stop_reason == "refusal":
            raise ExtractionRefused(
                "The model declined to analyze this document."
            )

        parsed = response.parsed_output
        if parsed is None:
            raise ExtractionFailed("The model returned no structured output.")
        return parsed


class ReplayExtractor:
    """Returns a canned result. Used by tests and the offline path."""

    def __init__(self, canned: ExtractionResult):
        self._canned = canned

    def extract(self, result: IngestResult) -> ExtractionResult:  # noqa: ARG002
        return self._canned


class ExtractionFailed(RuntimeError):
    """Extraction could not produce a usable structured result."""


class ExtractionRefused(ExtractionFailed):
    """The model declined the request."""


def available() -> bool:
    """Whether live extraction is configured.

    The SDK also resolves credentials from an `ant auth login` profile, so an
    unset ANTHROPIC_API_KEY does not by itself mean there is no key. Only the
    env var is checked here because that is what the deployment documents.
    """
    return bool(os.environ.get("ANTHROPIC_API_KEY"))
