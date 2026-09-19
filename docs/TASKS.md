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
   engine tests are built against it. Codex owns regeneration (it comes
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

The offline corpus passes 5/5, and the live corpus has reached OpenAI with every
returned fact passing the evidence gate. Optional comparator polish remains for
institution-name casing and replay-only deliberately rejected claims.

#### Codex — next, queued 2026-09-19 (in priority order)

- [x] **S1 · A second demo sample, in a different layout.** Judges can only try
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
- [x] **D1 · Devpost write-up + a "for judges" README section.** Draft
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
- [x] **V1 · One real, publicly published sample letter.** Many schools publish
      an example award letter with a fictional student. Find one, confirm it is
      a published sample (never a real student's letter — §6.11), run it through
      the live pipeline, and report what verified, what was flagged, and what
      broke. Commit it to `corpus/letters/` only if its terms allow, with the
      source URL in `corpus/README.md`. Evidence that FinePrint works on a real
      school's format is worth more than another synthetic layout.
- [x] **P1 · Public API deployment — prepare, but Shade decides.** Live upload
      on the public site needs the FastAPI service at a public HTTPS URL plus
      `FINEPRINT_API_URL` set in Vercel's settings and a redeploy. Deploying it
      spends Shade's OpenAI credits on anyone who visits and puts a PII-handling
      endpoint on the internet, so **do not turn it on without Shade's
      explicit go-ahead.** Prepare the config (Render/Railway/Fly), per-IP rate
      limiting, a daily request cap, no logging of document contents, and a
      one-paragraph cost/risk note for Shade.
- [ ] **M5c-polish** (optional): semantic comparator for institution casing and
      replay-only rejected claims.

#### Codex — second batch, queued 2026-09-19 evening (in priority order)

Shade's direction: go live with P1 for the demo video, try real offer letters
and debug from them, and handle in-state vs out-of-state costs. Codex has more
usage than Claude right now, so Codex carries every task that isn't `web/`.

- [x] **S1-FIX · Per-term rows are double-counted (do this first — it also
      breaks live uploads of any Fall/Spring letter).** Summit stores each term
      as its own item with `period: "semester"` ("Federal Pell Grant — Fall
      2026", $3,200). The engine annualizes a semester amount x2, so Fall and
      Spring each count as a full year: gift aid $33,000 instead of $16,500,
      and costs and loans doubled the same way. There is no schema field that
      says "this row is one specific term". **Contract (no schema change):**
      - In `normalize.py`, when the letter lists the same award/cost as
        explicitly term-labelled rows that together make up the academic year
        (e.g. Fall + Spring), emit ONE item: `amount` = the sum, `period:
        "annual"`, `provenance: "derived"`, `evidence_ids` = every term row's
        evidence, label without the term suffix. Same for costs, loans,
        work-study, and per-term rollups (rollup → `provenance: "derived"`;
        the UI quotes only `provenance: "source"` rollups as "the letter says").
      - If a term of the year is missing or the labels don't clearly
        partition the year, don't sum and don't double: surface it (period
        `unknown` + ambiguity), never guess.
      - Regenerate Summit (ids will change — Claude doesn't depend on them) and
        the per-term corpus expectation. Claude's engine test
        `per-term letter (Summit sample)` expects gift aid **16,500** with the
        $10,000 scholarship pending; unskip it when done
        (`web/lib/engine/engine.test.ts`, one `it.skip`).
      - Claude holds the UI-S1 push until this lands, so nobody can open
        Summit with doubled numbers.
- [x] **P2 · Activate the public API with Shade — on Vercel, not Render.**
      Shade approved going live (log 051) and chose Vercel (log 054): the API
      becomes a **second Vercel project** from the same repo with Root
      Directory `api/`, next to the existing `web/` project. Few paid runs;
      Shade already has an OpenAI project key with a hard limit (in
      `api/.env` locally — never read, print or commit it; Shade pastes it
      into Vercel). `render.yaml` / Render are dropped.
      **Codex prepares `api/` for Vercel:**
      - FastAPI zero-config entrypoint (`app` in a supported entrypoint file),
        `api/vercel.json` with `maxDuration: 120` for it and `excludeFiles`
        for tests/fixtures; confirm the bundle (PyMuPDF etc.) fits Vercel's
        Python size limit — build it and report the size.
      - **Quota store → Upstash Redis** (Vercel Marketplace, free tier). The
        disk SQLite can't work: Vercel functions have no persistent disk.
        Same limits (per-client hourly + global daily), atomic counters with
        expiry, HMAC'd client ids only. Read the env var names the Upstash
        integration injects. If Redis isn't configured in public mode, fail
        closed (503), never unlimited.
      - Nothing writes to disk except `/tmp` if unavoidable.
      - Update `docs/DEPLOY_API.md` to the Vercel steps; delete or mark
        `render.yaml` unused.
      **Contract with Claude's lane (web side already built, log 053):**
      - The web route sends `X-FinePrint-Client-IP` and
        `X-FinePrint-Proxy-Secret` (env `FINEPRINT_PROXY_SECRET`, same value in
        both projects). **In public mode, `/analyze` rejects any request
        without the correct secret** (constant-time compare) — so the API's
        public URL only works through the website. Rate-limit by the
        forwarded client IP.
      - Every non-2xx body is `{"detail": "<one student-facing sentence>"}`;
        429 carries `Retry-After` (seconds).
      - The web waits up to 90 s; report measured live-read times on Vercel.
      - Verify the disclosure's OpenAI claim in `web/app/StartActions.tsx`
        ("doesn't train on it but may keep it for up to 30 days for abuse
        checks") against OpenAI's current API data policy; tell Claude if off.
      **Order with Shade:** deploy with `FINEPRINT_PUBLIC_API_ENABLED=false` →
      connect Upstash → check `/health` and that `/analyze` is 503 → enable →
      smoke-test with the synthetic Meridian PDF only (secret header, 429 +
      Retry-After, counters survive a redeploy) → only after Claude has pushed
      the web side (disclosure + headers), Shade sets `FINEPRINT_API_URL` and
      `FINEPRINT_PROXY_SECRET` on the web project and redeploys.
      **Completed:** the protected API is live at
      `https://api-six-pi-52.vercel.app`; the web proxy is connected, Upstash
      quota storage is configured, direct unauthenticated analysis is rejected,
      and cached samples remain independent of API availability.
- [x] **H1 · Real-letter hardening (V1's finding).** Payment-schedule lines
      (amount due per term, installments), "after aid" balances and similar
      views of the same money must never become summable cost items. Add a
      relationship guard (normalize/evidence) so they become non-summable or go
      to `unverified_claims` with a reason. Regression: a **synthetic** corpus
      letter reproducing the STAC pattern (committed, with replay response) +
      the STAC PDF from its public URL (temporary, not committed). Corpus stays
      green; Meridian and Summit fixtures unchanged (announce if not).
- [ ] **H2 · Shade's real-letter debugging loop.** When Shade puts a real
      letter in `uploads/` (gitignored), run it through the local live
      pipeline and report verified / flagged / broken in the log **without any
      personal data** (no names, IDs, addresses; describe rows generically).
      Fix pipeline bugs in `api/`, and add a synthetic reproduction to the
      corpus for each. Never commit the letter, its text or its extraction.
- [x] **R1 · Residency / alternative rates (pipeline half).** Most award letters
      already show the student's own rate. But a letter that lists both an
      in-state and an out-of-state rate (or any mutually exclusive rate
      schedules) must neither sum both nor pick one. **Contract (no schema
      change — uses the existing `amount_unclear` kind):**
      - Emit ONE cost item for that row; `amount` = the first option (it stays
        excluded until answered).
      - Emit an ambiguity: `kind: "amount_unclear"`, `target: "<cost_id>.amount"`,
        `severity: "material"`, `blocks_headline: true`, options
        `value` = the amount as a plain decimal string (`"19800"`), `label` like
        `"In-state: $19,800 a year"`, `evidence_ids` covering every option row.
        Each option amount must pass the evidence gate.
      - If the letter states which rate applies, extract only that rate and
        emit no ambiguity. Never infer residency from address or school.
      - Add a synthetic corpus letter with both rates + expected output +
        replay response.
      Claude builds the engine/UI half (task UI-R1) against this contract.
- [x] **L1 · Live verification sweep** after each push that touches `web/`:
      run `web/e2e/*.mjs` against https://fineprint-aid.vercel.app
      (puppeteer-core installed outside the repo; see `web/e2e/README.md`),
      including `headed.mjs` once, and log the results. Read-only for `web/`.
- [x] **HO · Refresh `docs/HANDOFF.md`** to the final state before submission
      (announce first; shared doc).

#### Codex — cost batch, queued 2026-09-19 (Shade approved; after the current prompt)

From Claude's cost audit (CHANGES.log 067). A typical live upload is Terra +
Sol ≈ $0.20–0.30 because Sol also fires on legitimate ambiguities. All three
are in `api/`; no schema or web change.

- [x] **C1 · Stop the Sol retry on material ambiguities.** In `api/pipeline.py`,
      remove `MATERIAL_AMBIGUITIES` from `fallback_reasons()`. An open question
      is the correct output under the never-infer rule, not a failure. Keep Sol
      for: structured-output validation failure, zero verified facts, and any
      claim rejected by the evidence gate. Update the pipeline tests and the
      routing docstring, and every current-state doc that describes the old
      trigger (README, docs/HANDOFF.md §4 "Model", docs/DEPLOY_API.md cost
      note, docs/DEVPOST.md if it mentions it). Historical log entries stay.
- [x] **C2 · Log token usage — counts only.** After each `responses.parse`,
      log one line per call: model, input_tokens, output_tokens,
      reasoning_tokens (from `usage.output_tokens_details`), cached input
      tokens if present, whether it was the Sol fallback, and elapsed ms.
      Never log document text, quotes, filenames, model output or client IP
      (same privacy rule as P2). Missing `usage` must not break the request.
      Test it with a fake client. Then tell Shade how to read these in Vercel
      logs, and after the next real run report the measured cost per upload
      (Terra $2/$12, Sol $4/$20 per 1M in/out) to replace Claude's estimate.
- [x] **C3 · No silent paid retries.** Construct the OpenAI client with
      `max_retries=0` (or 1 if you judge a single retry on connection errors
      worth it — say which and why), so one upload can't be billed several
      times by the SDK's automatic retries. Keep the 90 s web budget in mind:
      the per-call timeout must still fit inside it. Test that the setting is
      applied.

Acceptance: `.venv/bin/pytest api/tests -q` and the corpus green; the cost
note in docs/DEPLOY_API.md updated to "Terra only, unless the output fails
validation, has no verified facts, or has a rejected claim".

Completed in the final stabilization pass: ambiguities remain Terra results;
usage logging is content-free and tolerates absent metadata; SDK retries are
`0`; each provider call times out at 40 seconds so an explicit primary plus
fallback fits inside the 90-second proxy window. The next production upload
after deployment will provide the first measured usage/cost sample in Vercel
logs; no paid call was made merely to populate that number.

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
- [x] **UI-S1 · Sample picker** reading `web/public/samples/index.json`.
      Built and tested (log 053); push held until Codex's S1-FIX.
- [x] **UI-P2 · Web half of P2.** (log 053) Privacy disclosure shown before a real letter
      can be uploaded; client-side size check under Vercel's ~4.5 MB request
      limit; the analyze route's time limit on Vercel; forward the client-IP +
      secret headers (contract in P2); 429 message with the wait time.
- [x] **UI-R1 · Residency / alternative rates (engine + UI half).** (log 053) Engine
      applies `<id>.amount` answers from `amount_unclear` ambiguities and
      excludes the item until answered; the question renders like the period
      question; tests.

### Shade — human

- [x] Add `OPENAI_API_KEY` to `api/.env` and complete a live extraction run.
- [x] M11: public README and deployed sample-demo URL.
- [ ] M11: demo video, Devpost description, screenshots, and slides. Start by
      Sunday 18:00 PT.
- [x] P2 on Vercel (log 054): new Vercel project for `api/`, its env vars
      (OpenAI key pasted by Shade), Upstash Redis from the Marketplace, then
      `FINEPRINT_API_URL` + `FINEPRINT_PROXY_SECRET` on the web project.
      Codex walks through it; only Shade touches keys and billing.
- [ ] Real letters for H2: put them in `uploads/` (gitignored), never elsewhere.

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
