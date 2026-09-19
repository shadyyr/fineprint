# FinePrint validation corpus

This corpus contains only synthetic, fictional aid documents. No institution,
applicant, award, or student identifier in these PDFs is real.

The five layouts intentionally stress different assumptions:

- `college_financing_plan.pdf`: a College Financing Plan / Shopping Sheet-style
  form whose visual label and amount columns extract as separate text lines.
- `narrative_offer.pdf`: prose sentences with embedded amounts, an unresolved
  scholarship period, and two deliberately bad replay claims that must remain
  outside the canonical facts.
- `per_term_offer.pdf`: Fall/Spring amount columns, term rollups, and a separate
  scholarship whose period must remain `unknown`.
- `payment_schedule_offer.pdf`: annual costs followed by an after-aid balance,
  a Fall amount due, and a monthly installment that are real quoted figures but
  must remain non-summable views of the same obligation.
- `residency_rates_offer.pdf`: mutually exclusive in-state and out-of-state
  tuition rates where the applicable classification is unstated. Both amounts
  must be verified, and the unresolved choice must block headline math.

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

## External institutional sample audit

On 2026-09-19, the unchanged live pipeline was tested against St. Thomas
Aquinas College's publicly posted [2024-25 Sample Award Letter](https://stac.edu/wp-content/uploads/2024/02/Sample-letter-1-24.25.pdf).
The two-page PDF says `SAMPLE AWARD LETTER`, addresses only `Dear Spartan`, and
contains no student name or identifier. Its SHA-256 at the time of the run was
`11df271eb2a73a86ffdfb1f29ed5bc1e7e7bc9b11104c32c810f63d2a5728828`.

The college's [copyright policy](https://stac.edu/consumer-info/copyright-policy/)
does not grant permission to republish the entire PDF on an unrestricted site.
The file was therefore downloaded to a temporary directory for this test and
is not included in the repository.

### What worked

- GPT-5.6 Terra completed the run without a Sol fallback.
- The text layer was sufficient (4,281 characters), and the deterministic gate
  admitted seven facts backed by 20 verified evidence records. It rejected no
  citation and reported no structural invariant violation.
- It correctly identified the $39,450 tuition and fees, $17,080 combined room
  and board, $56,530 stated total cost, $12,500 academic award, and the stated
  $12,500 award rollup.
- It did not mistake the page-two statement that freshmen may borrow $5,500 per
  year for a loan actually offered in this preliminary package.
- It surfaced the dash in the federal-loan field as an unclear amount and the
  $44,030 private-loan/parent-loan/family-obligation line as a conditional
  financing choice. It also reported omitted books, transportation, personal,
  and health-insurance costs instead of treating them as zero.

### What broke

The model admitted `Fall 2024 estimate: $22,015` as a semester cost item even
though that figure is half of the already stated $44,030 annual cost after gift
aid. The financial engine correctly annualized that item to $44,030, then added
it to annual tuition and room/board. The resulting provisional cost of
attendance was $100,560 rather than the letter's stated $56,530, and the amount
to cover became $88,060 rather than $44,030.

The evidence gate could not catch this error because the quote and amount were
both real. The failure is semantic: the line is a payment-period view of a net
figure, not a new cost. The extraction also represented combined room and board
as housing while separately reporting both housing and meals as missing, which
would be confusing in the X-Ray even though the combined $17,080 amount was
preserved.

This sample is evidence that quote verification is necessary but not sufficient.
It is not approved as a public demo sample.

### H1 hardening result

The relationship guard added on 2026-09-19 recognizes narrowly defined
after-aid, family-obligation, amount-due, and installment language as a
non-summable view, even when the quote and amount are genuine. The synthetic
`payment_schedule_offer.pdf` deliberately supplies all three views as model
cost claims; the evidence gate admits the quotes, then normalization marks the
views as rollups so only the underlying annual costs participate in arithmetic.

The official STAC PDF was downloaded again to a temporary directory and run
through the updated live pipeline without committing it or its extraction.
Terra completed in 37.216 seconds without a Sol fallback. The result contained
five financial facts backed by 28 verified evidence records, zero unverified
claims, three non-blocking ambiguities, and zero invariant violations. The
previous `$22,015` Fall estimate, `$4,403` monthly payment, `$44,030` after-award
balance, and conditional financing line were not emitted as costs. The accepted
cost facts were tuition and fees, room and board, and their stated annual total;
the accepted aid facts were the academic award and its stated rollup.
