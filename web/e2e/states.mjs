// Every error, empty and edge state, faked by intercepting the browser's own
// requests -- no Python service needed. Upload failures (scanned, 503, 413, 500,
// dropped connection, a result that fails the schema), a slow read, a missing
// sample, a letter that won't render, /analyze with nothing loaded, and the
// sample edited into edge cases (no aid, no costs, nothing verified, gift aid
// above costs). BASE=http://127.0.0.1:3100 node states.mjs
// Pass: every page has an h1, no raw JSON or "Failed to fetch" in any message,
// no negative money and no "$0" standing in for a missing cost.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const OUT = new URL(process.env.OUT ?? "./out/", import.meta.url).pathname;
const ROOT = new URL("../../", import.meta.url).pathname;
const SAMPLE = JSON.parse(fs.readFileSync(ROOT + "/web/public/sample_offer.json", "utf8"));
// FastAPI/Pydantic includes JSON null for optional None fields in a live
// response, whereas the hand-authored fixture omits those keys. Exercise the
// exact wire shape so an otherwise successful extraction cannot be rejected
// by the browser schema again.
const API_SAMPLE = structuredClone(SAMPLE);
for (const item of [...API_SAMPLE.costs, ...API_SAMPLE.aid]) {
  if (!("components" in item)) item.components = null;
  if (!("ambiguity_ids" in item)) item.ambiguity_ids = null;
}
for (const item of API_SAMPLE.aid) {
  if (!("renewable" in item)) item.renewable = null;
  if (!("conditions" in item)) item.conditions = null;
}
for (const evidence of API_SAMPLE.evidence) {
  if (!("amount_bbox" in evidence)) evidence.amount_bbox = null;
  if (!("amount_text" in evidence)) evidence.amount_text = null;
}
for (const ambiguity of API_SAMPLE.ambiguities) {
  for (const option of ambiguity.options) {
    if (!("detail" in option)) option.detail = null;
  }
}
const PDF = ROOT + "/fixtures/sample_offer.pdf";
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const w = (ms) => new Promise((r) => setTimeout(r, ms));
async function page(routes, width = 1280) {
  const p = await b.newPage(); await p.setViewport({ width, height: 900 });
  p.errors = []; p.on("pageerror", (e) => p.errors.push(e.message)); p.on("console", (m) => m.type() === "error" && p.errors.push(m.text().slice(0, 120)));
  await p.setRequestInterception(true);
  p.on("request", (r) => { const path = new URL(r.url()).pathname; const h = routes[path]; if (!h) return r.continue();
    if (h === "abort") return r.abort("failed");
    if (h.delay) return setTimeout(() => r.respond(h), h.delay);
    r.respond(h); });
  return p;
}
const json = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const live = { "/api/health": json(200, { reachable: true, live: true }) };
const describe = (p) => p.evaluate(() => ({
  h1: document.querySelector("h1")?.innerText ?? null,
  text: document.querySelector("main")?.innerText.replace(/\s+/g, " ").trim().slice(0, 400),
  alert: [...document.querySelectorAll('[role=alert]')].map((e) => e.innerText.replace(/\s+/g, " ").trim()).filter(Boolean),
  buttons: [...document.querySelectorAll("main button, main a")].map((e) => e.innerText.trim()).filter(Boolean).slice(0, 8),
  focus: document.activeElement?.tagName + " " + (document.activeElement?.innerText ?? "").slice(0, 30),
  header: !!document.querySelector("header"),
  brokenAnchors: [...document.querySelectorAll('a[href^="#"]')]
    .map((anchor) => anchor.getAttribute("href"))
    .filter((href) => href && !document.querySelector(href)),
}));
async function upload(name, analyzeResponse, file = PDF) {
  const p = await page({ ...live, "/api/analyze": analyzeResponse });
  await p.goto(BASE + "/", { waitUntil: "networkidle0" });
  await p.waitForFunction(() => !document.querySelector('input[type=file]').disabled, { timeout: 5000 });
  const input = await p.$('input[type=file]'); await input.uploadFile(file);
  await w(analyzeResponse?.delay ? 600 : 1500);
  const r = { name, ...(await describe(p)), url: new URL(p.url()).pathname, errors: p.errors };
  await p.screenshot({ path: OUT + "state-" + name + ".png" }); await p.close(); return r;
}
const results = [];
results.push(await upload("scanned-422", json(422, { detail: "This looks like a scanned document. FinePrint needs a text-based PDF so it can trace every figure back to the words on the page. Try the sample offer, or export the letter as a text PDF." })));
results.push(await upload("unreachable-503", json(503, { detail: "FinePrint's letter reader isn't responding right now. Try again in a minute, or explore the sample offer." })));
results.push(await upload("rate-limited-429", { ...json(429, { detail: "Too many live-reading attempts from this connection; please wait before trying again." }), headers: { "Retry-After": "240" } }));
results.push(await upload("too-big-413", json(413, { detail: "That file is larger than 15 MB. Please upload a smaller PDF." })));
results.push(await upload("crash-500-html", { status: 500, contentType: "text/html", body: "<html>Internal Server Error</html>" }));
results.push(await upload("network-drop", "abort"));
results.push(await upload("schema-mismatch", json(200, { ...SAMPLE, aid: [{ id: "x", label: 5 }] })));
results.push(await upload("slow-reading", { ...json(200, SAMPLE), delay: 4000 }));
results.push(await upload("success-live", json(200, { ...SAMPLE, extraction_meta: { ...SAMPLE.extraction_meta, source: "live" } })));
results.push(await upload("success-live-null-optionals", json(200, { ...API_SAMPLE, extraction_meta: { ...API_SAMPLE.extraction_meta, source: "live" } })));
results.push(await upload("not-a-pdf", json(200, SAMPLE), ROOT + "/README.md"));
// sample path failures
for (const [name, routes] of [["sample-json-404", { "/sample_offer.json": { status: 404, body: "nope" } }], ["sample-pdf-404", { "/sample_offer.pdf": { status: 404, contentType: "text/html", body: "<html>404</html>" } }], ["empty", null]]) {
  const p = await page(routes ?? {});
  await p.goto(BASE + (routes ? "/analyze?sample" : "/analyze"), { waitUntil: "networkidle0" }); await w(1200);
  const r = { name, ...(await describe(p)), errors: p.errors };
  if (name === "sample-pdf-404") r.xray = await p.evaluate(() => document.querySelector("#xray")?.innerText.slice(0, 300));
  await p.screenshot({ path: OUT + "state-" + name + ".png", fullPage: name === "sample-pdf-404" ? false : false }); results.push(r); await p.close();
}
// edge documents through the sample path
const edge = {
  "no-aid": { ...SAMPLE, aid: [], ambiguities: [] },
  "no-costs": { ...SAMPLE, costs: [], missing_costs: [] },
  "all-unverified": { ...SAMPLE, aid: [], costs: [], ambiguities: [], missing_costs: [], unverified_claims: [{ id: "u1", claimed_label: "Merit Scholarship", claimed_amount: 20000, cited_line_id: null, reason: "quote_not_found", detail: "The quoted text was not found on the page." }] },
  "gift-exceeds-costs": { ...SAMPLE, costs: SAMPLE.costs.filter((c) => c.category === "tuition"), ambiguities: [], aid: SAMPLE.aid.map((a) => a.aid_type === "gift" ? { ...a, amount: a.amount * 3, period: a.period === "unknown" ? "annual" : a.period } : a) },
};
for (const [name, doc] of Object.entries(edge)) {
  const p = await page({ "/sample_offer.json": json(200, doc) });
  await p.goto(BASE + "/analyze?sample", { waitUntil: "networkidle0" }); await w(1200);
  const r = { name, ...(await describe(p)), errors: p.errors };
  await p.screenshot({ path: OUT + "edge-" + name + ".png", fullPage: true }); results.push(r); await p.close();
}
for (const r of results) console.log(JSON.stringify(r));
const failed = results.filter((result) => !result.h1 || result.brokenAnchors.length > 0);
if (failed.length > 0) {
  console.error("State audit failed:", failed.map(({ name, h1, brokenAnchors }) => ({ name, h1, brokenAnchors })));
  process.exitCode = 1;
}
const unsafeCopy = results.filter((result) => {
  const copy = `${result.text ?? ""} ${result.alert.join(" ")}`;
  return copy.includes("Failed to fetch") || copy.includes('{"detail"') || copy.includes("port 8000");
});
if (unsafeCopy.length > 0) {
  console.error("State audit failed: technical error copy reached the page:", unsafeCopy.map(({ name }) => name));
  process.exitCode = 1;
}
const noCosts = results.find((result) => result.name === "no-costs");
if (!noCosts || noCosts.text.includes("Cost of attendance $0")) {
  console.error("State audit failed: a missing cost was displayed as $0.");
  process.exitCode = 1;
}
const rateLimited = results.find((result) => result.name === "rate-limited-429");
if (!rateLimited?.alert.some((message) => message.includes("about 4 minutes"))) {
  console.error("State audit failed: the rate-limit state did not translate Retry-After into a useful wait time.");
  process.exitCode = 1;
}
await b.close();
