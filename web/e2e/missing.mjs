// Missing costs the student supplies (CHANGES.log 064). MISSING != $0; the
// student's amounts are labelled theirs; COST != FINANCING still holds.
// BASE=http://127.0.0.1:3100 node missing.mjs  -- pass: every line "ok"
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const W = Number(process.env.W ?? 1280);
const SAMPLE = JSON.parse(fs.readFileSync(new URL("../public/sample_offer.json", import.meta.url), "utf8"));
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const wait = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  -- ${detail}`}`);

async function open(doc) {
  const p = await b.newPage(); await p.setViewport({ width: W, height: 900, isMobile: W < 600 });
  p.errors = []; p.on("pageerror", (e) => p.errors.push(e.message)); p.on("console", (m) => m.type() === "error" && p.errors.push(m.text()));
  if (doc) { await p.setRequestInterception(true); p.on("request", (r) => new URL(r.url()).pathname === "/sample_offer.json" ? r.respond({ status: 200, contentType: "application/json", body: JSON.stringify(doc) }) : r.continue()); }
  await p.goto(BASE + "/analyze?sample", { waitUntil: "networkidle0" }); await wait(500);
  return p;
}
const card = (p) => p.evaluate(() => {
  const c = [...document.querySelectorAll("h3")].find((h) => h.textContent === "Your first year").parentElement;
  const t = c.innerText.replace(/\s+/g, " ");
  const fig = (label) => [...c.querySelectorAll("dt")].find((d) => d.textContent.trim() === label)?.parentElement.querySelector("dd")?.textContent.trim().replace(/\*$/, "");
  const still = [...c.querySelectorAll("span")].find((s) => s.textContent === "Still to cover from other sources")?.nextElementSibling?.textContent;
  return { coa: fig("Cost of attendance"), cover: fig("Estimated amount to cover"), still, text: t, focus: document.activeElement?.textContent?.trim().slice(0, 40),
    live: [...c.querySelectorAll("[aria-live]")].map((e) => e.textContent.trim()).join(" | ") };
});
const missingNote = (p) => p.evaluate(() => {
  const heading = document.getElementById("group-missing");
  const group = heading?.closest("section");
  const link = group?.querySelector('a[href="#year-one"]');
  return {
    text: group?.textContent.replace(/\s+/g, " ").trim() ?? "",
    href: link?.getAttribute("href") ?? null,
    target: document.getElementById("year-one")?.textContent.trim() ?? null,
  };
});
const click = (p, re) => p.evaluate((src) => { const r = new RegExp(src); const el = [...document.querySelectorAll("button")].find((x) => r.test(x.textContent.replace(/\s+/g, " "))); if (!el) throw new Error("no button " + src); el.click(); }, re.source);
async function enter(p, addRe, amount) { await click(p, addRe); await wait(150); await p.evaluate(() => document.activeElement.select()); await p.keyboard.press("Backspace"); await p.keyboard.type(amount); await p.keyboard.press("Enter"); await wait(); }

// --- Case 1: the Meridian sample, scholarship answered per year
let p = await open();
await p.$eval('input[value="annual"]', (e) => e.click()); await wait();
const requests = []; p.on("request", (r) => requests.push(r.url()));
let c = await card(p);
check("1 missing stays missing", c.coa === "$51,300" && c.cover === "$14,400" && c.text.includes("Your offer doesn’t include every cost") && c.text.includes("Amount not listed"), JSON.stringify(c));
let note = await missingNote(p);
check("1 X-Ray points to itemized estimates", note.text.includes("Add your own yearly estimates in 2. What you’d pay this year") && note.href === "#year-one" && note.target === "2. What you’d pay this year", JSON.stringify(note));
await enter(p, /^Add estimate: Transportation/, "1500");
c = await card(p);
check("2 add estimate", c.coa === "$52,800" && c.cover === "$15,900" && /Transportation\s*\$1,500\s*Your estimate/.test(c.text) && c.text.includes("Includes $1,500 you estimated"), JSON.stringify(c));
check("2 focus lands on Edit", /^Edit/.test(c.focus ?? ""), c.focus);
check("2 announced", c.live.includes("$52,800"), c.live);
check("7 never 'From your offer'", !/from your offer/i.test(c.text), "");
// The row may sit inside a collapsed group, so read textContent, not innerText.
const xrow = await p.evaluate(() => document.getElementById("row-missing_transportation")?.textContent.replace(/\s+/g, " "));
check("2 X-Ray row labelled as the student's", /your estimate · not in the letter/.test(xrow ?? "") && /\$1,500/.test(xrow ?? ""), xrow);
await enter(p, /^Edit Transportation/, "2000");
c = await card(p);
check("3 edit moves by the difference", c.cover === "$16,400", c.cover);
await click(p, /^Remove Transportation/); await wait();
c = await card(p);
check("4 cleared → missing again, not $0", c.coa === "$51,300" && c.cover === "$14,400" && /Transportation\s*Amount not listed/.test(c.text), JSON.stringify(c));
check("4 focus returns to Add", /^Add estimate/.test(c.focus ?? ""), c.focus);
await enter(p, /^Add estimate: Transportation/, "-5");
const err = await p.evaluate(() => document.querySelector("[role=alert]")?.textContent);
c = await card(p);
check("invalid input rejected, not applied", /dollar amount/.test(err ?? "") && c.cover === "$14,400", `${err} ${c.cover}`);
await p.keyboard.press("Escape"); await wait();
await enter(p, /^Add estimate: Transportation/, "1,500");
const loanBoxes = await p.evaluateHandle(() => [...[...document.querySelectorAll("fieldset")].find((f) => f.querySelector("legend")?.textContent === "How will you cover it?").querySelectorAll("input")]);
await p.evaluate((boxes) => boxes.filter((x) => x.closest("label").textContent.includes("Loan")).forEach((x) => x.click()), loanBoxes); await wait();
c = await card(p);
check("5 loans: amount to cover unchanged", c.cover === "$15,900" && c.still === "$10,400" && c.text.includes("$5,500 borrowed"), JSON.stringify({ cover: c.cover, still: c.still }));
await p.evaluate((boxes) => boxes.filter((x) => x.closest("label").textContent.includes("work-study")).forEach((x) => x.click()), loanBoxes); await wait();
c = await card(p);
check("6 work-study: amount to cover unchanged", c.cover === "$15,900" && c.still === "$7,400", JSON.stringify({ cover: c.cover, still: c.still }));
const four = await p.evaluate(() => document.querySelector("#four-years").innerText.replace(/\s+/g, " "));
check("four-year says it includes the student's estimates", four.includes("The letter's costs plus your estimates") && four.includes("$211,200"), four.slice(0, 200));
check("0 network requests", requests.length === 0, requests.join(" "));
check("no console errors", p.errors.length === 0, p.errors.join(" | "));
await p.close();

// --- Case 3: a letter with aid but no cost figure at all
const noCosts = { ...SAMPLE, costs: [] };
p = await open(noCosts);
await p.$eval('input[value="annual"]', (e) => e.click()); await wait();
c = await card(p);
check("8 no costs → asks, never $0", c.text.includes("We need one more piece of information") && c.text.includes("enter the complete yearly cost here instead of adding only a few missing categories") && c.coa === undefined && !c.text.includes("Cost of attendance $0"), c.text.slice(0, 300));
note = await missingNote(p);
check("8 X-Ray points to the whole-cost input", note.text.includes("Enter your school’s full yearly cost of attendance in 2. What you’d pay this year") && note.href === "#year-one" && note.target === "2. What you’d pay this year", JSON.stringify(note));
const projectionLink = await p.evaluate(() => {
  const link = document.querySelector('#four-years a[href="#year-one"]');
  return { text: link?.textContent.trim() ?? null, href: link?.getAttribute("href") ?? null };
});
check("8 four-year empty state points to the cost input", projectionLink.text === "2. What you’d pay this year" && projectionLink.href === "#year-one", JSON.stringify(projectionLink));
await enter(p, /^Enter your school's yearly cost/, "34800");
c = await card(p);
check("8 user total used, labelled 'Provided by you'", c.coa === "$34,800" && c.text.includes("Provided by you") && !c.text.includes("doesn’t include every cost"), JSON.stringify(c).slice(0, 300));
note = await missingNote(p);
check("8 X-Ray acknowledges the entered whole cost", note.text.includes("using the full yearly cost of attendance you entered in 2. What you’d pay this year"), JSON.stringify(note));
const four3 = await p.evaluate(() => document.querySelector("#four-years").innerText.replace(/\s+/g, " "));
check("8 four-year from the user's total", four3.includes("From the yearly cost you entered") && four3.includes("$139,200"), four3.slice(0, 200));
await click(p, /^Remove Your school's yearly cost/); await wait();
c = await card(p);
check("8 removed → asks again", c.text.includes("We need one more piece of information"), c.text.slice(0, 120));
check("no console errors (case 3)", p.errors.length === 0, p.errors.join(" | "));
await p.close();

console.log(results.join("\n"));
await b.close();
