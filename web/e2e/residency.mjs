// Residency / alternative rates (TASKS R1 + UI-R1): the Meridian sample with an
// injected amount_unclear question (in-state $34,800 or out-of-state $52,000).
// Pass: before — tuition held out (cost $16,500), X-Ray row shows no amount, banner
// names both open questions; after out-of-state — cost $68,500, four-year $274,000.
// BASE=http://127.0.0.1:3100 node residency.mjs
import puppeteer from "puppeteer-core"; import fs from "node:fs";
const S = JSON.parse(fs.readFileSync(new URL("../public/sample_offer.json", import.meta.url), "utf8"));
const doc = { ...S, ambiguities: [...S.ambiguities, { id: "amb_residency", kind: "amount_unclear", target: "cost_tuition.amount", severity: "material",
  question: "Which tuition rate applies to you?", why: "The letter lists an in-state and an out-of-state rate and doesn't say which is yours.",
  options: [{ value: "34800", label: "In-state: $34,800 a year" }, { value: "52000", label: "Out-of-state: $52,000 a year" }], blocks_headline: true, evidence_ids: ["ev_cost_tuition"] }] };
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 900 });
const errors = []; p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await p.setRequestInterception(true);
p.on("request", (r) => new URL(r.url()).pathname === "/sample_offer.json" ? r.respond({ status: 200, contentType: "application/json", body: JSON.stringify(doc) }) : r.continue());
await p.goto((process.env.BASE ?? "http://127.0.0.1:3100") + "/analyze?sample", { waitUntil: "networkidle0" }); await new Promise((r) => setTimeout(r, 800));
const read = () => p.evaluate(() => {
  const q = document.getElementById("question-amb_residency");
  const t = document.querySelector("main").innerText.replace(/\s+/g, " ");
  const row = document.getElementById("row-cost_tuition")?.innerText.replace(/\s+/g, " ");
  return { question: q?.querySelector("h3")?.innerText, options: q ? [...q.querySelectorAll("label")].map((l) => l.innerText.replace(/\s+/g, " ")) : null,
    coa: t.match(/Cost of attendance \$[\d,]+/)?.[0], coaCaveat: t.match(/Leaves out the Tuition[^.]*\./)?.[0] ?? null, row,
    banner: document.querySelector("#four-years")?.innerText.match(/These totals leave out[^.]*\./)?.[0] ?? null, fourCost: document.querySelector("#four-years")?.innerText.match(/Four-year cost\s*\$[\d,]+/)?.[0] };
});
console.log("before:", JSON.stringify(await read(), null, 1));
await p.$eval('#question-amb_residency input[value="52000"]', (e) => e.click()); await new Promise((r) => setTimeout(r, 400));
console.log("out-of-state:", JSON.stringify(await read(), null, 1));
console.log("errors:", errors);
await b.close();
