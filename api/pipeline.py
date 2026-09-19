"""Model routing for the live extraction pipeline.

The normal path uses GPT-5.6 Terra at medium reasoning. GPT-5.6 Sol is called
only when Terra cannot satisfy the typed response contract, when the
deterministic evidence gate rejects one or more claims, or when normalization
surfaces an ambiguity that is both material and blocks headline calculations.

This routing happens after the admission gate. A merely low confidence score,
a minor ambiguity, or a transient provider failure does not trigger Sol.
"""

from __future__ import annotations

from dataclasses import dataclass

from extract import (
    DEFAULT_MODEL,
    FALLBACK_MODEL,
    ExtractionValidationFailed,
    Extractor,
    OpenAIExtractor,
)
from ingest import IngestResult
from models import CanonicalDocument, ExtractionResult
from normalize import normalize

STRUCTURED_VALIDATION_FAILURE = "structured_output_validation"
NO_VERIFIED_FACTS = "no_verified_financial_facts"
UNVERIFIED_CLAIMS = "unverified_claims"
MATERIAL_AMBIGUITIES = "material_blocking_ambiguities"


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
    if any(
        ambiguity.severity == "material" and ambiguity.blocks_headline
        for ambiguity in document.ambiguities
    ):
        reasons.append(MATERIAL_AMBIGUITIES)

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
    primary = primary_extractor or OpenAIExtractor(model=primary_model)

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

    fallback = fallback_extractor or OpenAIExtractor(model=fallback_model)
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
