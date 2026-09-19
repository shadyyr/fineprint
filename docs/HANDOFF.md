# Handoff — pick up here

Written 2026-09-19 at the end of the first Claude session so a fresh session can
continue without the old conversation. Read this whole file, then the files in
§1. It is the state of the project at `106a75b`; anything newer is in the tail
of [CHANGES.log](CHANGES.log).

**Deadline: Sunday 2026-09-20, 11:59 PM PT.** No code changes after that.

---

## 1. Read these, in this order

1. **This file.**
2. [`CLAUDE.md`](../CLAUDE.md) — the rules that are not negotiable.
3. [`docs/FinePrint_SASEhack_2026_Master_Context.md`](FinePrint_SASEhack_2026_Master_Context.md)
   — the product spec. §6–8 are scope, §13 financial semantics, §17 the demo
   script, §24 the "must not do" list. *If this file is missing, ask Shade for
   it: it was an attachment in the first chat and is not recoverable from the
   code.*
4. [`docs/TASKS.md`](TASKS.md) — who owns what, the rules for two agents
   sharing one tree, and the task board.
5. The **tail** of [`docs/CHANGES.log`](CHANGES.log) — the last few entries are
   the current state. Earlier entries hold the reasoning behind decisions.
6. [`docs/PLAN.md`](PLAN.md) — architecture of record. (Ignore
   `docs/read-fineprint-...-goblet.md`: an old snapshot of it.)

---

## 2. How Shade works — follow these exactly

- **No Claude attribution, ever.** No `Co-Authored-By`, no "Generated with
  Claude Code", on any commit or PR. Every commit is authored as shade rahman.
  Check trailers before pushing: `git log -1 --pretty='%(trailers:only)'`.
- **Commit and push only when asked, and treat each ask separately.** Shade
  often says "commit, don't push" — Codex or Shade may push. Asking to push
  once does not authorize the next push.
- **Never `git add -A`.** Two agents share this working tree; stage your own
  lane by path (`git add web/ docs/...`). Run `git status` first — Codex's
  uncommitted work may be sitting there.
- **Verify, then report with evidence.** Shade responds well to measured
  claims ("0 network requests", "matches the engine test to the dollar") and to
  honest "I could not reproduce this" when true. Don't claim a fix you have not
  watched work.
- **Pronouns:** not stated — use they/them.

---

## 3. Two agents, one tree

| Lane | Owner | Directories |
|---|---|---|
| Product | **Claude** | `web/` |
| Pipeline | **Codex** | `api/`, `corpus/`, `scripts/` |
| Shared | agreement first | `fixtures/`, `web/lib/schema.ts` ↔ `api/models.py`, `docs/`, root files |
| Human | Shade | keys, Vercel settings, video, Devpost, slides |

- Saving a file is visible to the other agent instantly. **`docs/CHANGES.log`
  is the conversation between agents**: append-only, newest at the bottom, the
  last entry is the current state. Append when you finish a unit of work.
- There is no merge step, so two agents editing one file silently clobber each
  other. Stay in your lane; announce in the log *before* touching a shared file.
- **The schema is frozen**: `web/lib/schema.ts` and `api/models.py` describe the
  same JSON. Changing one without the other breaks the other lane.
- Only one agent runs `npm run dev` (ports 3000/8000) at a time. For local
  checks use `next start -p 3100`.

---

## 4. Where things stand

### Shipped
| Milestone | What | Commit |
|---|---|---|
| M0–M3 | Schema, fixture, pure TS engine, PyMuPDF ingest with verified geometry | `eee0466` |
| M4–M5 | Live extraction (OpenAI), deterministic evidence gate, 3-layout corpus + replay harness | Codex, `d5c21dc` |
| M6–M7 | Landing page, Overview contrast, Financial X-Ray | `6c3c046` |
| fixes | X-Ray on narrow screens + print; secret scanner catches `sk-proj-` keys | `47a2d05`, `e409a12` |
| fix | Upside-down letter on real Macs (render into a fresh canvas each time) | `351c599` |
| M8–M9 | Four-year projection + what-if simulator | `106a75b` |

- `origin/main` is at `dcff426`. **`106a75b` is committed locally and not
  pushed** as of this writing — check `git status -sb`.
- Tests: `cd web && npm test` → **31 pass**. `.venv/bin/pytest api/tests -q` →
  **45 pass**. `.venv/bin/python corpus/run_corpus.py` → **3/3**.

### Live site
- **https://fineprint-aid.vercel.app** — the only correct link.
  **Never use `fineprint.vercel.app`**: it is an unrelated product also called
  "FinePrint", and it answers every path with 200, so a link check won't catch
  the mistake.
- Vercel settings Shade set: Framework Preset **Next.js**, Root Directory **web**.
- `/api/health` returns `{"reachable":false,"live":false}` on Vercel: there is
  no public Python service, so upload is disabled with an explanation and the
  **sample path runs entirely in the browser**. That is intended. Making upload
  live is Codex task P1 and needs Shade's go-ahead (it spends Shade's OpenAI
  credits on every visitor and handles uploaded student letters).

### Model
OpenAI Responses API, `gpt-5.6-terra` at medium reasoning; one `gpt-5.6-sol`
retry only on schema failure, zero verified facts, a claim rejected by the
evidence gate, or a blocking ambiguity (CHANGES.log 017). Key in `api/.env`
(gitignored). **The model is called in exactly one place: `api/extract.py`.**

---

## 5. What to do next

### Claude — your queue
1. **M10 polish.** Candidates, in rough value order:
   - On phones the what-if controls sit above the results, so a change's effect
     is a scroll away. A small pinned "Left to cover: $X (±$Y)" bar while the
     section is on screen would fix it.
   - Keyboard walk-through of the whole demo path (Overview → question →
     X-Ray rows → what-if) and a screen-reader pass over the chart tables and
     the `aria-live` comparison.
   - JavaScript `scrollIntoView({behavior:"smooth"})` ignores the CSS
     reduced-motion rule; respect `prefers-reduced-motion` in the three places
     that call it (`XRay.tsx`, `AnalyzeView.tsx`).
   - README's "What the demo shows" was written before M8/M9 — coordinate with
     Codex (task D1 owns the README's judges section).
2. **UI-S1 · sample picker** once Codex lands S1. Contract in TASKS.md: read
   `web/public/samples/index.json` (`[{slug,title,layout,note,pdf,json}]`),
   fall back to the single Meridian sample if it's missing. A sample's
   `extraction_meta.source` will be `"cached"`; the badge must say so.
3. Support Shade's M11 (video, Devpost, slides) — screenshots, the demo path.

### Codex — queued in TASKS.md
S1 second demo sample in a different layout → D1 Devpost draft → V1 a real,
publicly published sample letter → P1 public API (prepare only) → M5c polish.

### Decisions only Shade can make
- **P1**: put the extraction API online? (Cost + PII exposure; optional under
  the rules; the video can show live upload on localhost instead.)
- **The master context file**: it holds judging strategy and competitor notes.
  It's in `docs/` for agents to read and **gitignored** so it isn't published
  with the public repo. Remove its line from `.gitignore` only if Shade wants it
  public.

---

## 6. Things that already cost time — don't relearn them

### Next.js 16 (read `web/node_modules/next/dist/docs/` before guessing)
- A client `useSearchParams` without a Suspense boundary **works in dev and
  fails `next build`**. `/analyze` reads `?sample` in a server component
  instead.
- `export const dynamic` is gone from route segment config. A GET handler that
  reads no request data can be prerendered at build time — `/api/health` calls
  `connection()` to prevent baking in "unreachable".
- `next dev` **rejects dev connections from `127.0.0.1` when served as
  `localhost`** (HMR websocket fails, page never hydrates, shows "No offer
  loaded"). Use `http://localhost:PORT` for dev; `next start` is fine on
  `127.0.0.1`.
- Turbopack refuses a `node_modules` symlink pointing outside the project.
  Use `next dev --webpack` if you need that.

### pdf.js 6
- `destroy()` lives on the **loading task**, not the document proxy.
- Import it lazily in the browser only (`lib/pdf.ts`); a top-level import runs
  it on the server during SSR.
- **Never draw into a canvas that is on screen or still rendering.** A second
  render that resizes a canvas wipes the flip, scale and white fill pdf.js set
  up, and the first render finishes in raw PDF coordinates: upside down,
  unscaled, transparent. Each render now gets a fresh canvas swapped in when
  complete, and superseded renders are cancelled. Pass pdf.js only
  `{ canvas, viewport }`, with the pixel ratio folded into the viewport scale.
- The trigger was a **real, space-taking scrollbar** appearing in the letter
  pane mid-render (any Mac with a mouse, Windows). **Headless Chrome, WebKit and
  Firefox all passed while the live site was broken.** Use
  `web/e2e/headed.mjs` (a visible window) for rendering bugs.
- Printing re-lays the page out and fires the width observer; it is guarded so
  the letter is not re-rendered mid-snapshot. `print-color-adjust: exact` keeps
  the bar and swatches in print.

### Coordinates (PyMuPDF ↔ pdf.js)
PyMuPDF reports geometry for the **unrotated** page; pdf.js applies `/Rotate`.
`api/ingest.py` applies `page.rotation_matrix`. Verified at 0/90/180/270°. Don't
"simplify" it away. `/debug/boxes` draws every extracted line box over the page.

### Security guard (`scripts/check_secrets.sh`, pre-commit hook)
- OpenAI project keys are `sk-proj-…` with hyphens; the scanner names those
  prefixes explicitly. Keep the Anthropic patterns too (a key is a key).
- PDFs are blocked outside `fixtures/`, `corpus/letters/` and the one allowed
  `web/public/sample_offer.pdf`. Never commit a real student's letter.
- A fresh clone re-enables the hook through `npm install` (`core.hooksPath`).

### Design system (see `web/app/globals.css`)
Category colors came from the dataviz palette validator, not by eye: gift
`#008300`, loans `#d55181`, work-study `#2a78d6`, needs-an-answer `#4a3aa7`,
"you cover" neutral `#4a5163`. The first draft (orange loans) made gift and
loans nearly identical to red-green colorblind readers. Every category also
carries an icon and a text label. One hero figure per page (the Overview's
gift-aid number). Light mode only, deliberately.

### Honesty rules baked into the UI
- A precomputed result always shows the "Precomputed sample" badge; `POST
  /analyze` never falls back to the fixture (it would show another school's
  numbers for someone's own letter).
- Periods are never guessed; an unanswered question keeps that award out of
  every total and says so.
- Money never goes negative: when gift aid exceeds costs, "left to cover" is $0
  with a note that schools usually reduce aid when costs drop.
- Award conditions are quoted in the letter's own words, never paraphrased.

---

## 7. Verify before you claim anything

```bash
cd web && npm test && npm run typecheck && npx eslint app components lib store
cd web && npx next build            # catches the prod-only Next 16 traps
.venv/bin/pytest api/tests -q        # Codex's lane; don't run it while Codex is mid-edit
scripts/check_secrets.sh --all
```

Browser checks (need a running server) are in [`web/e2e/`](../web/e2e/README.md):
`audit.mjs` (0 network requests, widths, print), `fouryear.mjs` (every what-if
lever against engine-tested values), `headed.mjs` (visible window — the only
thing that catches scrollbar-dependent rendering bugs).
