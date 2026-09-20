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

import logging
import os
import time
from typing import Any, Protocol

from openai import OpenAI
from pydantic import ValidationError

from ingest import IngestResult
from models import ExtractionResult

# Terra handles the normal path at balanced cost. Sol is reserved for the
# post-validation fallback in pipeline.py; OpenAIExtractor itself never changes
# models implicitly, which keeps routing explicit and testable.
DEFAULT_MODEL = os.environ.get("FINEPRINT_MODEL", "gpt-5.6-terra")
FALLBACK_MODEL = os.environ.get("FINEPRINT_FALLBACK_MODEL", "gpt-5.6-sol")
DEFAULT_REASONING_EFFORT = os.environ.get(
    "FINEPRINT_REASONING_EFFORT", "medium"
)

MAX_TOKENS = 16000
OPENAI_MAX_RETRIES = 0
# One call, generously. A dense but ordinary two-page letter (118 lines, 24
# items) measured 53s and 70s on two runs at medium effort -- reasoning length
# varies per run -- so the old 40s rejected letters the pipeline reads
# perfectly well. The pipeline, not this constant, bounds the total: it gives a
# fallback only the budget that remains (see pipeline.TOTAL_BUDGET_SECONDS).
OPENAI_TIMEOUT_SECONDS = 100.0

logger = logging.getLogger("fineprint.extract")

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
label and the amount whenever one exists. When a visual table's label and amount \
were extracted as separate text lines, cite BOTH lines; one citation must contain \
the exact amount.

CLASSIFICATION RULES.

4. aid_type is the most consequential field you set:
   - "gift": grants and scholarships, not repaid.
   - "loan": any borrowed money, including subsidized, unsubsidized, PLUS and \
private loans. Loans are never gift aid.
   - "work_study": wages earned by working. Not a grant, not guaranteed money.
   - "unknown": use this rather than guessing. A subtotal retains the type of \
the category it names: grant and scholarship subtotals are "gift", loan \
subtotals are "loan", and work-study subtotals are "work_study". A summary \
heading does not make an otherwise named category unknown.

5. period: state a period ONLY if the document establishes it. If a row gives an \
amount with no stated period, set period to "unknown" -- even when the amount \
looks like a typical annual figure, even when other rows on the page are annual, \
and even when renewal language appears elsewhere. Guessing here is the single \
worst error you can make. Raise an ambiguity instead. The enum value "total" has \
one narrow meaning: the document expressly says the amount covers the whole \
multi-year program or award. NEVER use period "total" merely because a table \
column or row is labelled "Total". In a table scoped to one academic year, its \
Fall + Spring or category Total is annual. `is_stated_total` describes arithmetic \
aggregation and is completely separate from period.

6. is_stated_total: set true for rows that total other rows ("Total Cost of \
Attendance", "Total Financial Aid Package", subtotals). Report them, flagged, so \
they are not double counted. Never mark an ordinary grant, scholarship, loan, or \
cost as a total merely because its amount happens to equal a combination of other \
rows.

7. Cost after aid, family obligation, balance due, amount due per term, payment \
installments, and similar payment-schedule views are NOT additional costs. Do \
not emit them as cost items. They describe how or when the already stated costs \
are covered, often after aid has already been subtracted.

8. If a letter lists mutually exclusive cost rates (for example in-state and \
out-of-state tuition) without saying which applies, emit ONE cost item using the \
first listed rate as its provisional amount. Also emit an `amount_unclear` \
ambiguity targeting that item. Each option value must be the amount as a plain \
decimal string (for example "19800"), and the ambiguity must cite every option \
row. Never infer residency from a name, address, institution, or typical rate. \
If the letter explicitly says which rate applies, emit only that rate and no \
amount ambiguity.

TABLE STRUCTURE.

9. When one row has separate term columns (for example Fall and Spring), emit one \
item for EACH amount and include the term in the label. Use period "semester" or \
"term" only when the document's headings establish it. A separate award outside \
that table does not inherit the table's period.

10. When a later summary repeats the same award or category subtotal with the \
same amount, emit that financial fact ONCE and cite every occurrence. Do not \
create a second item solely because the same money is printed again in a summary. \
A summary row keeps the period established by the detailed table; its heading or \
"Total" label does not change an annual amount into a multi-year total. It also \
keeps the detailed row's aid_category and aid_type; do not downgrade a named \
grant, scholarship, loan, or work-study summary to "unknown".

AMBIGUITIES AND GAPS.

11. Raise an ambiguity whenever the document leaves something materially unclear, \
especially an amount whose period is not stated. Give at least two concrete \
options a student could choose between.

12. missing_costs: list cost categories the letter names but does not price, and \
standard categories absent entirely (transportation, personal expenses, health \
insurance). Never invent an amount for them.

Report what the document says, not what a typical offer would say."""


class Extractor(Protocol):
    """Anything that can turn an ingested document into structured claims."""

    def extract(self, result: IngestResult) -> ExtractionResult: ...


def build_user_content(result: IngestResult) -> list[dict]:
    """Assemble Responses API content: text first, images as context."""
    content: list[dict] = [
        {
            "type": "input_text",
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
                "type": "input_image",
                "image_url": f"data:image/png;base64,{page.png_b64}",
                "detail": "auto",
            }
        )
        content.append(
            {
                "type": "input_text",
                "text": (
                    f"Layout context for page {page.page}. Use it to understand "
                    "the structure only. Do not read figures from it."
                ),
            }
        )

    content.append(
        {
            "type": "input_text",
            "text": (
                "Extract the costs, aid, ambiguities and missing costs from this "
                "offer. Remember: quote verbatim, cite a line_id for everything, "
                "and use period \"unknown\" wherever the document does not say."
            ),
        }
    )
    return content


class OpenAIExtractor:
    """Structured extraction through the OpenAI Responses API.

    ``responses.parse`` validates the output against ``ExtractionResult``
    before it reaches the admission gate. ``store=False`` is deliberate: aid
    letters can contain student PII, and FinePrint does not need response
    retrieval or conversation state for this stateless transformation.
    """

    def __init__(
        self,
        *,
        model: str = DEFAULT_MODEL,
        reasoning_effort: str = DEFAULT_REASONING_EFFORT,
        api_key: str | None = None,
        client: Any | None = None,
        is_fallback: bool = False,
        timeout: float | None = None,
    ):
        self.model = model
        self.reasoning_effort = reasoning_effort
        self.is_fallback = is_fallback
        self._client = client if client is not None else OpenAI(
            api_key=api_key,
            max_retries=OPENAI_MAX_RETRIES,
            timeout=OPENAI_TIMEOUT_SECONDS if timeout is None else timeout,
        )

    def extract(self, result: IngestResult) -> ExtractionResult:
        started = time.perf_counter()
        response: Any | None = None
        try:
            response = self._client.responses.parse(
                model=self.model,
                instructions=SYSTEM,
                input=[{"role": "user", "content": build_user_content(result)}],
                text_format=ExtractionResult,
                max_output_tokens=MAX_TOKENS,
                reasoning={"effort": self.reasoning_effort},
                store=False,
            )
        except ValidationError as exc:
            raise ExtractionValidationFailed(
                "The model response did not match the extraction schema."
            ) from exc
        finally:
            _log_usage(
                response,
                model=self.model,
                is_fallback=self.is_fallback,
                elapsed_ms=round((time.perf_counter() - started) * 1000),
            )

        parsed = response.output_parsed
        if parsed is None:
            refusal = _refusal_text(response)
            if refusal:
                raise ExtractionRefused(
                    f"The model declined to analyze this document: {refusal}"
                )
            if getattr(response, "status", None) == "incomplete":
                reason = getattr(
                    getattr(response, "incomplete_details", None), "reason", None
                )
                suffix = f": {reason}" if reason else "."
                raise ExtractionFailed(f"The model response was incomplete{suffix}")
            raise ExtractionValidationFailed(
                "The model returned no valid structured output."
            )
        return parsed


def _usage_count(value: Any) -> int | str:
    """Return a token count without letting absent provider metadata fail work."""
    return value if isinstance(value, int) and value >= 0 else "unavailable"


def _log_usage(
    response: Any | None,
    *,
    model: str,
    is_fallback: bool,
    elapsed_ms: int,
) -> None:
    """Log billing-relevant counts only -- never document or response content."""
    usage = getattr(response, "usage", None)
    input_details = getattr(usage, "input_tokens_details", None)
    output_details = getattr(usage, "output_tokens_details", None)
    logger.info(
        "model_call model=%s input_tokens=%s output_tokens=%s "
        "reasoning_tokens=%s cached_input_tokens=%s fallback=%s elapsed_ms=%s",
        model,
        _usage_count(getattr(usage, "input_tokens", None)),
        _usage_count(getattr(usage, "output_tokens", None)),
        _usage_count(getattr(output_details, "reasoning_tokens", None)),
        _usage_count(getattr(input_details, "cached_tokens", None)),
        str(is_fallback).lower(),
        max(0, elapsed_ms),
    )


def _refusal_text(response: Any) -> str | None:
    """Find a refusal in a Responses API output without assuming item order."""
    for output in getattr(response, "output", ()):
        for content in getattr(output, "content", ()):
            if getattr(content, "type", None) == "refusal":
                return getattr(content, "refusal", None) or "request refused"
    return None


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


class ExtractionValidationFailed(ExtractionFailed):
    """The response could not satisfy the typed extraction contract."""


def available() -> bool:
    """Whether the documented live-extraction credential is configured."""
    return bool(os.environ.get("OPENAI_API_KEY"))
