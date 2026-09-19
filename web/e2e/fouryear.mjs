import puppeteer from "puppeteer-core";
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const OUT = new URL(process.env.OUT ?? "./out/", import.meta.url).pathname;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-sandbox", "--force-color-profile=srgb"] });
const p = await browser.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await p.setViewport({ width: 1440, height: 1000 });
await p.goto(BASE + "/analyze?sample", { waitUntil: "networkidle0" });
await p.waitForSelector("#four-years");
await wait(800);

const requests = [];
p.on("request", (r) => requests.push(r.url()));

const read = () => p.evaluate(() => {
  const sec = document.getElementById("four-years");
  const fig = (label) => [...sec.querySelectorAll("dt")].find((d) => d.textContent.includes(label))?.nextElementSibling?.textContent?.replace(/\*$/, "").trim();
  const live = sec.querySelector('[aria-live="polite"]')?.innerText.replace(/\n+/g, " | ").trim();
  const banner = !!sec.querySelector(".shadow-\\[inset_4px_0_0_var\\(--color-unclear\\)\\]");
  const borrow = [...sec.querySelectorAll("p")].find((x) => x.textContent.includes("borrow"))?.querySelector("span.font-semibold")?.textContent;
  const meritBox = [...sec.querySelectorAll('input[type="checkbox"]')].find((c) => c.closest("label")?.textContent.includes("Presidential"));
  return { cost: fig("Four-year cost"), gift: fig("Minus gift aid"), cover: fig("Left to cover"), borrow: borrow ?? null, banner, meritToggleDisabled: meritBox?.disabled ?? null, live };
});
const click = (sel) => p.$eval(sel, (el) => el.click());
const shot = (n) => p.$eval("#four-years", (el) => el.scrollIntoView({ block: "start" })).then(() => wait(300)).then(() => p.screenshot({ path: `${OUT}${n}.png` }));
const steps = [];
const step = async (name, expect) => { const r = await read(); steps.push({ name, ...r, expect }); };

await step("1 · unanswered", "banner on, merit toggle disabled, merit excluded from totals");
await shot("1-unanswered");

await click('input[value="annual"]'); await wait(400);
await step("2 · answered: per year", "cost $205,200 · gift $147,600 · cover $57,600");
await shot("2-annual");

const merit = await p.evaluateHandle(() => [...document.querySelectorAll('#four-years input[type="checkbox"]')].find((c) => c.closest("label")?.textContent.includes("Presidential")));
await merit.click(); await wait(400);
await step("3 · scholarship not renewed", "cover $117,600 (+$60,000)");
await shot("3-not-renewed");

await merit.click(); await wait(300);
await p.$eval('#four-years input[type="range"]', (el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, "4"); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
await wait(400);
await step("4 · costs +4%/yr", "cost $217,844 · cover $70,244");

await p.$eval('#four-years input[type="range"]', (el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, "0"); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
const loanBoxes = await p.$$('#four-years fieldset input[type="checkbox"]');
for (const b of loanBoxes) { const t = await b.evaluate((c) => c.closest("label").textContent); if (t.includes("Loan")) await b.click(); }
await wait(400);
await step("5 · both loans accepted", "borrow $22,000 · cover unchanged $57,600");
await shot("5-loans");

for (const b of loanBoxes) { const t = await b.evaluate((c) => c.closest("label").textContent); if (t.includes("Loan")) await b.click(); }
await click('#four-years input[type="radio"][name="housing"]:nth-of-type(1)').catch(() => {});
const radios = await p.$$('#four-years input[name="housing"]');
await radios[1].click(); await wait(400);
await step("6 · live at home", "cost $144,000");

await p.evaluate(() => [...document.querySelectorAll("#four-years button")].find((b) => b.textContent.includes("Back to the letter"))?.click());
await wait(400);
await step("7 · back to the letter", "cost $205,200 · cover $57,600 · 'letter as written'");

// Phone width
await p.setViewport({ width: 400, height: 860 });
await wait(600);
await shot("8-phone");
const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);

await browser.close();
for (const s of steps) {
  console.log(`${s.name}\n   expect: ${s.expect}`);
  console.log(`   got:    cost ${s.cost} · gift ${s.gift} · cover ${s.cover}${s.borrow ? " · borrow " + s.borrow : ""} · banner ${s.banner} · merit toggle disabled ${s.meritToggleDisabled}`);
  console.log(`   live:   ${s.live}`);
}
console.log(`\nnetwork requests during all what-if changes: ${requests.length}`);
console.log(`horizontal overflow at 400px: ${overflow}`);
console.log(`console/page errors: ${errors.length}${errors.length ? " — " + errors[0].slice(0, 120) : ""}`);
