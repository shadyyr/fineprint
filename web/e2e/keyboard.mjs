// The demo path by keyboard alone: answer the question, select an X-Ray row, move
// what-if levers, reset. Prints what each aria-live region says after each step.
// BASE=http://127.0.0.1:3100 node keyboard.mjs  -- pass: 0 requests, 0 errors, focus stays on "Back to the letter"
import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 800 });
const errors = []; p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await p.goto((process.env.BASE ?? "http://127.0.0.1:3100") + "/analyze?sample", { waitUntil: "networkidle0" }); await new Promise((r) => setTimeout(r, 800));
const reqs = []; p.on("request", (r) => reqs.push(r.url()));
const w = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const tabTo = async (pred) => { for (let i = 0; i < 80; i++) { await p.keyboard.press("Tab"); await w(30); if (await p.evaluate(pred)) return true; } return false; };
const lives = () => p.evaluate(() => [...document.querySelectorAll("[aria-live]")].map((e) => e.innerText.replace(/\s+/g, " ").trim()).filter(Boolean));
const out = {};
// 1. answer the question with the keyboard
await tabTo(() => document.activeElement.type === "radio" && !!document.activeElement.closest("[id^=question-]"));
out.q_focused = await p.evaluate(() => `${document.activeElement.value} checked=${document.activeElement.checked}`);
await p.keyboard.press("Space"); await w();
out.q_afterSpace = await p.evaluate(() => [...document.querySelectorAll("[id^=question-] input[type=radio]")].map((r) => `${r.value}:${r.checked}`).join(" "));
await p.keyboard.press("ArrowDown"); await w();
out.q_afterArrow = await p.evaluate(() => [...document.querySelectorAll("[id^=question-] input[type=radio]")].map((r) => `${r.value}:${r.checked}`).join(" "));
out.live_afterAnswer = await lives();
await p.keyboard.press("ArrowUp"); await w();
// 2. select an X-Ray row with Enter
await tabTo(() => document.activeElement.closest("li[id^=row-]")?.textContent.includes("Subsidized"));
await p.keyboard.press("Enter"); await w(600);
out.row = await p.evaluate(() => ({ pressed: document.activeElement.getAttribute("aria-pressed"), focusStays: !!document.activeElement.closest("li[id^=row-]") }));
out.live_afterRow = await lives();
// 3. what-if: arrow keys on the range, space on the scholarship checkbox
await tabTo(() => document.activeElement.type === "range");
await p.keyboard.press("ArrowRight"); await p.keyboard.press("ArrowRight"); await w();
out.range = await p.evaluate(() => document.activeElement.value);
await tabTo(() => document.activeElement.type === "checkbox" && document.activeElement.closest("label")?.textContent.includes("Presidential"));
await p.keyboard.press("Space"); await w();
out.live_afterWhatIf = await lives();
// 4. reset via keyboard
await p.keyboard.down("Shift"); await tabTo(() => /Back to the letter/.test(document.activeElement.textContent)); await p.keyboard.up("Shift");
await p.keyboard.press("Enter"); await w();
out.afterReset_focus = await p.evaluate(() => `${document.activeElement.tagName} "${document.activeElement.textContent.trim().slice(0, 40)}" disabled=${document.activeElement.disabled}`);
out.live_afterReset = await lives();
out.requests = reqs.length; out.errors = errors;
console.log(JSON.stringify(out, null, 1)); await b.close();
