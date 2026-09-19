/**
 * Canonical FinePrint schema (zod mirror of api/models.py).
 *
 * This is the contract between the Python extraction service and the
 * TypeScript financial engine. Anything crossing that boundary is parsed
 * through `CanonicalDocument` first, so malformed or partial model output
 * fails at the edge rather than halfway through a projection.
 *
 * Layering rule (master context section 15): source facts, user overrides and
 * scenario assumptions are three separate shapes and never merge into one
 * mutable blob. `provenance` records which layer a value came from.
 */

import { z } from "zod";

/** Normalized [x0, y0, x1, y1], 0-1, top-left origin, matching pdf.js viewport space. */
export const BBox = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export const Period = z.enum(["annual", "semester", "term", "total", "unknown"]);

/**
 * Where a value came from. Enforced at the type level so a user override can
 * never be rendered as something the document actually said.
 */
export const Provenance = z.enum(["source", "user", "assumption", "derived"]);

/**
 * `rollup` marks a stated total that equals the sum of its own components
 * (for example "Total Financial Aid Package"). Rollups are displayed but
 * never summed, which is the double-counting guard.
 */
export const ItemRole = z.enum(["item", "rollup"]);

export const CostCategory = z.enum([
  "tuition",
  "fees",
  "housing",
  "meals",
  "books",
  "transportation",
  "personal",
  "health_insurance",
  "other",
  "subtotal",
]);

export const AidCategory = z.enum([
  "grant",
  "scholarship",
  "subsidized_loan",
  "unsubsidized_loan",
  "parent_plus_loan",
  "private_loan",
  "work_study",
  "other_aid",
  "subtotal",
]);

/**
 * The distinction the whole product exists to make. `gift` is not repaid,
 * `loan` is borrowed, `work_study` must be earned through hours worked.
 * These never collapse into a single "aid" number (master context section 13).
 */
export const AidType = z.enum(["gift", "loan", "work_study", "unknown"]);

/**
 * A pointer into the source document.
 *
 * `status` is the output of the admission gate in api/evidence.py. Only
 * `verified` evidence can back an item in `costs` or `aid`; anything else
 * lands in `unverified_claims` instead.
 */
export const Evidence = z.object({
  id: z.string(),
  line_id: z.string(),
  page: z.number().int().positive(),
  quote: z.string(),
  bbox: BBox,
  /** Narrowed to just the monetary amount within the quote, when present. */
  // FastAPI serializes Pydantic's optional ``None`` values as JSON null.
  // Accept both null and omission at this boundary; neither carries a value.
  amount_bbox: BBox.nullish(),
  amount_text: z.string().nullish(),
  status: z.literal("verified"),
  verification: z.object({
    quote_found: z.boolean(),
    amount_matched: z.boolean(),
  }),
});

const itemBase = {
  id: z.string(),
  label: z.string(),
  amount: z.number(),
  period: Period,
  role: ItemRole.default("item"),
  provenance: Provenance.default("source"),
  confidence: z.number().min(0).max(1),
  evidence_ids: z.array(z.string()).min(1),
  /** Present only on rollups: the ids this total is composed of. */
  components: z.array(z.string()).nullish(),
  ambiguity_ids: z.array(z.string()).nullish(),
};

export const CostItem = z.object({
  ...itemBase,
  category: CostCategory,
  /** True for costs the school bills directly; false for estimated indirect costs. */
  direct_cost: z.boolean(),
});

export const AidItem = z.object({
  ...itemBase,
  category: AidCategory,
  aid_type: AidType,
  renewable: z.boolean().nullish(),
  conditions: z.array(z.string()).nullish(),
});

/**
 * Something the document does not settle. A `material` ambiguity blocks the
 * affected amount from headline figures until the user resolves it -- the
 * system never picks a default (master context sections 12 and 24).
 */
export const Ambiguity = z.object({
  id: z.string(),
  kind: z.enum(["period_unknown", "conditional", "category_unclear", "amount_unclear"]),
  target: z.string(),
  severity: z.enum(["material", "minor"]),
  question: z.string(),
  why: z.string(),
  options: z
    .array(
      z.object({
        value: z.string(),
        label: z.string(),
        detail: z.string().nullish(),
      }),
    )
    .min(2),
  blocks_headline: z.boolean(),
  evidence_ids: z.array(z.string()),
});

/**
 * A cost named by the document but left unquantified, or a standard cost
 * absent entirely. Represented explicitly so it is never silently zero.
 */
export const MissingCost = z.object({
  id: z.string(),
  category: CostCategory,
  label: z.string(),
  reason: z.string(),
  evidence_ids: z.array(z.string()).default([]),
});

/**
 * Model output that failed the admission gate. Shown to the user as an
 * unconfirmed observation and excluded from every calculation.
 */
export const UnverifiedClaim = z.object({
  id: z.string(),
  claimed_label: z.string(),
  claimed_amount: z.number().nullable(),
  cited_line_id: z.string().nullable(),
  reason: z.enum([
    "quote_not_found",
    "amount_mismatch",
    "no_citation",
    "line_not_found",
  ]),
  detail: z.string(),
});

export const PageInfo = z.object({
  page: z.number().int().positive(),
  width_pt: z.number(),
  height_pt: z.number(),
  /** Already applied to bboxes server-side; carried so the client can assert. */
  rotation: z.number().int(),
});

/** How this analysis was produced. Drives the always-visible SourceBadge. */
export const ExtractionSource = z.enum(["live", "cached", "fixture"]);

export const CanonicalDocument = z.object({
  schema_version: z.literal("1.0"),
  document: z.object({
    institution_name: z.string().nullable(),
    academic_year: z.string().nullable(),
    currency: z.string().default("USD"),
    source_file_name: z.string(),
    synthetic: z.boolean().default(false),
    pages: z.array(PageInfo).min(1),
  }),
  extraction_meta: z.object({
    source: ExtractionSource,
    model: z.string().nullable(),
    extracted_at: z.string().nullable(),
    text_layer: z.object({
      sufficient: z.boolean(),
      char_count: z.number().int(),
    }),
    counts: z.record(z.string(), z.number()).default({}),
  }),
  costs: z.array(CostItem),
  aid: z.array(AidItem),
  evidence: z.array(Evidence),
  ambiguities: z.array(Ambiguity).default([]),
  missing_costs: z.array(MissingCost).default([]),
  unverified_claims: z.array(UnverifiedClaim).default([]),
});

export type BBox = z.infer<typeof BBox>;
export type Period = z.infer<typeof Period>;
export type Provenance = z.infer<typeof Provenance>;
export type ItemRole = z.infer<typeof ItemRole>;
export type CostCategory = z.infer<typeof CostCategory>;
export type AidCategory = z.infer<typeof AidCategory>;
export type AidType = z.infer<typeof AidType>;
export type Evidence = z.infer<typeof Evidence>;
export type CostItem = z.infer<typeof CostItem>;
export type AidItem = z.infer<typeof AidItem>;
export type Ambiguity = z.infer<typeof Ambiguity>;
export type MissingCost = z.infer<typeof MissingCost>;
export type UnverifiedClaim = z.infer<typeof UnverifiedClaim>;
export type PageInfo = z.infer<typeof PageInfo>;
export type ExtractionSource = z.infer<typeof ExtractionSource>;
export type CanonicalDocument = z.infer<typeof CanonicalDocument>;

/** Any priced line from the document, cost or aid. */
export type AnyItem = CostItem | AidItem;

export function isAid(item: AnyItem): item is AidItem {
  return "aid_type" in item;
}

export function parseCanonicalDocument(input: unknown): CanonicalDocument {
  return CanonicalDocument.parse(input);
}
