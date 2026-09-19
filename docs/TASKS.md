# Task split and file ownership

Two agents work this repo in parallel. This file is the assignment board;
[CHANGES.log](CHANGES.log) is the running conversation between them.

**The split is by directory, not by feature.** Feature-level splits put both
agents in `web/` editing shared components and a shared store, which collides
constantly. Directory lanes have almost no overlap, because the contract
between them — `fixtures/sample_offer.json` and the dual schema — is already
committed and stable.

**Both agents share one live working tree.** Neither pushing nor committing is
how you talk to the other agent: a file you save is visible to them
immediately, and a line you append to CHANGES.log is readable a second later.
Commits are checkpoints and the submission requirement, not messages.

That cuts both ways. There is no merge step to catch a collision, so two agents
editing the same file do not get a conflict — they get silent clobbering, last
write wins. Lane discipline is the only thing preventing it.

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
4. **Re-read the tail of CHANGES.log before you start, and append before you
   stop.** The log is live — no pull needed. Append as soon as you finish a
   unit of work rather than batching it at the end, because the other agent is
   reading it while you work, and a decision they learn about ten minutes late
   is a decision they may have already worked against.
5. **Do not run the other lane's test suite while they are mid-edit.** A shared
   tree means you would be testing their half-saved files, and the failure you
   report will not be real. Run your own lane's tests.
6. **Port conflicts:** only one agent runs `npm run dev` at a time (3000/8000).
   Codex should use `pytest` and direct `uvicorn` on a different port if needed.
7. **Green before commit:** your lane's tests must pass. Do not commit with the
   other lane broken; if you broke it, say so in the log immediately.
8. **Announce before touching a shared file, not after.** With no merge step,
   "I'll fix it in the conflict" is not available.

## Board

Milestone numbers refer to [PLAN.md](PLAN.md).

### Codex — pipeline

- [x] **M5a · Corpus letters.** At least three layouts beyond our synthetic one,
      each stressing a different assumption:
      a College Financing Plan / Shopping Sheet style tabular form;
      a prose letter with amounts inside sentences;
      a per-term two-column table (stresses period normalization).
      Synthetic variants and publicly published institutional samples only —
      **never a real student's letter** (master context 6.11).
- [x] **M5b · Validation harness.** `corpus/run_corpus.py` reporting per letter:
      items extracted, % evidence verified, unresolved ambiguities, invariant
      violations, and a diff against hand-checked `corpus/expected/`.
      Pass bar: no invariant violations, no unverified claim shown as fact, and
      every genuinely ambiguous period surfaced rather than guessed.
      *A layout that extracts poorly but reports its uncertainty correctly is a
      pass. One that extracts confidently and wrongly is a failure.*
- [x] **M5c · Harden extraction** against what the corpus breaks. Prompt work in
      `api/extract.py`; verification logic in `api/evidence.py`.
- [x] **M5d** Make the harness runnable without an API key via `ReplayExtractor`
      and committed model responses, so it works in CI and when the key is out.

The offline corpus passes 3/3, and the live corpus has reached OpenAI with every
returned fact passing the evidence gate. Optional comparator polish remains for
institution-name casing and replay-only deliberately rejected claims.

#### Codex — next, queued 2026-09-19 (in priority order)

- [ ] **S1 · A second demo sample, in a different layout.** Judges can only try
      the sample on the public site (no Python service there), and one letter
      shaped exactly like our own generator's output undersells what the
      pipeline does. Pick the corpus letter that shows a *different* capability
      best — likely `per_term_offer.pdf` (per-term columns → period
      normalization) or `college_financing_plan.pdf` (standardized federal
      form) — and say in the log why you chose it.
      **Contract with Claude's lane (read before starting):**
      - Produce it with the real pipeline (live extraction, then the evidence
        gate), not by hand, so the sample is honest evidence the pipeline works.
      - Set `extraction_meta.source` to **`"cached"`** — it is a stored result
        of a live run, and the UI's source badge must not call a stored result
        "Read live". `document.synthetic: true`.
      - Must parse under BOTH `api/models.py` and `web/lib/schema.ts`. Schema
        stays frozen (TASKS rule 2).
      - Write `fixtures/samples/<slug>.{pdf,json}`, and have a script in
        `scripts/` mirror them to `web/public/samples/` plus a manifest
        `web/public/samples/index.json`:
        `[{"slug","title","layout","note","pdf":"/samples/<slug>.pdf","json":"/samples/<slug>.json"}]`.
        Include the existing Meridian sample as the first entry, pointing at
        `/sample_offer.pdf` and `/sample_offer.json`. `web/public/samples/` is
        generated output of your script — Claude will not hand-edit it.
      - The pre-commit scanner blocks PDFs under `web/public/` except the one
        named file. Widen it narrowly: `^web/public/samples/[a-z0-9_-]+\.pdf$`.
      - Claude builds the sample picker against the manifest (task UI-S1).
- [ ] **D1 · Devpost write-up + a "for judges" README section.** Draft
      `docs/DEVPOST.md` on master context §25's skeleton (Inspiration, What it
      does, How we built it, Challenges, Accomplishments, What we learned,
      What's next). Judges read this closely. Requirements:
      - **Re-verify every statistic** from §5 against its live source before
        using it; drop any you can't confirm. No unsourced numbers.
      - Answer "is this an LLM wrapper?" with the measured facts (CHANGES.log
        019): one model call site (`api/extract.py`), ~6% of application code;
        zero network requests when a student answers questions or explores
        scenarios; every model claim checked against the letter's text.
      - Public link is **https://fineprint-aid.vercel.app** — never
        `fineprint.vercel.app`, which is someone else's product (log 018).
      - Be honest about limits: text PDFs only (no OCR); live upload needs the
        Python service (see P1).
      - Tracks: Best Finance Hack; Education/Accessibility/Social Impact framed
        around first-generation students and families (CLAUDE.md), not ARIA.
      - List the screenshots worth capturing. Shade finalizes and submits.
- [ ] **V1 · One real, publicly published sample letter.** Many schools publish
      an example award letter with a fictional student. Find one, confirm it is
      a published sample (never a real student's letter — §6.11), run it through
      the live pipeline, and report what verified, what was flagged, and what
      broke. Commit it to `corpus/letters/` only if its terms allow, with the
      source URL in `corpus/README.md`. Evidence that FinePrint works on a real
      school's format is worth more than another synthetic layout.
- [ ] **P1 · Public API deployment — prepare, but Shade decides.** Live upload
      on the public site needs the FastAPI service at a public HTTPS URL plus
      `FINEPRINT_API_URL` set in Vercel's settings and a redeploy. Deploying it
      spends Shade's OpenAI credits on anyone who visits and puts a PII-handling
      endpoint on the internet, so **do not turn it on without Shade's
      explicit go-ahead.** Prepare the config (Render/Railway/Fly), per-IP rate
      limiting, a daily request cap, no logging of document contents, and a
      one-paragraph cost/risk note for Shade.
- [ ] **M5c-polish** (optional): semantic comparator for institution casing and
      replay-only rejected claims.

### Claude — product

- [x] **M6 · Financial X-Ray.** `XRayPanel` + bidirectional selection between
      analysis rows and document highlights. Highlights are real `<button>`s.
- [x] **M7 · Overview.** One contrast: headline "financial aid" vs. what the
      student actually does not repay. No dashboard clutter.
- [x] **M8 · Four-year projection** with a stacked-bar money flow.
- [x] **M9 · What-if simulator** with before/after deltas in an `aria-live`
      region.
- [x] **M10 · Uncertainty UI, accessibility, `SourceBadge`,** error and empty
      states. (CHANGES.log 029–032.)
- [ ] **UI-S1 · Sample picker** reading `web/public/samples/index.json`.
      Blocked on Codex's S1; falls back to the single Meridian sample until the
      manifest exists.

### Shade — human

- [x] Add `OPENAI_API_KEY` to `api/.env` and complete a live extraction run.
- [x] M11: public README and deployed sample-demo URL.
- [ ] M11: demo video, Devpost description, screenshots, and slides. Start by
      Sunday 18:00 PT.

## Cross-lane hazards

The realistic ways this goes wrong, in order of likelihood:

1. **Codex's corpus work reveals a schema gap.** Most likely collision. Handle
   it through rule 2 rather than by editing the schema and hoping.
2. **A fixture regeneration changes ids.** Breaks the engine tests and the UI's
   evidence lookups. Announce first.
3. **Silent clobbering of a shared file.** On one live tree there is no merge
   step and no conflict marker — the second save simply wins and the first
   agent's work is gone with no signal. This is the failure mode a shared tree
   adds over separate clones, and lane discipline is the entire defence.
4. **`git add -A` from either agent** sweeping the other's in-progress files
   into a commit. See rule 1.
