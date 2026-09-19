# FinePrint validation corpus

This corpus contains only synthetic, fictional aid documents. No institution,
applicant, award, or student identifier in these PDFs is real.

The three layouts intentionally stress different assumptions:

- `college_financing_plan.pdf`: a College Financing Plan / Shopping Sheet-style
  form whose visual label and amount columns extract as separate text lines.
- `narrative_offer.pdf`: prose sentences with embedded amounts, an unresolved
  scholarship period, and two deliberately bad replay claims that must remain
  outside the canonical facts.
- `per_term_offer.pdf`: Fall/Spring amount columns, term rollups, and a separate
  scholarship whose period must remain `unknown`.

`responses/` holds committed model-shaped `ExtractionResult` payloads. The
default harness passes each one through `ReplayExtractor`, the real evidence
admission gate, and normalization. `expected/` is the independently reviewed
semantic answer key used for diffs; it intentionally omits coordinates and
generated IDs.

Regenerate the PDFs with:

```bash
.venv/bin/python scripts/make_corpus.py
```

Run the deterministic validation suite without an API key with:

```bash
.venv/bin/python corpus/run_corpus.py
```

Use `--live` only when `OPENAI_API_KEY` is configured. Live mode uses the same
Terra-first, Sol-on-validation-failure routing as `POST /analyze`; it never
overwrites the committed replay responses or expected answers. Each report
prints the model that produced the returned canonical result, so a Sol fallback
is visible during validation.
