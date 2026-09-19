# FinePrint

> Know what your financial-aid offer actually means.

FinePrint turns a college financial-aid offer letter into an evidence-linked
financial model. It separates grants and scholarships from loans and
work-study, calls out missing or ambiguous information, and lets a student
trace every figure back to the exact words in the source PDF.

**[Open the live demo](https://fineprint-aid.vercel.app/)** ·
**[Jump straight to the synthetic sample](https://fineprint-aid.vercel.app/analyze?sample)**

Built for [SASEhack 2026](https://sase-hack.notion.site/SASEhack-2026-Hacker-Guide-38b9bed74f8e8093aba7fd8132b70a16),
with Best Finance Hack as the primary track and Education, Accessibility, or
Social Impact as the secondary track.

## The problem

An offer letter can advertise a large “financial aid” total while combining
money a student keeps, money they must repay, and wages they still have to
earn. The same letter may omit common expenses or show an award without saying
whether it applies for one term, one year, or four years.

That makes a life-changing decision unnecessarily hard—especially for students
and families navigating college financing for the first time.

FinePrint turns that letter into a clearer set of questions:

- How much is gift aid that never has to be repaid?
- How much is debt or work-study presented as “aid”?
- What will the student still need to cover in the first year?
- Which costs are absent, and which amounts are too ambiguous to count?
- Where, exactly, did every number come from?

## What the demo shows

- **A plain-language overview.** The sample letter says `$45,400` in financial
  aid; FinePrint shows that only `$16,900` is confirmed gift aid for the year.
- **Honest uncertainty.** A `$20,000` scholarship has no stated period.
  FinePrint asks whether it is annual or a four-year total and shows the
  financial consequence of each answer before the user chooses.
- **A Financial X-Ray.** Selecting an analyzed item highlights its exact words
  in the PDF. Selecting a document highlight moves back to the matching item.
- **No silent guessing.** Missing costs remain missing, unknown periods remain
  unknown, and unverified model claims are excluded from every calculation.
- **Deterministic financial math.** AI interprets the letter; pure TypeScript
  functions handle totals, period normalization, rollups, projections, and
  scenarios.
- **Accessible interactions.** Categories use labels and icons in addition to
  color, evidence is keyboard reachable, and dynamic updates are announced to
  assistive technology.

### A 60-second walkthrough

1. Open the [live demo](https://fineprint-aid.vercel.app/) and choose
   **Try a sample offer**.
2. Compare the letter's headline aid figure with the confirmed gift aid.
3. Answer the open `$20,000` scholarship question and watch the first-year
   amount update.
4. Select a grant, loan, cost, or missing item to open the Financial X-Ray.
5. Select rows and PDF highlights in both directions to inspect the evidence.

The hosted Vercel experience always supports the committed synthetic sample.
Uploading a personal PDF is enabled only when the deployment can reach the
Python extraction service; otherwise FinePrint says so before a file is
selected. Locally, both services run together and live extraction is available
when an OpenAI API key is configured.

## How it works

```text
PDF
 ├─ PyMuPDF extracts numbered text lines and exact geometry
 └─ page images provide layout context only
              │
              ▼
OpenAI Responses API returns typed claims with line IDs and exact quotes
              │
              ▼
Python evidence gate verifies quote + amount against the PDF text layer
              │
              ▼
Canonical JSON: verified facts, ambiguities, missing costs, rejected claims
              │
              ▼
Next.js UI + pure TypeScript engine + pdf.js evidence overlays
```

The model never invents highlight coordinates. It cites a stable line ID and
an exact quote; FinePrint resolves that citation to the PDF geometry itself.
For a financial fact to enter the model, the cited quote must exist in the
line and the amount parsed from that text must match the claimed amount.

This creates a hard boundary:

- verified claims become facts and may participate in calculations;
- failed claims are kept separately as unverified and never enter the math;
- image-only or scanned PDFs are rejected because FinePrint cannot prove their
  figures against an authoritative text layer;
- ambiguous periods block affected headline calculations until the user
  resolves them.

## Model routing

Normal extraction uses `gpt-5.6-terra` at medium reasoning. FinePrint retries
once with `gpt-5.6-sol` only when Terra fails the typed output contract, the
deterministic evidence gate rejects a claim, no financial fact verifies, or a
material ambiguity blocks headline calculations. Minor ambiguity and provider
failures do not automatically invoke the more expensive model.

Aid letters may contain private student information, so extraction is
stateless and OpenAI response storage is disabled. FinePrint does not persist
uploaded PDFs or analyses; the browser keeps the active analysis for the
current tab.

## Architecture and stack

| Layer | Technology | Responsibility |
|---|---|---|
| Web | Next.js 16, React 19, TypeScript, Tailwind CSS | Product UI, state, accessible interactions |
| Financial engine | Pure TypeScript, Vitest | Year-one math, period handling, projections, scenarios |
| PDF viewer | pdf.js | Document rendering and evidence overlays |
| API | FastAPI, Pydantic | Upload validation, orchestration, canonical response schema |
| Document ingest | PyMuPDF | Text lines, stable IDs, bounding boxes, page images |
| Extraction | OpenAI Responses API | Typed interpretation of nonstandard offer letters |
| Validation | Python admission gate + synthetic corpus | Quote/amount verification and multi-layout regression testing |
| Hosted demo | Vercel | Frontend and committed synthetic sample |

The API performs document interpretation but no financial arithmetic. The
browser engine is deterministic and recomputes locally, which keeps scenarios
instant and makes every calculation independently testable.

## Repository map

```text
fineprint/
├── api/          FastAPI extraction, verification, normalization, tests
├── corpus/       Synthetic multi-layout PDFs, replay responses, answer keys
├── fixtures/     Canonical synthetic demo PDF and JSON
├── scripts/      Fixture/corpus generation and secret scanning
├── web/          Next.js application and TypeScript financial engine
└── docs/         Architecture, plans, and agent coordination history
```

## Run locally

Prerequisites: Python 3.11+ and Node.js 20+.

```bash
git clone https://github.com/shadyyr/fineprint.git
cd fineprint

# Python extraction service
python3 -m venv .venv
.venv/bin/pip install -r api/requirements.txt

# Next.js app, pdf.js worker, and repository hooks
cd web
npm install
cd ..
```

To enable live PDF extraction, copy the environment template and add a project
API key:

```bash
cp .env.example api/.env
# Set OPENAI_API_KEY in api/.env.
```

Then run both services:

```bash
cd web
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The Next.js app runs on
port `3000`, and the development command starts FastAPI on port `8000`.
Without an API key, the synthetic sample still works.

The available model settings are documented in [`.env.example`](.env.example):

```dotenv
FINEPRINT_MODEL=gpt-5.6-terra
FINEPRINT_FALLBACK_MODEL=gpt-5.6-sol
FINEPRINT_REASONING_EFFORT=medium
```

If the Python service is hosted separately, set `FINEPRINT_API_URL` in
`web/.env.local` to its reachable URL. The browser never receives the OpenAI
key; Next.js proxies requests to FastAPI server-side.

## Verification

```bash
# Python API, evidence gate, routing, and corpus tests
.venv/bin/pytest api/tests -q

# Deterministic offline multi-layout validation
.venv/bin/python corpus/run_corpus.py

# Financial engine and frontend checks
cd web
npm test
npm run typecheck
npm run lint
cd ..

# API keys, sensitive files, oversized artifacts, and PDF placement
scripts/check_secrets.sh --all
```

The corpus contains three fictional layouts: a College Financing Plan-style
table, a narrative letter, and a per-term two-column offer. Replay responses
make the admission gate testable without an API key; `--live` runs those same
documents through the configured models. See [corpus/README.md](corpus/README.md)
for details.

`/debug/boxes` is the coordinate-system check. It draws every extracted line
box over the rendered PDF so changes to PyMuPDF or pdf.js cannot silently break
evidence highlighting.

## Privacy, safety, and limitations

- Never commit a real student's aid letter. The repository contains only
  synthetic documents and has a pre-commit scanner for keys, `.env` files,
  oversized files, and PDFs outside approved sample directories.
- FinePrint currently requires a text-based PDF. OCR and image-only documents
  are intentionally unsupported until they can meet the same evidence bar.
- Work-study is not treated as a discount by default because the student must
  earn it through work.
- Loan principal is modeled separately. Interest is not guessed when an offer
  does not provide a rate.
- FinePrint is an educational decision-support tool, not financial advice.

For the deeper design rationale and implementation milestones, see
[docs/PLAN.md](docs/PLAN.md).
