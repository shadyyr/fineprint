# FinePrint — agent brief

Read this first. It is deliberately short; the detail is behind the links.

**What this is.** Converts a college financial-aid offer letter into an
evidence-linked financial model: what is a grant, what is a loan, what must be
earned, what the letter omits, and what four years cost — with every figure
traceable to the exact words on the page.

**Deadline.** SASEhack 2026 submission closes **Sun 2026-09-20, 11:59 PM PT**.
No code changes after. Built by Shade with two AI agents working one shared tree:
**Claude owns `web/`**, **Codex owns `api/`, `corpus/`, `scripts/`**.

**Live:** https://fineprint-aid.vercel.app — never `fineprint.vercel.app`, an
unrelated product.

## Before you start

1. **Read [docs/HANDOFF.md](docs/HANDOFF.md) in full.** Current state, how
   Shade works (no attribution on commits; commit/push only when asked), what's
   next, and the traps that already cost time.
2. Read [docs/FinePrint_SASEhack_2026_Master_Context.md](docs/FinePrint_SASEhack_2026_Master_Context.md)
   — the product spec (local only; ask Shade if it's missing).
3. Read [docs/TASKS.md](docs/TASKS.md) — lanes, two-agent rules, the board.
4. Read the tail of [docs/CHANGES.log](docs/CHANGES.log) — the last entry is
   the current state; check its `ACTIVE` line before editing a claimed file.
5. [docs/PLAN.md](docs/PLAN.md) is the architecture of record.

## Before you stop

Append an entry to [docs/CHANGES.log](docs/CHANGES.log). Follow the format at
the top of that file. An unlogged change is one the next agent has to
rediscover.

## Rules that are not up for renegotiation

These are the user's explicit decisions, made against alternatives that were
offered and declined. Do not relax them under time pressure; cut from the
documented cut-line list in the plan instead.

1. **Extracted PDF text is the only authoritative source.** Page images go to
   the model as layout context only. No financial fact enters the canonical
   model unless it cites a text line and passes deterministic verification —
   the gate in `api/evidence.py` is an *admission* gate, not a confidence
   score. Failures go to `unverified_claims[]`, never to `costs`/`aid`.
2. **Never infer a period.** `unknown` is preserved and blocks headline math
   until the user resolves it. Not from the amount's size, not from sibling
   rows, not from convention.
3. **No OCR / image-only input** until every core milestone is done.
4. **Live extraction is core scope**, not a cuttable feature.
5. **Fixture fallback must always be visibly labelled** and must never
   masquerade as a live read. `POST /analyze` has no fixture fallback at all —
   serving one person's document with another school's numbers is worse than
   an error.
6. **Gift aid, loans and work-study never merge** into one "aid" figure.
   Work-study does not offset the bill by default.
7. **Principal borrowed is the debt figure.** Interest is stretch; no
   fabricated rates.
8. **AI interprets; application code computes.** The financial engine is pure
   TypeScript with no I/O.

## Layout

| Path | What |
|---|---|
| `web/lib/engine/` | Pure TS financial engine. No I/O, no React. |
| `web/lib/view.ts` | View model: categories, aid breakdown, X-Ray groups, what-if levers |
| `web/components/` | `Overview`, `AidBreakdown`, `AmbiguityPrompt`, `XRay`, `PdfCanvas`, `FourYear`, `WhatIf`, `SourceBadge` |
| `web/store/session.ts` | zustand: source facts, user answers, scenario assumptions — kept separate |
| `web/e2e/` | Real-browser checks (not in `npm test`) — see its README |
| `api/extract.py` | **The only place a model is called** (OpenAI) |
| `web/lib/schema.ts` | zod canonical schema — mirror of `api/models.py` |
| `api/ingest.py` | PyMuPDF → lines + per-character geometry |
| `api/evidence.py` | The admission gate |
| `api/normalize.py` | Claims → canonical model, rollup/ambiguity handling |
| `fixtures/` | Synthetic sample letter + its fixture (the integration contract) |
| `scripts/letter_content.py` | Single source of truth for the sample letter |

Both schemas describe the same JSON. **Change one, change the other.**

## Verify

```bash
cd web && npm test          # 31 engine tests
cd web && npm run typecheck && npx next build   # build catches prod-only Next 16 traps
.venv/bin/pytest api/tests -q   # 45 pipeline tests
.venv/bin/python corpus/run_corpus.py   # 3/3 layouts
scripts/check_secrets.sh --all
cd web && npm run dev       # web :3000, api :8000
```

`/debug/boxes` draws every extracted line box over the source PDF. Evidence
highlighting depends on PyMuPDF and pdf.js agreeing on coordinates — check that
page after touching anything in the ingest path, including with a rotated PDF.

## Secrets and student data

Aid letters contain personal information. Never commit a real one — put it in
`uploads/` (gitignored). A pre-commit hook blocks keys, `.env` files, and PDFs
outside `fixtures/`|`corpus/letters/`. Setup and rationale in the
[README](README.md).
