# FinePrint

Know what your financial-aid offer actually means.

- Live demo: https://fineprint-aid.vercel.app
- Source: https://github.com/shadyyr/fineprint
- Tracks: Best Finance Hack; Best Education, Accessibility, or Social Impact

## Inspiration

Financial-aid offers arrive at the moment a family has to make a large,
time-sensitive decision, but the document itself often makes the decision
harder. The U.S. Department of Education says there is no standardized format
or delivery method for these offers. It also warns that an offer may not show
the full cost of attending.

The numbers bear that out. In April 2026, Sallie Mae reported that only 36% of
families said an offer included the full cost of attendance and only 27% said
it clearly showed the expected out-of-pocket cost. One in five did not realize
loans could appear inside an aid package, and 19% believed they had to use an
offered loan.

This confusion hits first-generation students especially hard. In a 2025
Student Voice survey of 5,065 students, only 27% said they clearly understood
the full cost of attendance. Among first-generation respondents, 46% said an
unexpected expense of $1,000 or less could threaten their ability to stay
enrolled. A first-generation student writing for uAspire described seeing a
"$100,000 scholarship," assuming it was a full ride, then learning it was
spread across four years while nearly $20,000 was still due.

We kept coming back to a narrower question: what does the offer a student
actually received mean for them?

Sources: [Federal Student Aid](https://studentaid.gov/articles/evaluating-financial-aid-offers/),
[Sallie Mae](https://news.salliemae.com/news-releases/news-releases-details/2026/Understanding-Financial-Aid-Offer-Letters-What-College-Bound-Families-Need-to-Know/default.aspx),
[Inside Higher Ed](https://www.insidehighered.com/news/student-success/academic-life/2025/10/07/students-struggle-surprise-costs-dont-know-about-help),
and [uAspire](https://www.uaspire.org/news-events/lost-in-translation-why-financial-aid-offers-need-clarity-now-more-than-ever).

## What it does

FinePrint reads a text-based financial-aid PDF and turns it into an
evidence-linked financial model. It separates grants and scholarships from
loans and work-study, normalizes annual and per-term amounts, keeps stated
totals from being counted twice, and calls out costs the letter leaves out.

The first screen makes one contrast clear: the amount advertised as
"financial aid" is not the same as gift aid. From there, a student can:

- select any cost or award and see the exact words highlighted in the PDF;
- answer a question when the letter never says whether an amount is per term,
  per year, or a four-year total;
- see a four-year projection built from explicit assumptions;
- test scholarship renewal, tuition growth, housing, loans, and work-study;
- decide how to finance the first-year gap without changing what college
  actually costs.

FinePrint does not turn a missing number into $0, call a loan free money, or
count work-study as an up-front discount.

The Vercel demo uses bundled synthetic letters so judges can try the full
analysis without uploading personal data. Live extraction works locally with
the Python service and an OpenAI API key. The public deployment does not yet
host that service, so personal uploads are disabled there rather than sent to
a dead or unprotected endpoint.

## How we built it

PyMuPDF extracts numbered text lines, per-character geometry, page dimensions,
and rotation from the PDF. Page images give the model layout context, but the
numbered text is the authority for every claim.

The extraction layer uses the OpenAI Responses API with a strict Pydantic
schema. GPT-5.6 Terra at medium reasoning handles the normal path. FinePrint
retries once with GPT-5.6 Sol only if the typed response fails validation, the
evidence gate rejects a claim, nothing verifies, or a material ambiguity blocks
the headline calculation. Response storage is disabled.

We still do not trust the model output. A Python admission gate looks up every
cited line, checks that the quote is present, parses the money in that quote,
and requires the amount to match. Only then does a claim enter the canonical JSON.
Failed claims stay visible as unverified observations and never enter the math.
Bounding boxes come from the PDF text layer, not from the model.

The web app is Next.js, React, TypeScript, Tailwind CSS, and pdf.js. A pure
TypeScript financial engine handles period normalization, rollups, the Year-1
view, four-year projections, and what-if scenarios. Those interactions run in
the browser.

This split matters because FinePrint is not an LLM wrapper. There is one model
call site in the codebase (`api/extract.py`). During an architecture audit,
model-touching code measured 298 of 4,731 application lines, about 6%.
Answering an ambiguity, selecting evidence, changing a projection, or testing
a financing choice makes zero model or network requests. Every model claim is
checked against the letter before application code can use it.

## Challenges

PDFs fought us almost immediately. A table can look obvious on screen while its
content stream puts a number nowhere near its label. Columns, page rotation,
and unexpected reading order added more ways to get it wrong. We kept exact
geometry through ingestion and made line IDs stable enough for the model to
cite.

Then we had to decide what counted as a fact. A high confidence score
does not prove that a number appears in the document. The quote-and-amount gate
became the boundary between a model observation and a usable financial fact.

Financial language added its own traps. A stated package total must be shown
but not summed with its components. A scholarship that says "renewable for four
years" still may not say whether the displayed amount is annual or total. A
stronger model is not allowed to guess that away. FinePrint carries the
uncertainty into the interface and waits for the student to resolve it.

We also had to keep the PDF and analysis in sync across screen sizes, keyboard
navigation, printing, and rotated pages. That work exposed browser behavior
that headless tests missed, so we added headed-browser, keyboard, print, and
multi-width checks around the core demo.

## Accomplishments that we're proud of

The Financial X-Ray is the part we are proudest of. Select "Federal Pell
Grant," and the source amount lights up in the letter. Select the highlight,
and the matching explanation comes back into view. The audit trail is part of
the product instead of a disclaimer below an AI answer.

We also built a deterministic test corpus with three fictional layouts: a
College Financing Plan-style form, a narrative letter, and a two-column
Fall/Spring worksheet. Replay responses let the evidence gate run in CI without
an API key. The second public sample was produced by a fresh live run: all 23
financial facts passed the evidence gate, and the missing period on a separate
$10,000 scholarship remained a blocking question instead of being guessed.

The scenario tools preserve an important distinction between cost and
financing. In the main sample, accepting $5,500 in offered loans can reduce the
amount still needed from other sources, but the amount the student must cover
does not move. The interface also states that the $5,500 is borrowed principal,
not a discount.

## What we learned

Document AI needs a definition of proof. Structured output makes data easier
to consume, but it does not make the data true. Requiring a real quote and a
matching amount changed how we designed the whole system.

We also learned that uncertainty belongs in the data model. If the offer never
states an award period, the honest output is a question with consequences, not
a plausible default. Likewise, "missing" and "$0" are different financial
facts.

Finally, the model does not need to own the experience. It is useful for the
messy document-reading step. Once the letter becomes verified structured data,
ordinary code is faster to run and easier to test. It also avoids another paid
model call every time a student moves a slider.

## What's next for FinePrint

The current evidence bar requires a usable PDF text layer. OCR is the next
document capability, but we will add it only when scanned text and coordinates
can meet the same quote-and-amount checks.

We would also add side-by-side school comparison, counselor workflows,
multilingual explanations, and verified loan-rate or policy data where the
offer itself is incomplete. A public extraction service needs rate limiting,
a daily spend cap, and careful handling of document logs before we enable it.
Longer term, we would like to explore local or privacy-preserving extraction
for letters that contain student information.

FinePrint is an educational decision-support tool, not financial advice.

## Screenshot checklist for the submission

1. Homepage with the one-sentence pitch and sample choices.
2. Overview before the scholarship question is answered: advertised aid,
   confirmed gift aid, and the unresolved $20,000 amount in one frame.
3. Financial X-Ray with a selected aid row and its exact PDF highlight visible.
4. The same scholarship answered both ways, showing the Year-1 and four-year
   consequence without implying a default.
5. "How will you cover it?" with both loans checked: amount to cover unchanged,
   $5,500 marked as borrowed, and the remaining-source gap updated.
6. Four-year chart and what-if controls after changing one assumption, with the
   before/after delta visible.
7. Summit per-term sample showing Fall/Spring normalization and its separate
   $10,000 scholarship question.

For the required video, keep the final cut under five minutes. The strongest
sequence is screenshot 2, then 3, 4, 5, 6, and 7. Show the product changing on
screen; keep the architecture explanation to the evidence gate and local math.

Source check completed September 19, 2026. All statistics above were reopened
at their linked sources. The current [SASEhack hacker guide](https://sase-hack.notion.site/SASEhack-2026-Hacker-Guide-38b9bed74f8e8093aba7fd8132b70a16)
confirms the two track names and the five-minute video limit.
