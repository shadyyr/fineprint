"""Canonical FinePrint schema (Pydantic mirror of web/lib/schema.ts).

This is the contract between the extraction service and the TypeScript
financial engine. Model output is validated against the Extraction* types
first, then promoted into the canonical types only after evidence.py has
verified each claim against the document's own text.

Keep this file and web/lib/schema.ts in step. The round-trip test in
tests/test_schema_parity.py checks the committed fixture parses under both.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

# Normalized [x0, y0, x1, y1], 0-1, top-left origin, matching pdf.js viewport space.
BBox = Annotated[list[float], Field(min_length=4, max_length=4)]

Period = Literal["annual", "semester", "term", "total", "unknown"]
Provenance = Literal["source", "user", "assumption", "derived"]
ItemRole = Literal["item", "rollup"]

CostCategory = Literal[
    "tuition", "fees", "housing", "meals", "books",
    "transportation", "personal", "health_insurance", "other", "subtotal",
]

AidCategory = Literal[
    "grant", "scholarship", "subsidized_loan", "unsubsidized_loan",
    "parent_plus_loan", "private_loan", "work_study", "other_aid", "subtotal",
]

# The distinction the product exists to make. These never collapse into one
# "aid" number (master context section 13).
AidType = Literal["gift", "loan", "work_study", "unknown"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- What the model is allowed to return ------------------------------------
# Note what is absent: no bounding boxes. The model cites line ids and quotes;
# coordinates are resolved deterministically from PyMuPDF geometry. Asking a
# vision model for boxes produces drift that breaks the highlight interaction.


class ExtractionCitation(Strict):
    """A claim's pointer into the document's text layer."""

    line_id: str
    quote: str = Field(description="Text copied verbatim from the cited line.")


class ExtractionItem(Strict):
    """One financial line the model claims to have found.

    Deliberately flat rather than a cost/aid union: strict JSON-schema output
    handles a single object shape far more reliably than a discriminated
    union, and it keeps the model's job simple. `kind` selects which of the
    category fields below apply; normalize.py splits them back apart.
    """

    kind: Literal["cost", "aid"]
    label: str
    amount: float
    period: Period = Field(
        description=(
            "Only state a period the document establishes. Use 'unknown' when it "
            "does not; never infer one from the size of the amount or from "
            "neighbouring rows."
        )
    )
    citations: list[ExtractionCitation] = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)

    # kind == "cost"
    cost_category: CostCategory | None = None
    direct_cost: bool | None = Field(
        default=None,
        description="True for costs the school bills directly, false for estimates.",
    )

    # kind == "aid"
    aid_category: AidCategory | None = None
    aid_type: AidType | None = Field(
        default=None,
        description=(
            "'gift' is not repaid, 'loan' is borrowed, 'work_study' is earned "
            "through hours worked. Use 'unknown' rather than guessing."
        ),
    )
    renewable: bool | None = None
    conditions: list[str] = Field(default_factory=list)

    is_stated_total: bool = Field(
        default=False,
        description=(
            "True when this row is a total the document states over other rows, "
            "such as 'Total Financial Aid Package'."
        ),
    )
    notes: str | None = None


class ExtractionAmbiguityOption(Strict):
    """One explicit resolution choice in the model's structured output."""

    value: str
    label: str
    detail: str | None = None


class ExtractionAmbiguity(Strict):
    kind: Literal["period_unknown", "conditional", "category_unclear", "amount_unclear"]
    target_label: str = Field(description="Label of the item this concerns.")
    question: str
    why: str
    # A typed object is required here. Free-form dicts generate
    # ``additionalProperties`` schemas, which strict Structured Outputs reject.
    options: list[ExtractionAmbiguityOption] = Field(min_length=2)
    citations: list[ExtractionCitation] = Field(default_factory=list)


class ExtractionMissingCost(Strict):
    category: CostCategory
    label: str
    reason: str
    citations: list[ExtractionCitation] = Field(default_factory=list)


class ExtractionResult(Strict):
    """The full structured payload the model must return."""

    institution_name: str | None = None
    academic_year: str | None = None
    items: list[ExtractionItem] = Field(default_factory=list)
    ambiguities: list[ExtractionAmbiguity] = Field(default_factory=list)
    missing_costs: list[ExtractionMissingCost] = Field(default_factory=list)


# --- The canonical model, after verification --------------------------------


class Verification(Strict):
    quote_found: bool
    amount_matched: bool


class Evidence(Strict):
    """A verified pointer into the source document.

    Only ever constructed by evidence.py after the quote has been located in
    the cited line, which is why `status` has a single value.
    """

    id: str
    line_id: str
    page: int
    quote: str
    bbox: BBox
    amount_bbox: BBox | None = None
    amount_text: str | None = None
    status: Literal["verified"] = "verified"
    verification: Verification


class _Item(Strict):
    id: str
    label: str
    amount: float
    period: Period
    role: ItemRole = "item"
    provenance: Provenance = "source"
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_ids: list[str] = Field(min_length=1)
    components: list[str] | None = None
    ambiguity_ids: list[str] | None = None


class CostItem(_Item):
    category: CostCategory
    direct_cost: bool


class AidItem(_Item):
    category: AidCategory
    aid_type: AidType
    renewable: bool | None = None
    conditions: list[str] | None = None


class AmbiguityOption(Strict):
    value: str
    label: str
    detail: str | None = None


class Ambiguity(Strict):
    id: str
    kind: Literal["period_unknown", "conditional", "category_unclear", "amount_unclear"]
    target: str
    severity: Literal["material", "minor"]
    question: str
    why: str
    options: list[AmbiguityOption] = Field(min_length=2)
    blocks_headline: bool
    evidence_ids: list[str] = Field(default_factory=list)


class MissingCost(Strict):
    id: str
    category: CostCategory
    label: str
    reason: str
    evidence_ids: list[str] = Field(default_factory=list)


class UnverifiedClaim(Strict):
    """Model output that failed the admission gate.

    Surfaced to the user as an unconfirmed observation and excluded from every
    calculation. This is where a hallucinated number ends up.
    """

    id: str
    claimed_label: str
    claimed_amount: float | None
    cited_line_id: str | None
    reason: Literal["quote_not_found", "amount_mismatch", "no_citation", "line_not_found"]
    detail: str


class PageInfo(Strict):
    page: int
    width_pt: float
    height_pt: float
    # Already applied to bboxes server-side; carried so the client can assert.
    rotation: int


class TextLayer(Strict):
    sufficient: bool
    char_count: int


class ExtractionMeta(Strict):
    source: Literal["live", "cached", "fixture"]
    model: str | None = None
    extracted_at: str | None = None
    text_layer: TextLayer
    counts: dict[str, int] = Field(default_factory=dict)


class DocumentInfo(Strict):
    institution_name: str | None
    academic_year: str | None
    currency: str = "USD"
    source_file_name: str
    synthetic: bool = False
    pages: list[PageInfo] = Field(min_length=1)


class CanonicalDocument(Strict):
    schema_version: Literal["1.0"] = "1.0"
    document: DocumentInfo
    extraction_meta: ExtractionMeta
    costs: list[CostItem] = Field(default_factory=list)
    aid: list[AidItem] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    ambiguities: list[Ambiguity] = Field(default_factory=list)
    missing_costs: list[MissingCost] = Field(default_factory=list)
    unverified_claims: list[UnverifiedClaim] = Field(default_factory=list)
