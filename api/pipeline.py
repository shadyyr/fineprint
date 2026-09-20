"""Model routing for the live extraction pipeline.

The normal path uses GPT-5.6 Terra at medium reasoning. GPT-5.6 Sol is called
only when Terra cannot satisfy the typed response contract, when the
deterministic evidence gate rejects one or more claims, or when no financial
fact verifies.

This routing happens after the admission gate. A merely low confidence score,
an ambiguity of any severity, or a transient provider failure does not trigger
Sol. Ambiguity is an honest result under the never-infer rule, not a failure.
"""

from __future__ import annotations

from dataclasses import dataclass

import time

from extract import (
    DEFAULT_MODEL,
    OPENAI_TIMEOUT_SECONDS,
    FALLBACK_MODEL,
    ExtractionFailed,
    ExtractionValidationFailed,
    Extractor,
    OpenAIExtractor,
)
from ingest import IngestResult
from models import CanonicalDocument, ExtractionResult
from normalize import normalize

# The whole analysis, both calls included, must finish inside the web proxy's
# wait. A fallback only runs if enough of this budget is left for it to finish;
# otherwise the primary result stands, which is better than failing outright.
TOTAL_BUDGET_SECONDS = 150.0
MIN_FALLBACK_SECONDS = 30.0

STRUCTURED_VALIDATION_FAILURE = "structured_output_validation"
NO_VERIFIED_FACTS = "no_verified_financial_facts"
UNVERIFIED_CLAIMS = "unverified_claims"


@dataclass(frozen=True)
class RoutedAnalysis:
    """The selected canonical result plus internal routing information."""

    document: CanonicalDocument
    extraction: ExtractionResult
    model: str
    fallback_reasons: tuple[str, ...] = ()

    @property
    def used_fallback(self) -> bool:
        return bool(self.fallback_reasons)


def fallback_reasons(document: CanonicalDocument) -> tuple[str, ...]:
    """Return the deterministic conditions that justify a Sol retry."""
    reasons: list[str] = []

    if not document.costs and not document.aid:
        reasons.append(NO_VERIFIED_FACTS)
    if document.unverified_claims:
        reasons.append(UNVERIFIED_CLAIMS)
    return tuple(reasons)


def _normalize(
    extraction: ExtractionResult,
    ingested: IngestResult,
    *,
    source_file_name: str,
    model: str,
) -> CanonicalDocument:
    return normalize(
        extraction,
        ingested,
        source_file_name=source_file_name,
        source="live",
        model=model,
    )


def analyze_document(
    ingested: IngestResult,
    *,
    source_file_name: str,
    primary_extractor: Extractor | None = None,
    fallback_extractor: Extractor | None = None,
    primary_model: str = DEFAULT_MODEL,
    fallback_model: str = FALLBACK_MODEL,
) -> RoutedAnalysis:
    """Extract, validate, and retry once with Sol only when policy permits."""
    started = time.monotonic()
    primary = primary_extractor or OpenAIExtractor(model=primary_model)
    primary_document = None

    try:
        primary_extraction = primary.extract(ingested)
    except ExtractionValidationFailed:
        reasons = (STRUCTURED_VALIDATION_FAILURE,)
    else:
        primary_document = _normalize(
            primary_extraction,
            ingested,
            source_file_name=source_file_name,
            model=primary_model,
        )
        reasons = fallback_reasons(primary_document)
        if not reasons:
            return RoutedAnalysis(
                document=primary_document,
                extraction=primary_extraction,
                model=primary_model,
            )

    # Whatever is left of the budget, and no more.
    remaining = TOTAL_BUDGET_SECONDS - (time.monotonic() - started)
    if fallback_extractor is None and remaining < MIN_FALLBACK_SECONDS:
        if primary_document is not None:
            # A usable reading already exists; spending the rest of the budget
            # on a retry that cannot finish would turn it into an error page.
            return RoutedAnalysis(
                document=primary_document,
                extraction=primary_extraction,
                model=primary_model,
                fallback_reasons=reasons,
            )
        raise ExtractionFailed(
            "The model could not return a usable reading in the time available."
        )

    fallback = fallback_extractor or OpenAIExtractor(
        model=fallback_model,
        is_fallback=True,
        timeout=min(OPENAI_TIMEOUT_SECONDS, remaining),
    )
    fallback_extraction = fallback.extract(ingested)
    fallback_document = _normalize(
        fallback_extraction,
        ingested,
        source_file_name=source_file_name,
        model=fallback_model,
    )
    return RoutedAnalysis(
        document=fallback_document,
        extraction=fallback_extraction,
        model=fallback_model,
        fallback_reasons=reasons,
    )
