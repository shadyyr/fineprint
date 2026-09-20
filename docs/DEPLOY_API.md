# Public API activation runbook

Shade approved a small public deployment for the demo video on 2026-09-19.
The API is a second Vercel project from this repository with Root Directory
`api/`; it is not a Render service.

**Current production state (verified 2026-09-20):** the API is deployed at
`https://api-six-pi-52.vercel.app`, public mode is enabled, Upstash-backed
quotas are configured, and the web project at
`https://fineprint-aid.vercel.app` is connected through its server-side proxy.
Direct analysis calls without the shared proxy secret are rejected. Both
Vercel checks succeeded for product HEAD
`805915ed9342c44174017e13ec46d6ce05364d2c`; the web returned HTTP 200 and API
`/health` reported live extraction and quota storage enabled. The steps below
remain the rebuild, verification, and rollback runbook.

Shade performs every account, billing, key, and secret step. Never paste an
OpenAI key, Redis token, or FinePrint secret into chat, Git, a command output,
or a screenshot. Codex never needs to see any of their values.

The cached sample path at <https://fineprint-aid.vercel.app> remains usable
during every step. Do not connect a new web deployment to the API until the
disabled and enabled checks below pass and the disclosure/headers are live.

## What the service enforces

[`api/vercel.json`](../api/vercel.json) configures Vercel's recognized
`main.py:app` FastAPI entrypoint for a 180-second maximum duration and excludes
tests and fixture directories from the function bundle. A clean local staging
install measured 144,121,838 file bytes (157,536 KiB on disk), below Vercel's
500 MB standard uncompressed Python limit. The first Vercel build is the final
size check because Linux wheels can differ from the local macOS wheels.

The service defaults `FINEPRINT_PUBLIC_API_ENABLED` to `false`; production sets
it to `true`. When the switch is false, `POST /analyze` returns 503 before
reading a file or calling OpenAI. `POST /debug/ingest` always returns 404 in
public mode.

Once enabled, `/analyze` requires both headers sent by the web project:

- `X-FinePrint-Client-IP`
- `X-FinePrint-Proxy-Secret`

The proxy secret is checked with constant-time comparison. A missing or wrong
secret returns 403, so the public API URL cannot be used directly. Bare
`X-Forwarded-For` is never trusted.

Upstash Redis enforces two independent quotas before a provider call:

- `FINEPRINT_RATE_LIMIT_REQUESTS=3` attempts per HMAC'd client identifier per
  `FINEPRINT_RATE_LIMIT_WINDOW_SECONDS=3600` fixed window.
- `FINEPRINT_DAILY_ANALYSIS_CAP=25` provider-backed analyses per UTC day.

Each check/increment/expiry is one atomic Redis Lua operation. Redis keys contain
only an HMAC digest, window timestamp, or UTC date—never a raw address. Counters
survive function restarts and concurrent Vercel instances. If Redis credentials,
the HMAC secret, or Redis itself are unavailable, analysis fails closed with 503.

Every non-2xx body is `{"detail":"<one student-facing sentence>"}`. A 429 also
has an integer `Retry-After` header. Application logs contain event categories,
not PDF bytes, extracted text, filenames, model responses, secrets, raw addresses,
or provider error details. No application data is written to disk.

## Cost and privacy boundary

An accepted letter normally makes one Terra request. Sol is called only when
the primary result fails the typed output contract, verifies no financial facts,
or has a claim rejected by the evidence gate. A genuine ambiguity is kept for
the student to answer and does not trigger Sol. One analysis can therefore make
two provider calls, but the SDK performs no additional automatic retries. Each
call may use up to 100 seconds. The pipeline has a 150-second total budget and
starts Sol only when at least 30 seconds remain; otherwise it returns a usable
primary result instead of turning it into a timeout error. The web proxy waits
165 seconds, inside the web route's 200-second function duration. The app cap
limits analyses, not tokens or dollars; the OpenAI project hard spend limit
remains the billing backstop. Hard-limit enforcement can lag slightly. Vercel
logs record token counts, fallback status, and elapsed milliseconds only—not
letter or model content.

Aid letters can contain names, IDs, addresses, and financial details. FinePrint
keeps the upload in request/process memory and sends extracted text and page
images to OpenAI with `store=false`; it does not persist the upload or result.
OpenAI does not train on API data unless the project opts in. Default abuse-
monitoring logs may contain prompts and responses for up to 30 days, with longer
retention possible when legally required or reasonably necessary to prevent
harm. Vercel processes the upload. Upstash receives only quota keys and counts.

To inspect cost without exposing a letter, open the API project's Vercel
**Observability → Logs** view and filter for `model_call`. Each provider call
reports `model`, input/output/reasoning/cached token counts, `fallback`, and
`elapsed_ms`. It never includes a filename, document text, quote, structured
model output, address, or secret. Missing provider usage appears as
`unavailable` and does not fail the analysis.

## Deployment and activation runbook

### 0. Deployment gate

Do not import or redeploy from an older commit. First commit and push the P2
implementation, then confirm the GitHub copy contains:

- `api/vercel.json`
- `api/guardrails.py` using Upstash rather than SQLite
- `api/sample_offer.json`
- no `render.yaml`

The production deployment has passed this gate. Repeat it before any future
redeploy from a materially changed API revision; Shade still controls every
commit, push, credential, and billing action.

### 1. Shade: prepare three private values

The existing isolated OpenAI project key and enforced hard spend limit can be
reused. Separately generate and store two independent high-entropy values:

- `FINEPRINT_PROXY_SECRET`: shared by the API and web Vercel projects.
- `FINEPRINT_IP_HASH_SECRET`: used only by the API to HMAC client identifiers.

For example, run `openssl rand -hex 32` separately for each value and put them
directly in a password manager/Vercel. Do not send either value to Codex. Never
give them a `NEXT_PUBLIC_` prefix.

### 2. Shade: create the disabled API project

1. In Vercel, choose **Add New → Project** and import this same Git repository a
   second time.
2. Name it something unambiguous such as `fineprint-api`.
3. Set **Root Directory** to `api/` and **Framework Preset** to FastAPI (automatic
   detection is also acceptable). Leave Build Command and Output Directory at
   their defaults.
4. Keep the production branch as `main`. Under Root Directory, keep **Skip
   deployments when there are no changes** enabled. If that feature is not
   available, use Ignored Build Step `git diff HEAD^ HEAD --quiet -- .`.
5. Add these Production environment variables. Shade enters every private value
   directly in Vercel; nobody else needs it:

   | Variable | Initial value |
   | --- | --- |
   | `OPENAI_API_KEY` | existing FinePrint project key |
   | `FINEPRINT_MODEL` | `gpt-5.6-terra` |
   | `FINEPRINT_FALLBACK_MODEL` | `gpt-5.6-sol` |
   | `FINEPRINT_REASONING_EFFORT` | `medium` |
   | `FINEPRINT_PUBLIC_MODE` | `true` |
   | `FINEPRINT_PUBLIC_API_ENABLED` | `false` |
   | `FINEPRINT_PROXY_SECRET` | private shared secret |
   | `FINEPRINT_IP_HASH_SECRET` | private HMAC secret |
   | `FINEPRINT_RATE_LIMIT_REQUESTS` | `3` |
   | `FINEPRINT_RATE_LIMIT_WINDOW_SECONDS` | `3600` |
   | `FINEPRINT_DAILY_ANALYSIS_CAP` | `25` |

6. Deploy. In the build output, confirm Vercel detected FastAPI, built one Python
   function from `main.py`, applied `maxDuration: 180`, and did not report a
   bundle-size error. Copy the `https://…vercel.app` API URL; the URL is not a
   secret.

### 3. Shade: connect Upstash Redis

1. In the API project, open **Storage/Marketplace**, select **Upstash Redis**, and
   create or connect a free-tier Redis database.
2. Connect it only to the FinePrint API project and Production environment.
3. Confirm Project Settings → Environment Variables now contains
   `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Those are the Vercel Marketplace
   names. FinePrint also accepts Upstash's direct
   `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` names, but do not create
   duplicates when the Marketplace variables exist.
4. Redeploy so the new variables reach the function.

### 4. Disabled-state checks (no provider spend)

From the repository root, set only the non-secret public API URL in the shell:

```bash
export FINEPRINT_API_URL="https://YOUR-API-PROJECT.vercel.app"
curl --fail-with-body "$FINEPRINT_API_URL/health"
curl --silent --show-error --output /tmp/fineprint-disabled.json \
  --write-out 'HTTP %{http_code}\n' \
  -F 'file=@fixtures/sample_offer.pdf;type=application/pdf' \
  "$FINEPRINT_API_URL/analyze"
curl --silent --show-error --output /tmp/fineprint-debug.json \
  --write-out 'HTTP %{http_code}\n' \
  -F 'file=@fixtures/sample_offer.pdf;type=application/pdf' \
  "$FINEPRINT_API_URL/debug/ingest"
```

The health body must report `ok: true`, `fixture_available: true`,
`live_extraction: false`, `public_mode: true`,
`proxy_identity_configured: true`, and `quota_store_configured: true`.
`/analyze` must be 503 and `/debug/ingest` 404, each with one string-valued
`detail`. Check Vercel logs: no filename, document text, response body, raw
address, or secret may appear.

### 5. Shade: enable and run the synthetic smoke test

1. Change `FINEPRINT_PUBLIC_API_ENABLED` to `true` in the API project's
   Production environment and redeploy.
2. Confirm `/health` now reports `live_extraction: true`.
3. In a private terminal, load `FINEPRINT_PROXY_SECRET` without printing it.
   Time one Meridian analysis using the reserved documentation address as the
   synthetic client:

```bash
read -s FINEPRINT_PROXY_SECRET
export FINEPRINT_PROXY_SECRET
curl --fail-with-body --silent --show-error \
  --output /tmp/fineprint-meridian-result.json \
  --write-out 'HTTP %{http_code} total=%{time_total}s\n' \
  -H 'X-FinePrint-Client-IP: 198.51.100.77' \
  -H "X-FinePrint-Proxy-Secret: $FINEPRINT_PROXY_SECRET" \
  -F 'file=@fixtures/sample_offer.pdf;type=application/pdf' \
  "$FINEPRINT_API_URL/analyze"
```

Validate the saved result locally and record `extraction_meta.model` plus the
curl duration. A normal run should report Terra. Do not force a paid Sol
fallback merely to create a timing number. The result must finish within the
web proxy's 165-second wait.

4. Confirm a direct call without the secret returns 403. Then use a tiny invalid
   synthetic payload to reach the per-client cap without additional OpenAI
   calls. Since the successful smoke used one of three attempts, two invalid
   requests should return 415 and the third should return 429 with an integer
   `Retry-After` header:

```bash
printf 'not a PDF' > /tmp/fineprint-not-a-pdf.txt
curl --include --silent --show-error \
  -H 'X-FinePrint-Client-IP: 198.51.100.77' \
  -H "X-FinePrint-Proxy-Secret: $FINEPRINT_PROXY_SECRET" \
  -F 'file=@/tmp/fineprint-not-a-pdf.txt;type=application/pdf' \
  "$FINEPRINT_API_URL/analyze"
```

5. Redeploy the same API commit, repeat the last request with the same synthetic
   client address, and confirm it remains 429. That proves the counter survived
   a function replacement in Upstash rather than process memory.

### 6. Shade: connect the production web project (completed)

Do this only after Claude's disclosure and authenticated-header changes are
committed, pushed, and visible on <https://fineprint-aid.vercel.app>.

In the existing web project's Production environment, add:

- `FINEPRINT_API_URL` = the API project's HTTPS base URL, without `/analyze`.
- `FINEPRINT_PROXY_SECRET` = the same private value as the API project.

Neither variable is public and neither uses a `NEXT_PUBLIC_` prefix. Redeploy
the web project, upload only `fixtures/sample_offer.pdf`, and confirm a successful
analysis. Record end-to-end duration; it must remain within 165 seconds.

## Changing limits without code

Change any of these in the API project's Production environment and redeploy:

- `FINEPRINT_RATE_LIMIT_REQUESTS`
- `FINEPRINT_RATE_LIMIT_WINDOW_SECONDS`
- `FINEPRINT_DAILY_ANALYSIS_CAP`

No code change is required. Lowering a limit does not erase live Redis keys.

## Fast rollback

Set `FINEPRINT_PUBLIC_API_ENABLED=false` in the API project first and redeploy;
this blocks new analyses before application file handling or provider calls.
Then remove `FINEPRINT_API_URL` and `FINEPRINT_PROXY_SECRET` from the web
project's Production environment and redeploy the web site. If a credential or
log might have been exposed, revoke the OpenAI key, rotate both FinePrint
secrets, reset the Upstash token, and review the provider dashboards.

## References checked September 19, 2026

- [OpenAI spend limits](https://developers.openai.com/api/docs/guides/spend-limits)
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
- [Vercel FastAPI deployment](https://vercel.com/kb/guide/ship-a-fastapi-app-on-vercel)
- [Vercel Python runtime and bundle exclusions](https://vercel.com/docs/functions/runtimes/python)
- [Vercel function limits](https://vercel.com/docs/functions/limitations)
- [Vercel monorepo Root Directory](https://vercel.com/docs/monorepos)
- [Upstash Vercel integration](https://upstash.com/docs/redis/howto/vercelintegration)
- [Upstash Python SDK](https://github.com/upstash/redis-py)
- [Upstash atomic key locking](https://upstash.com/docs/redis/features/key-locking)
