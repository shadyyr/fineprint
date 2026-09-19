# FinePrint

Turns a college financial-aid offer letter into an evidence-linked financial
model: what is a grant, what is a loan, what must be earned, what the letter
leaves out, and what the decision costs over four years — with every figure
traceable to the exact words on the page.

Built for SASEhack 2026.

## Setup

```bash
# Python extraction service
python3 -m venv .venv
.venv/bin/pip install -r api/requirements.txt

# Web app (also installs the git hooks and the pdf.js worker)
cd web && npm install

# Generate the synthetic sample letter and its fixture
cd .. && .venv/bin/python scripts/make_fixture.py

# Run both services
cd web && npm run dev          # web on :3000, api on :8000
```

For live extraction, copy the env template and add a key:

```bash
cp .env.example api/.env
# Then set OPENAI_API_KEY in api/.env.
```

The extraction service uses the OpenAI Responses API with typed structured
output. Normal extraction uses `gpt-5.6-terra` at medium reasoning. It retries
once with `gpt-5.6-sol` only when Terra fails the typed output contract, the
deterministic evidence gate rejects a claim, no financial fact verifies, or a
material ambiguity blocks headline calculations. Minor ambiguities and
provider failures do not trigger the more expensive model.

Page images are sent only as layout context; the numbered PDF text layer
remains the authoritative source, and every returned amount still has to pass
the deterministic evidence gate before entering the financial model. Responses
are requested with storage disabled because aid letters may contain student
information.

## Checks

```bash
cd web && npm test             # financial engine unit tests
cd web && npm run typecheck
scripts/check_secrets.sh --all # scan the whole tree for secrets
```

`/debug/boxes` renders every extracted line box over the source PDF. Evidence
highlighting depends on the extraction service (PyMuPDF) and the renderer
(pdf.js) agreeing on coordinates, so that page is the check that matters when
anything in the ingest path changes.

## Keeping secrets and student data out of the repository

Two things must never be committed: **API keys**, and **real students' aid
letters**, which contain personal information.

Three layers guard this:

1. **`.gitignore`** covers `.env` at any depth, key material, logs (server logs
   can contain extracted document text), and the `uploads/`, `private/` and
   `scratch/` directories — use those as the landing zone for anything real.
2. **A pre-commit hook** (`.githooks/pre-commit`) runs
   `scripts/check_secrets.sh` against staged content, so a `git add -f` or a
   mistyped path is still caught. It blocks key-shaped strings, `.env` files,
   oversized files, and any PDF outside `fixtures/` or `corpus/letters/`.
3. **Self-healing setup.** The hook lives in a tracked directory and
   `npm install` re-points `core.hooksPath` at it, so a fresh clone does not
   silently lose the protection. To set it up by hand:
   `git config core.hooksPath .githooks`

Only synthetic letters and publicly published institutional samples belong in
`fixtures/` and `corpus/letters/`. If you need to test against a real letter,
put it in `uploads/` and leave it there.

`git commit --no-verify` bypasses the hook. Do not reach for it to get past a
finding you have not read.
