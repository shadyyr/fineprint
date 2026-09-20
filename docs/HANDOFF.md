# FinePrint engineering handoff

Updated 2026-09-20 during the submission-readiness audit. The current product
HEAD is `805915ed9342c44174017e13ec46d6ce05364d2c` and matches `origin/main`.
All product stabilization work through that commit is committed and pushed;
this audit changes current-state documentation only.

Deadline: Sunday 2026-09-20, 11:59 PM PT. Engineering is feature-frozen. Only
correctness, reliability, accessibility, deployment, severe visual, or
demo-blocking fixes belong in the product now.

## Read first

1. `CLAUDE.md` for non-negotiable product rules.
2. The tail of `docs/CHANGES.log` for live ownership and uncommitted work.
3. `docs/TASKS.md` for the board and lane rules.
4. `docs/PLAN.md` for architecture.
5. `docs/FinePrint_SASEhack_2026_Master_Context.md` for the local, gitignored
   product specification.

`docs/read-fineprint-sasehack-2026-master-cont-linear-goblet.md` is an old
implementation-plan snapshot, not the master context. Ignore it.

## Working rules

- Two agents share one working tree. Saves are immediately visible; there is
  no merge step to catch clobbering.
- Claude owns `web/`; Codex owns `api/`, `corpus/`, and `scripts/`. Announce
  shared-file work in `docs/CHANGES.log` before editing.
- Never use `git add -A`. Stage only explicitly owned paths.
- Commit and push only when Shade asks for that specific action.
- Never add author, collaborator, AI, or co-author trailers.
- Never commit real student letters, extraction dumps, `.env` files, or keys.
  Private local letters belong only in gitignored `uploads/`.
- Shade owns accounts, credentials, billing, Vercel settings, Devpost, slides,
  and video work.

## Product state

The core path is shipped:

```text
PDF/sample → semantic extraction → deterministic evidence gate
→ canonical facts → Overview → ambiguity resolution → Financial X-Ray
→ financing choices → four-year What-If
```

The financial invariants are enforced by the engine and browser regressions:

- gift aid, loans, and work-study remain separate;
- loans and work-study never reduce “Estimated amount to cover”;
- accepted loans reduce only “Still to cover from other sources” and display
  principal borrowed with no invented repayment estimate;
- work-study defaults off and is labelled earned/not paid upfront;
- unknown periods, alternate residency rates, missing costs, and rejected
  evidence are never silently counted;
- rollups, term rows, payment schedules, and after-aid balances are protected
  against duplicate summation;
- source facts, user overrides, and scenario assumptions remain distinct.

Students may enter their own yearly estimates for costs a letter names without
pricing, or a whole yearly cost when the letter contains no cost figure. These
values remain in the overrides layer and are visibly labelled “Your estimate”
or “Provided by you”; clearing one returns it to missing, never to a silent $0.

## Production

- Web: <https://fineprint-aid.vercel.app>
- API: <https://api-six-pi-52.vercel.app>
- Never use `fineprint.vercel.app`; that is a different product.

The public site has two synthetic cached samples. Live text-PDF extraction is
enabled through a server-side web proxy to the separate Vercel FastAPI project.
The API requires a constant-time-checked proxy secret and a forwarded client
identity; Upstash Redis holds atomic per-client hourly and global daily quotas
and public mode fails closed without quota storage. Direct unauthenticated
analysis returns 403. `/debug/ingest` is hidden in public mode. Terra is the
normal model; Sol runs only after typed-output failure, zero verified facts, or
an evidence rejection—not for a legitimate ambiguity. OpenAI SDK retries are
disabled. A model call may use up to 100 seconds; the pipeline has a 150-second
total budget and only starts Sol when at least 30 seconds remain. The web proxy
waits up to 165 seconds. Logs contain usage counts only.

The cached sample path is independent of the API and remains the guaranteed
demo route. A failed personal upload is never replaced with sample results.

On 2026-09-20, GitHub reported successful Vercel checks for both the web and API
projects at the current HEAD. The public web URL returned HTTP 200, and API
`/health` reported live extraction, public mode, proxy identity, and quota
storage all enabled.

## Verified state

Final stabilization checks:

- API: `87 passed` (`pytest api/tests -q`; dependency deprecation warnings only).
- Web: `53 passed` across two Vitest files.
- Corpus: `5/5 passed`, zero invariant violations.
- TypeScript: clean.
- ESLint: clean.
- Next.js 16 production build: clean with `next build --webpack`.
- Secret/sensitive-file scanner: clean across 130 files.
- Browser checks: financing and missing-cost flows at desktop and 390 px;
  four-year calculations; keyboard flow; residency alternatives; error and
  empty states; responsive/layout audit at 1280/1366/1100/900; tab walks at
  1280/1100/900/390/360; and visible-Chrome PDF rendering all pass.
- `/debug/boxes`: sample renders two pages, 48 overlays, sufficient text layer,
  and no browser errors. Rotation behavior is covered in API tests.
- Production manual path: Meridian ambiguity, bidirectional evidence linking,
  both loans, work-study, changed renewal/growth assumptions, 390×844, and the
  alternate Summit sample/evidence linking all behave correctly.

## Remaining human boundary

`H2` was not performed: no private real student letter was placed in `uploads/`
or run through the debugging loop. It is explicitly optional and non-blocking
for submission because the repository already has the five-layout synthetic
corpus, two public demo layouts, a publicly posted institutional sample test,
production live extraction, and the full verification matrix. If Shade later
chooses to add a private letter, keep it in gitignored `uploads/`, report only
generic failure categories, and turn every bug into a synthetic regression.
Never commit or quote the private file, its text, or its model response.

The current product HEAD is deployed successfully. Do not redeploy from an
older commit.

## Known limits

- Text-layer PDFs only. Scans and image-only PDFs fail clearly; OCR is out of
  scope for this release.
- Live extraction depends on Vercel, Upstash, and OpenAI and is subject to the
  configured quotas and provider latency. Samples do not share that dependency.
- FinePrint reports loan principal only. It intentionally does not predict
  interest rates, repayment plans, eligibility, monthly payments, duration, or
  total repayment.
- User-entered missing costs are explicit estimates, not verified letter facts.

## Verification commands

```bash
.venv/bin/pytest api/tests -q
.venv/bin/python corpus/run_corpus.py
cd web && npm test
cd web && npm run typecheck
cd web && npm run lint
cd web && npx next build --webpack
scripts/check_secrets.sh --all
```

Browser scripts and expected output are documented in `web/e2e/README.md`.
Use a local production build on port 3100; only one agent should own the server
ports at a time. Keep `/debug/boxes` intact after any ingest or PDF-rendering
change.
