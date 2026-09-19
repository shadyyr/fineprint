# FinePrint — Implementation Architecture & Milestone Plan

> **Canonical copy.** This file is the architecture of record. A copy may exist
> at `~/.claude/plans/` as a Claude Code plan-mode artifact; that one is a
> snapshot and may be stale. Edit this one.
>
> Running coordination between agents lives in [CHANGES.log](CHANGES.log) —
> read its tail before starting, append an entry before you stop.

## Status (updated 2026-09-19 — see docs/HANDOFF.md for the full picture)

| Milestone | State |
|---|---|
| M0 skeleton + contract | done |
| M1 engine + tests | done — 31 vitest tests |
| M2 sample PDF | done — generated from shared layout data |
| M3 ingest + coordinate proof | done — chain verified numerically at every layer |
| M4 live extraction + admission gate | done — OpenAI typed extraction, deterministic evidence gate, live tested |
| M5 multi-layout corpus | done — three synthetic layouts, replay + live harness |
| M6 Financial X-Ray | done — bidirectional document/evidence selection |
| M7 Overview | done — headline aid vs. confirmed gift-aid contrast |
| M8 four-year projection | done — `106a75b`; per-year bars, figures vs. the letter as written |
| M9 what-if simulator | done — `106a75b`; growth, renewal, housing, loans, work-study; 0 network requests |
| M10 uncertainty + accessibility | in progress — ambiguity, source badge, empty/error states shipped |
| M11 submission | in progress — README and public sample demo shipped; video/slides/Devpost remain |

Also added (not in the original plan): a three-layer secret/PII guard —
hardened `.gitignore`, a pre-commit scanner (`scripts/check_secrets.sh`)
blocking key-shaped strings, `.env` files, oversized files and PDFs outside
`fixtures/`|`corpus/letters/`, and self-healing hook installation via
`npm install`. The scanner currently reports a clean tracked tree.

## Context

SASEhack 2026 build (hacking window: **Fri Sep 18 5:00 PM PT → Sun Sep 20 11:59 PM PT**, ~55 wall-clock hours, **solo**). The core pipeline, validation corpus, Overview, and Financial X-Ray are implemented; projection, scenarios, final polish, and submission materials remain.

`FinePrint_SASEhack_2026_Master_Context.md` is the source of truth. The product converts an unstandardized financial-aid offer letter into an **evidence-linked, executable financial model**: it separates gift aid / loans / work-study / costs, traces every number back to its exact location in the source PDF, computes a Year-1 picture, projects four years, and runs what-if scenarios.

Confirmed decisions:

| Decision | Choice |
|---|---|
| Stack | **Next.js + Python FastAPI** (two services) |
| Model access | Fixture-first scaffolding, but **live extraction is core scope** |
| Team | **Solo** |
| Tracks | Best Finance Hack (primary) + Education/Accessibility/Social Impact (second) |

**Second-track positioning:** the Education/Accessibility/Social Impact case rests on **serving first-generation students and families who are poorly served by confusing, nonstandard aid offers** (§5). Accessibility engineering strengthens that case but is not the justification for it. The pitch leads with the user, not with ARIA attributes.

The build must satisfy §6–8 scope constraints and §24's prohibitions. North star (§27): *does this make the financial decision clearer while making the underlying evidence more transparent?*

---

## The central architectural idea

> **The model never emits coordinates. It emits line IDs and quoted text. Our code resolves those to pixels and verifies the quote is really there.**

Asking a vision model for bounding boxes is the obvious approach and it does not work — LLM-produced boxes drift, and the signature interaction (§7.3) breaks on camera. Instead:

1. PyMuPDF extracts every text line with exact geometry → each gets a stable `line_id` (`p1_l12`).
2. The OpenAI model receives the **numbered line dump** plus page images, and must cite `line_id` + an exact `quote` for every financial fact.
3. Python resolves `line_id` → bbox deterministically, and narrows the box to just the quoted substring via span-width interpolation, so the highlight lands on `$3,500`, not the whole line.
4. **Verification gate:** the quote must actually occur in the cited line, *and* the amount re-parsed from that text must equal the model's `amount`.

Highlights become pixel-exact by construction, and *"how do you know the AI didn't make that up?"* has a real, demonstrable answer.

### Extracted text is authoritative; images are context only

**No financial fact enters the canonical model unless it links to extracted source text and passes deterministic verification against it.** The verification gate is an *admission* gate, not a confidence label.

Page images are supplied to the model strictly as **contextual and layout information** — to disambiguate column structure, table grouping, and which heading governs which amount. They are never an independent source of a number. The extraction prompt states this explicitly, and every returned fact must still carry a `line_id` citation into the text layer.

Consequences, deliberately accepted:

- A model claim that cannot be verified against text **is not a fact** and never reaches `facts[]`. It is recorded separately (see schema) and shown as an unconfirmed observation, excluded from all math.
- A document with **no usable text layer cannot produce facts.** The system fails clearly — "this looks like a scanned document; FinePrint needs a text-based PDF" plus the sample offer as an escape hatch. It does **not** quietly degrade to vision-only reading.
- **OCR and image-only document support are out of scope** until every core milestone is complete. See post-core stretch.

### Second idea: extraction is Python, the financial engine is TypeScript

The what-if simulator must feel instant (§7.6), so the engine runs **client-side as pure functions** — no round-trip per slider tick. Side effect: the interactive product still works if FastAPI is down, satisfying §20 resilience architecturally rather than with a hack.

```
PDF ──▶ FastAPI (ingest → OpenAI → verify → normalize) ──▶ canonical JSON ──▶ browser
                                                                                 │
                                       ┌─────────────────────────────────────────┤
                                       ▼                                         ▼
                              TS financial engine                      pdfjs-dist render
                              (pure, client-side)                      + bbox overlay
```

---

## Stack-specific risk: two coordinate systems

The one place the two-service choice costs real safety, so it is addressed head-on.

- **PyMuPDF returns coordinates for the _unrotated_ page.** `pdf.js getViewport()` applies `/Rotate` **by default**. On any rotated PDF every highlight lands wrong.
  **Fix:** apply `page.rotation_matrix` to each bbox server-side, then normalize against rotated dimensions.
- Normalize to `[x0, y0, x1, y1]` in **0–1, top-left origin** — PyMuPDF is already top-left, matching pdf.js viewport space. No Y-flip needed once rotation is handled.
- Normalize against **CropBox** (`page.rect`), which is what pdf.js renders.
- API response carries `page_width`, `page_height`, `rotation` per page; the client asserts the aspect ratio matches and logs loudly on mismatch.

**Mandatory gate (M3):** a `/debug/boxes` page drawing *every* extracted line box over the rendered PDF, built **before** anything depends on evidence linking. ~30 minutes, and it converts "hope the coordinates line up" into "I can see that they do."

---

## Repository layout

```
fineprint/
├─ web/                        # Next.js 16 + React 19 + TS + Tailwind 4
│  ├─ app/
│  │  ├─ page.tsx                     # S1 landing / upload
│  │  ├─ analyze/page.tsx             # S2–S6 main experience
│  │  ├─ debug/boxes/page.tsx         # coordinate validator (M3)
│  │  └─ api/analyze/route.ts         # proxy → FastAPI (keeps key server-side)
│  ├─ lib/
│  │  ├─ schema.ts                    # zod mirror of canonical schema
│  │  └─ engine/                      # ★ pure TS financial engine
│  │     ├─ normalize.ts  periods.ts  yearOne.ts
│  │     ├─ projection.ts  scenarios.ts  index.ts
│  │     └─ *.test.ts                 # vitest
│  ├─ components/
│  │  ├─ PdfCanvas.tsx  EvidenceOverlay.tsx  XRayPanel.tsx
│  │  ├─ Overview.tsx  FourYearChart.tsx  WhatIfPanel.tsx
│  │  └─ AmbiguityPrompt.tsx  MetricTooltip.tsx  SourceBadge.tsx
│  └─ store/session.ts                # zustand: facts | overrides | assumptions
├─ api/                        # FastAPI
│  ├─ main.py                         # POST /analyze, GET /health
│  ├─ ingest.py                       # PyMuPDF → LayoutLine[] + page PNGs
│  ├─ extract.py                      # OpenAI adapter (behind Protocol)
│  ├─ evidence.py                     # ★ resolve + verify + tighten bbox
│  ├─ normalize.py                    # periods, rollups, invariants, ambiguities
│  ├─ models.py                       # Pydantic canonical schema
│  └─ requirements.txt
├─ corpus/                     # ★ multi-layout validation set (M5)
│  ├─ letters/                        # 4+ substantially different layouts
│  ├─ expected/                       # hand-checked ground truth per letter
│  └─ run_corpus.py                   # validation harness → report
├─ fixtures/
│  ├─ sample_offer.json               # the integration contract
│  └─ sample_offer.pdf                # generated, committed
└─ scripts/make_sample_pdf.py         # ReportLab generator
```

**Dependencies** (versions verified available today):
`next@16.3.5`, `react@19`, `tailwindcss@4.3.3`, `pdfjs-dist@6.3.289`, `zod@4.6.5`, `zustand@5.0.15`, `recharts@3.10.1`, `vitest@5.0.1`, `concurrently`
Python: `fastapi`, `uvicorn`, `pymupdf`, `pydantic>=2`, `openai>=2`, `reportlab`, `python-multipart`

Notes: PyMuPDF is AGPL-3.0 — fine since the repo must be public anyway; `pdfplumber` (MIT) is the swap if that changes. `pdfjs-dist@6` is ESM and needs its worker wired explicitly (copy to `public/`, set `workerSrc`) — a known Next.js time sink, do it in M0. Python 3.14 installed; use a venv (`uv` unavailable).

---

## Canonical schema

Per §10, defined once in Pydantic (`api/models.py`), mirrored in zod (`web/lib/schema.ts`). Additions beyond §10, all load-bearing:

- `evidence[].line_id` / `evidence[].quote` — the citation the model actually produced.
- **`facts[]` contains only text-verified items.** Passing the gate is the condition of membership, so every fact in the model is traceable by construction and no downstream code needs to re-check.
- **`unverified_claims[]`** — a separate array for model output that failed the gate: what was claimed, which line was cited, and why verification failed (quote absent / amount mismatch / no citation). Surfaced in the UI as unconfirmed observations worth a human look, excluded from every calculation. This keeps §12's "surface uncertainty" honest without letting unverified numbers leak into the model.
- `facts[].provenance`: `source | user | assumption | derived` — §15's layer separation enforced at the type level, so a user override can never render as a source fact.
- `facts[].period`: `annual | semester | term | total | unknown` — see the hard rule below.
- `facts[].role`: `item | rollup` — a "Total Aid" line equal to the sum of its parts is a `rollup`, excluded from sums. The double-counting guard (§15).

`fixtures/sample_offer.json` is written **first** and is the integration contract; UI and engine build against it before the pipeline exists.

---

## Financial semantics — decisions locked

**Hard rule on periods (§12, §24).** `period: "unknown"` is a real, preserved value. When the source does not establish whether an amount is annual, per-term, or a multi-year total, the system **never infers one** — not from the amount's size, not from sibling items, not from convention. An unknown-period material amount is excluded from headline numbers and raises an ambiguity the user must resolve. This is the behavior the `$20,000 scholarship` case exists to demonstrate, and it is covered by an explicit engine test.

- **Work-study never offsets cost by default.** Separate category, plus an explicit clearly-labeled opt-in toggle.
- **Headline debt number is `principal borrowed`.** This is sufficient for the MVP.
- **Interest modeling is a stretch goal**, below the cut line. If it ships: user-entered rate only (no fabricated 2026-27 federal rates, §24), and modeled *correctly* — unsubsidized accrues from disbursement, subsidized does not accrue while enrolled — or not at all.
- Metric labels are not interchangeable. Default headline is "estimated Year-1 amount to cover"; "net price" only if the computation matches the definition. Every metric gets a defining tooltip.
- A missing cost renders as **missing**, never silently `0` (§15).

---

## Overview screen — design constraint

The Overview exists to land **one contrast**: the school's headline "financial aid" total versus what the student actually does not repay.

That comparison is the visual center of the screen and the demo's money shot. Supporting figures (loans, work-study, conditional, Year-1 amount to cover) are present and legible but visibly subordinate. **No dashboard clutter** — no tile grid, no secondary charts, no metrics that do not serve the contrast. Progressive disclosure (§6.9): the X-Ray and the four-year view are one click away, not crowded onto this screen.

---

## Fallback honesty

A cached/fixture result **always carries a persistent, visible badge** identifying it as such, and the UI never presents it as a successful live extraction (§20.2). The badge is not subtle, not a tooltip, and not dismissible. `SourceBadge.tsx` renders one of: `live extraction`, `cached sample`, `fixture (offline)`. If asked during judging, the honest answer is already on screen.

---

## Milestones (hour-budgeted, solo)

Live extraction now sits immediately after ingest, matching §21's actual priority order (sample doc + reliable extraction at #2, ahead of highlighting and UI). UI work is more predictable and tolerates compression; extraction does not.

### Friday evening (~7h)
- **M0 · 2h · Skeleton + contract.** Both services booting, `npm run dev` runs both via `concurrently`, pdf.js worker wired, Tailwind up. **Write `fixtures/sample_offer.json` first.**
- **M1 · 3h · Financial engine + tests.** Pure TS, zero I/O. Year-1 math, period normalization, rollup detection, invariants. Vitest green. *§21's #1 priority.*
- **M2 · 2h · Sample PDF.** ReportLab script producing the §16 letter: tuition/fees, housing, meals, grant, renewable merit scholarship w/ GPA condition, sub + unsub loans, work-study, **an ambiguous `$20,000` scholarship with no stated period**, and **a missing indirect cost**. Real text layer; headline "aid" total misleading vs. actual gift aid.

### Saturday (~12h)
- **M3 · 2.5h · Ingest + coordinate proof.** PyMuPDF → `LayoutLine[]`, rotation handled. Text-layer sufficiency check up front, with the clear scanned-document failure path. **Ship `/debug/boxes` and confirm alignment before proceeding.**
- **M4 · 3.5h · Live extraction + admission gate.** OpenAI adapter behind a `Protocol`; prompt supplies the numbered line dump as the authoritative source and page images as layout context only; strict structured output and Pydantic validation; then `evidence.py` resolution + verification, splitting output into `facts[]` and `unverified_claims[]`. Core scope.
- **M5 · 2h · Multi-layout corpus + harness.** See below. Fix what it breaks.
- **M6 · 4h · Financial X-Ray.** `PdfCanvas` + overlay + `XRayPanel`. Bidirectional selection (analysis row ↔ document highlight) — cheap, doubles the demo impact. Highlights are real `<button>`s.

### Sunday (~13h, tight)
- **M7 · 2.5h · Overview screen.** Per the design constraint above.
- **M8 · 2.5h · Four-year projection.** Deterministic, assumptions explicit and visible. Stacked-bar money flow.
- **M9 · 2.5h · What-if simulator.** Tuition growth %, scholarship renewal, ambiguous-period resolution, housing/commute, per-loan accept/decline. Before/after deltas in an `aria-live` region.
- **M10 · 2h · Uncertainty UI + a11y + fallback badges.** Ambiguity prompts that recalculate (§12), error/empty states, keyboard pass, contrast, chart text alternatives.
- **M11 · 4h · Submission.** Video, README, slides, Devpost. **Starts no later than Sunday 6pm** (§21 warns explicitly against the final-hour scramble).

Sleep is in the schedule. A broken demo from an exhausted solo dev scores worse than a smaller working one.

### Cut lines, in order, if behind
1. Interest modeling (already stretch — principal borrowed is the MVP answer)
2. Multi-offer comparison (already stretch, §23)
3. Sankey flow → keep the stacked bar
4. Corpus letters 4+ → hold the floor at three substantially different layouts

**Never cut:** live extraction, verified evidence linking, deterministic engine correctness, uncertainty handling, or submission materials. Falling back to the fixture during judging is an emergency measure, disclosed on screen — not a planned scope reduction.

### Post-core stretch (only once every core milestone is done)
OCR / scanned-document / image-only input. This is gated rather than merely deprioritized: supporting it means producing facts that cannot be verified against a text layer, which contradicts the admission rule above. If it is ever built, it needs its own provenance path and its own visible labeling — not a quiet reuse of the verified-fact pipeline.

---

## Multi-layout validation (M5)

Validating only against the letter we designed for ourselves would prove nothing — that letter was built to be parsed. The corpus holds **at least four substantially different layouts**, chosen to break different assumptions:

| Layout | What it stresses |
|---|---|
| FinePrint synthetic letter (M2) | Baseline, known ground truth |
| **College Financing Plan / Shopping Sheet** style | Standardized tabular form, different vocabulary |
| **Narrative / prose letter** | Amounts embedded in sentences, not table rows |
| **Per-term two-column table** | Period normalization — semester columns, not annual |
| *(optional)* Dense multi-page package | Rollup/total lines, double-count guard |

Sourcing: institutions publish **sample/example award letters** publicly, and the federal College Financing Plan template is public. Use those plus synthetic variants. **Never a real student's letter** (§6.11) — no exceptions, including for a "quick test."

`corpus/run_corpus.py` runs extraction across the set and reports per letter: facts extracted, **% evidence verified**, unresolved ambiguities, invariant violations, and diffs against hand-checked `corpus/expected/`. The pass bar: no invariant violations, no unverified evidence shown as fact, and every genuinely ambiguous period surfaced rather than guessed. A layout that extracts poorly but *reports* its uncertainty correctly is a pass; one that extracts confidently and wrongly is a failure.

---

## Accessibility

Supports the second track rather than justifying it (see Context), and §19 requires most of it regardless:
- Categories encoded by **icon + text label**, never color alone.
- Every evidence highlight is a focusable `<button>` with a descriptive `aria-label`, large enough to hit (§19: "do not make tiny highlights impossible to select").
- Charts ship a visually-hidden `<table>` equivalent.
- What-if deltas announce via `aria-live`.
- Visible focus states, semantic HTML, labeled form controls.

---

## Verification

**Engine (continuous):** `cd web && npx vitest` — period normalization, rollup/double-count detection, gift/loan/work-study disjointness, Year-1 totals, four-year projection under each scenario toggle, and two hard invariants: a missing cost never becomes `0`, and an `unknown` period is never coerced into a concrete one.

**Coordinates (M3 gate):** open `/debug/boxes` with `sample_offer.pdf`; every line box must sit on its text. Re-check with a deliberately rotated PDF (`/Rotate 90`) to confirm the rotation-matrix fix.

**Verification gate (M4)** — the admission rule, tested four ways. Feed the extractor doctored payloads: a `quote` absent from the cited line; an `amount` disagreeing with the quoted text; a fact with no `line_id` at all; and a fact citing a nonexistent line. Each must land in `unverified_claims[]`, never in `facts[]`, and must not move any total. Separately, run a **text-layer-free PDF** through `/analyze` and confirm it fails with the clear scanned-document message rather than returning vision-derived numbers.

**Corpus (M5, then re-run after any extraction change):** `python corpus/run_corpus.py` against the pass bar above.

**End-to-end (the demo path, §20.8):** upload `sample_offer.pdf` → processing stages → Overview contrast → click a loan row → correct text highlights in the PDF → resolve the `$20,000` ambiguity → four-year view → toggle scholarship renewal off → totals visibly update. Run this exact path repeatedly before submitting, and once **with FastAPI stopped** to confirm the fallback badge is unmistakable.

**Scope check against §24 before submitting:** no chatbot homepage, no loans described as free aid, no work-study counted as guaranteed grant money, no fabricated rates or renewal predictions, no hidden ambiguity.
