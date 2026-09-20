# Browser checks

Scripts that drive a real Chrome against a running build. They are not
part of `npm test`: they need a browser and a server. Each writes screenshots
and output to `./out/` (gitignored).

```bash
# once, somewhere outside the app's dependencies (they are not devDependencies)
cd web/e2e && npm init -y >/dev/null && npm i puppeteer-core

# against a local production build: cd web && npx next build --webpack && npx next start -p 3100
BASE=http://127.0.0.1:3100 node audit.mjs
BASE=https://fineprint-aid.vercel.app node headed.mjs
```

| Script | What it proves | Pass looks like |
|---|---|---|
| `audit.mjs` | Answering questions and selecting X-Ray rows sends **zero** network requests; the selected highlight is on screen at 1280/1366/1100/900 px; print-to-PDF carries both letter pages. | `requestsDuringInteraction: 0`, every width `inViewport: true` |
| `fouryear.mjs` | Every what-if lever. Figures must equal the engine tests to the dollar: $57,600 to cover (answered per-year), $117,600 not renewed (+$60,000), $217,844 / $70,244 at 4% growth, $22,000 borrowed with both loans, $0 (not negative) living at home. | printed `got:` matches `expect:` |
| `tabwalk.mjs` | Tabs through `/analyze` at `W`×`H` (add `ANSWER=1` to answer the question first) and flags any stop with no visible focus ring, off screen, or covered by a sticky element — the phone letter pane or the pinned four-year bar. | no `NO-RING` / `OFFSCREEN` / `COVERED` lines |
| `keyboard.mjs` | The demo path by keyboard alone: answer the question, select an X-Ray row, move what-if levers, reset. Prints every `aria-live` region's text after each step. | 0 requests, 0 errors, focus ends on "Back to the letter" |
| `financing.mjs` | "How will you cover it?" in Stage 2. COST ≠ FINANCING: accepting loans / counting work-study moves only "Still to cover from other sources" ($14,400 → $8,900 → $5,900), never "Estimated amount to cover" ($14,400) or the hero ($36,900); Overview and What-If toggles stay in sync both ways. `W=390` for phones. | every line `ok` |
| `missing.mjs` | Costs the student supplies: add / edit / remove an estimate for a cost the letter names without an amount, a malformed entry, loans and work-study on top (amount to cover never drops), and a letter with no cost figure at all (a user total, labelled "Provided by you", never added to anything). `W=390` for phones. | every line `ok` |
| `residency.mjs` | Residency / alternative rates: Meridian with an injected `amount_unclear` question (in-state $34,800 or out-of-state $52,000). Tuition is held out until answered, the X-Ray row shows no placeholder amount, and the four-year banner names every open question. | before: cost $16,500; after out-of-state: $68,500 / four-year $274,000 |
| `states.mjs` | Every error, empty and edge state, faked by intercepting requests (no Python service needed): scanned / 503 / rate-limited 429 / 413 / 500 / dropped connection / schema mismatch / slow read / missing sample / unrenderable letter / nothing loaded / no aid / no costs / nothing verified / gift aid above costs. Prints each page's h1, alerts and buttons, verifies in-page links, and checks that `Retry-After` becomes useful wait-time copy. | every page has an h1; no broken in-page links; the 429 names the wait; no raw JSON, "Failed to fetch", negative money, or $0 standing in for a missing cost |
| `headed.mjs` | Opens a **visible** Chrome window. The only check that reproduces bugs needing real, space-taking scrollbars — headless Chrome never has them. This is what caught the upside-down letter (CHANGES.log 023/024). | `CORRECT ... painted 100% upright true` |

Why `headed.mjs` exists: every headless run — Chromium, WebKit, Firefox,
throttled CPU, forced resizes — passed while the live site was broken on a real
Mac. If a rendering bug is reported that headless checks can't see, start here.
