# Public API deployment: prepared, not activated

FinePrint's live upload path is ready to host, but it is not deployed. Do not
create the Render service, expose an API URL, set Vercel's
`FINEPRINT_API_URL`, or enable analysis until Shade explicitly approves it.
The existing sample experience at <https://fineprint-aid.vercel.app> does not
need this service.

## What the prepared service does

[`render.yaml`](../render.yaml) describes one paid Render web service with one
worker, one instance, automatic deploys off, and a 1 GB persistent disk. It
starts with `FINEPRINT_PUBLIC_API_ENABLED=false`, so `/analyze` returns 503 and
does not read the upload or call OpenAI. `/sample` and `/health` remain usable;
the local-only `/debug/ingest` route returns 404 in public mode.

When enabled, the service applies two independent controls before a model can
be called:

- Three `/analyze` attempts per hashed client address per fixed hour. The
  SQLite database stores an HMAC-SHA256 digest, never the raw address.
- Twenty-five provider-backed analyses across the service per UTC day. A call
  that reaches OpenAI consumes a slot even if the model refuses or fails.

The counters survive restarts on the disk. The design intentionally uses one
instance: Render disks attach to only one instance, and a local SQLite ceiling
would not be global across replicas. Uvicorn access logging is disabled. The
application logs only event categories; it never logs PDF bytes, extracted
text, filenames, model output, provider error text, or raw client addresses.

## Cost and privacy decision

Each accepted letter normally makes one Terra request. Sol is called only when
the primary extraction fails validation or leaves a material ambiguity, so a
single analysis can make two provider calls. The default app cap therefore
limits analyses, not tokens or dollars: at 25 analyses per day, the theoretical
maximum is 50 model requests per day, with cost still varying by document and
model usage. Render compute and its persistent disk also cost money.

An app quota is not a billing guarantee. Before activation, create a separate
OpenAI project for this public demo and enforce a small **hard monthly spend
limit** on that project. OpenAI notes that hard-limit enforcement is not
instantaneous, so a small overrun is still possible. Add spend alerts as an
early warning, not as the cap.

Aid letters can contain names, IDs, addresses, and financial details. The PDF
exists only in request/process memory and FinePrint sends its extracted text and
page images to OpenAI with `store=false`; neither FinePrint nor the quota store
persists the document. That reduces retention but does not remove third-party
processing: Render receives the upload and OpenAI processes its contents. The
live UI must disclose that before accepting a real letter. Do not invite users
to upload documents until that disclosure is visible.

## Activation checklist — only after Shade says go

1. In OpenAI, create a production-only project key with an expiration date and
   a rotation plan. Set a hard monthly project spend limit and lower project
   rate limits where practical.
2. Review current Render pricing. Import `render.yaml` as a Blueprint and enter
   the project key when Render prompts for `OPENAI_API_KEY`. Do not put the key
   in Git or paste it into the YAML.
3. Confirm Render created one instance and mounted `/var/data`. Keep automatic
   deploys and preview environments off.
4. While `FINEPRINT_PUBLIC_API_ENABLED=false`, check `/health`: it should return
   `ok: true` and `live_extraction: false`. Confirm `/analyze` returns 503 and
   `/debug/ingest` returns 404.
5. Inspect service logs and confirm no access log, filename, document text,
   provider response, or raw client address appears.
6. Set `FINEPRINT_PUBLIC_API_ENABLED=true` in Render, deploy manually, and send
   only a synthetic test letter. Confirm valid analysis, a `Retry-After` header
   after the per-client limit, and persistent counters across a restart.
7. Only after those checks, set Vercel's server-side `FINEPRINT_API_URL` to the
   HTTPS Render URL and redeploy the web app. Test the synthetic letter again
   from <https://fineprint-aid.vercel.app>.

## Fast rollback

Set `FINEPRINT_PUBLIC_API_ENABLED=false` first. This blocks new analyses before
their upload is read. Then remove `FINEPRINT_API_URL` from Vercel and redeploy
the web app. If a key or logs might have been exposed, revoke the OpenAI key,
replace it with a new expiring project key, and review both provider dashboards.

## References checked September 19, 2026

- [Render Blueprint YAML reference](https://render.com/docs/blueprint-spec)
- [Render persistent disks](https://render.com/docs/disks)
- [Render web services](https://render.com/docs/web-services)
- [OpenAI spend limits](https://developers.openai.com/api/docs/guides/spend-limits)
- [OpenAI production best practices](https://developers.openai.com/api/docs/guides/production-best-practices)
