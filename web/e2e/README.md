# Browser checks

Three scripts that drive a real Chrome against a running build. They are not
part of `npm test`: they need a browser and a server. Each writes screenshots
and output to `./out/` (gitignored).

```bash
# once, somewhere outside the app's dependencies (they are not devDependencies)
cd web/e2e && npm init -y >/dev/null && npm i puppeteer-core

# against a local production build: cd web && npx next build && npx next start -p 3100
BASE=http://127.0.0.1:3100 node audit.mjs
BASE=https://fineprint-aid.vercel.app node headed.mjs
```

| Script | What it proves | Pass looks like |
|---|---|---|
| `audit.mjs` | Answering questions and selecting X-Ray rows sends **zero** network requests; the selected highlight is on screen at 1280/1366/1100/900 px; print-to-PDF carries both letter pages. | `requestsDuringInteraction: 0`, every width `inViewport: true` |
| `fouryear.mjs` | Every what-if lever. Figures must equal the engine tests to the dollar: $57,600 to cover (answered per-year), $117,600 not renewed (+$60,000), $217,844 / $70,244 at 4% growth, $22,000 borrowed with both loans, $0 (not negative) living at home. | printed `got:` matches `expect:` |
| `headed.mjs` | Opens a **visible** Chrome window. The only check that reproduces bugs needing real, space-taking scrollbars — headless Chrome never has them. This is what caught the upside-down letter (CHANGES.log 023/024). | `CORRECT ... painted 100% upright true` |

Why `headed.mjs` exists: every headless run — Chromium, WebKit, Firefox,
throttled CPU, forced resizes — passed while the live site was broken on a real
Mac. If a rendering bug is reported that headless checks can't see, start here.
