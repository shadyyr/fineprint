// "How will you cover it?" in Your first year. COST != FINANCING: accepting
// loans or counting work-study must change only "Still to cover from other
// sources", never "Estimated amount to cover" or the gift-aid hero; the
// Overview and What-If toggles must share one state.
// BASE=http://127.0.0.1:3100 node financing.mjs  -- pass: every line "ok"
import puppeteer from "puppeteer-core";
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const OUT = new URL(process.env.OUT ?? "./out/", import.meta.url).pathname;
const W = Number(process.env.W ?? 1280);
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const p = await b.newPage(); await p.setViewport({ width: W, height: 900, isMobile: W < 600 });
const errors = []; p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await p.goto(BASE + "/analyze?sample", { waitUntil: "networkidle0" }); await p.waitForSelector("#four-years");
await p.$eval('input[value="annual"]', (e) => e.click());
await new Promise((r) => setTimeout(r, 400));
const requests = []; p.on("request", (r) => requests.push(r.url()));
const wait = () => new Promise((r) => setTimeout(r, 300));

const read = () => p.evaluate(() => {
  const fs = [...document.querySelectorAll("fieldset")].find((f) => f.querySelector("legend")?.textContent === "How will you cover it?");
  const card = fs.closest("div.rounded-lg");
  const dd = (label) => [...card.querySelectorAll("dt")].find((d) => d.textContent.includes(label))?.parentElement.querySelector("dd")?.textContent.trim();
  const still = [...card.querySelectorAll("span")].find((s) => s.textContent === "Still to cover from other sources")?.nextElementSibling?.textContent.trim();
  const borrowed = [...card.querySelectorAll("span")].find((s) => /borrowed$/.test(s.textContent))?.textContent.trim() ?? null;
  const box = (root, text) => [...root.querySelectorAll('input[type=checkbox]')].find((c) => c.closest("label").textContent.includes(text))?.checked;
  const wi = document.querySelector("#four-years form");
  const hero = [...document.querySelectorAll("p")].find((x) => x.textContent.includes("Money you won"))?.nextElementSibling?.textContent.trim();
  return {
    hero, cover: dd("Estimated amount to cover"), still, borrowed,
    // The card has more than one live region; this one is the financing remainder.
    live: [...card.querySelectorAll('[aria-live]')].map((e) => e.textContent.trim()).find((t) => t.startsWith("Still to cover")) ?? null,
    ov: { sub: box(fs, "Subsidized"), unsub: box(fs, "Unsubsidized"), ws: box(fs, "work-study") },
    wi: { sub: box(wi, "Direct Subsidized"), unsub: box(wi, "Unsubsidized"), ws: box(wi, "earnings") },
  };
});
const clickIn = async (where, text) => { await p.evaluate((where, text) => {
  const root = where === "ov" ? [...document.querySelectorAll("fieldset")].find((f) => f.querySelector("legend")?.textContent === "How will you cover it?") : document.querySelector("#four-years form");
  [...root.querySelectorAll('input[type=checkbox]')].find((c) => c.closest("label").textContent.includes(text)).click(); }, where, text); await wait(); };

const results = [];
const check = (name, got, want) => { const ok = Object.entries(want).every(([k, v]) => JSON.stringify(got[k]) === JSON.stringify(v)); results.push(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     want ${JSON.stringify(want)}\n     got  ${JSON.stringify(got)}`}`); };

let r = await read();
check("base", r, { hero: "$36,900", cover: "$14,400", still: "$14,400", borrowed: null, ov: { sub: false, unsub: false, ws: false } });
await clickIn("ov", "Subsidized"); await clickIn("ov", "Unsubsidized");
r = await read(); await p.screenshot({ path: OUT + `financing-loans-${W}.png`, fullPage: false, clip: undefined });
check("both loans (Overview)", r, { hero: "$36,900", cover: "$14,400", still: "$8,900", borrowed: "$5,500 borrowed", wi: { sub: true, unsub: true, ws: false } });
check("aria-live", r, { live: "Still to cover from other sources: $8,900." });
await clickIn("ov", "work-study");
r = await read();
check("+ work-study (Overview)", r, { hero: "$36,900", cover: "$14,400", still: "$5,900", borrowed: "$5,500 borrowed", wi: { sub: true, unsub: true, ws: true } });
await clickIn("wi", "Unsubsidized"); await clickIn("wi", "earnings");
r = await read();
check("What-If → Overview sync", r, { cover: "$14,400", still: "$10,900", borrowed: "$3,500 borrowed", ov: { sub: true, unsub: false, ws: false } });
await clickIn("wi", "Direct Subsidized");
r = await read();
check("no loans → no debt note", r, { cover: "$14,400", still: "$14,400", borrowed: null });
results.push(`${requests.length === 0 ? "ok  " : "FAIL"} network requests: ${requests.length}`);
results.push(`${errors.length === 0 ? "ok  " : "FAIL"} console errors: ${errors.length} ${errors.join(" | ")}`);
console.log(results.join("\n"));
await b.close();
