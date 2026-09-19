# Task split and file ownership

Two agents work this repo in parallel. This file is the assignment board;
[CHANGES.log](CHANGES.log) is the running conversation between them.

**The split is by directory, not by feature.** Feature-level splits put both
agents in `web/` editing shared components and a shared store, which collides
constantly. Directory lanes have almost no overlap, because the contract
between them — `fixtures/sample_offer.json` and the dual schema — is already
committed and stable.

## Lanes

| Lane | Owner | Directories |
|---|---|---|
| **Pipeline** | Codex | `api/`, `corpus/`, `scripts/` |
| **Product** | Claude | `web/` |
| **Shared** | agreement required | `fixtures/`, `web/lib/schema.ts` ↔ `api/models.py` |
| **Human** | Shade | API key, demo video, Devpost, slides |

Do not edit outside your lane. If you need a change in the other lane, write it
in CHANGES.log as a request and keep going on something else.

## Rules

1. **Never `git add -A`.** Both agents share one working tree, so `-A` stages
   the other agent's half-finished work. Stage your lane explicitly:
   - Codex: `git add api/ corpus/ scripts/`
   - Claude: `git add web/`
2. **The schema is frozen** unless both agents agree. `web/lib/schema.ts` and
   `api/models.py` describe the same JSON; changing one without the other
   breaks the build in the opposite lane. To propose a change: log it, state
   what breaks, wait for the other agent's entry before editing.
3. **`fixtures/sample_offer.json` is load-bearing.** The entire UI and the
   engine's 31 tests are built against it. Codex owns regeneration (it comes
   from `scripts/`), but announce any change that alters ids, shapes or
   amounts before making it.
4. **Pull before you start, log before you stop.** Read the tail of
   CHANGES.log; append an entry when you finish or hand off.
5. **Port conflicts:** only one agent runs `npm run dev` at a time (3000/8000).
   Codex should use `pytest` and direct `uvicorn` on a different port if needed.
6. **Green before commit:** your lane's tests must pass. Do not commit with the
   other lane broken; if you broke it, say so in the log immediately.

## Board

Milestone numbers refer to [PLAN.md](PLAN.md).

### Codex — pipeline

- [ ] **M5a · Corpus letters.** At least three layouts beyond our synthetic one,
      each stressing a different assumption:
      a College Financing Plan / Shopping Sheet style tabular form;
      a prose letter with amounts inside sentences;
      a per-term two-column table (stresses period normalization).
      Synthetic variants and publicly published institutional samples only —
      **never a real student's letter** (master context 6.11).
- [ ] **M5b · Validation harness.** `corpus/run_corpus.py` reporting per letter:
      items extracted, % evidence verified, unresolved ambiguities, invariant
      violations, and a diff against hand-checked `corpus/expected/`.
      Pass bar: no invariant violations, no unverified claim shown as fact, and
      every genuinely ambiguous period surfaced rather than guessed.
      *A layout that extracts poorly but reports its uncertainty correctly is a
      pass. One that extracts confidently and wrongly is a failure.*
- [ ] **M5c · Harden extraction** against what the corpus breaks. Prompt work in
      `api/extract.py`; verification logic in `api/evidence.py`.
- [ ] **M5d** Make the harness runnable without an API key via `ReplayExtractor`
      and committed model responses, so it works in CI and when the key is out.

Blocked on the key: M5b's live run and M5c. M5a, M5d and the harness skeleton
are not blocked — do those first.

### Claude — product

- [ ] **M6 · Financial X-Ray.** `XRayPanel` + bidirectional selection between
      analysis rows and document highlights. Highlights are real `<button>`s.
- [ ] **M7 · Overview.** One contrast: headline "financial aid" vs. what the
      student actually does not repay. No dashboard clutter.
- [ ] **M8 · Four-year projection** with a stacked-bar money flow.
- [ ] **M9 · What-if simulator** with before/after deltas in an `aria-live`
      region.
- [ ] **M10 · Uncertainty UI, accessibility, `SourceBadge`,** error and empty
      states.

### Shade — human

- [ ] Add `ANTHROPIC_API_KEY` to `api/.env`, then run one live extraction
      against `fixtures/sample_offer.pdf` and compare it to the fixture. This
      unblocks Codex's M5b/M5c.
- [ ] M11: demo video, Devpost description, slides. Start by Sunday 18:00 PT.

## Cross-lane hazards

The realistic ways this goes wrong, in order of likelihood:

1. **Codex's corpus work reveals a schema gap.** Most likely collision. Handle
   it through rule 2 rather than by editing the schema and hoping.
2. **A fixture regeneration changes ids.** Breaks the engine tests and the UI's
   evidence lookups. Announce first.
3. **Both agents commit to `main` and one clobbers the other.** Mitigated by
   rule 1 plus pulling before starting.
