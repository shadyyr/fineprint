// Tab through /analyze and flag any stop without a visible focus ring, off screen,
// or covered by a sticky element (the phone letter pane, the pinned four-year bar).
// W=390 H=844 [ANSWER=1] BASE=http://127.0.0.1:3100 node tabwalk.mjs  -- pass: no NO-RING/OFFSCREEN/COVERED
import puppeteer from "puppeteer-core";
const W = Number(process.env.W), H = Number(process.env.H);
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const p = await b.newPage(); await p.setViewport({ width: W, height: H, isMobile: W < 600 });
await p.goto((process.env.BASE ?? "http://127.0.0.1:3100") + "/analyze?sample", { waitUntil: "networkidle0" }); await p.waitForSelector("#four-years");
if (process.env.ANSWER) { await p.$eval(`input[value="annual"]`, (e) => e.click()); await p.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); }); } await new Promise((r) => setTimeout(r, 800));
const stops = [];
for (let i = 0; i < 120; i++) {
  await p.keyboard.press("Tab"); await new Promise((r) => setTimeout(r, 60));
  const s = await p.evaluate(() => {
    const el = document.activeElement; if (!el || el === document.body) return null;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    // what's on top at the element's centre?
    const cx = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), cy = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
    const top = document.elementFromPoint(cx, cy);
    const covered = top && !el.contains(top) && !top.contains(el) && !(el.labels && [...el.labels].some((l) => l.contains(top)));
    const label = el.closest("label");
    const ring = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 || cs.boxShadow !== "none" || (label && getComputedStyle(label).outlineStyle !== "none" && parseFloat(getComputedStyle(label).outlineWidth) > 0);
    const name = (el.getAttribute("aria-label") || (el.labels?.[0]?.innerText) || el.innerText || el.value || el.title || "").replace(/\s+/g, " ").trim().slice(0, 70);
    const sec = el.closest("section")?.id || el.closest("header,main,footer")?.tagName.toLowerCase();
    return { tag: el.tagName.toLowerCase() + (el.type ? ":" + el.type : ""), name, sec, ring, inView: r.bottom > 0 && r.top < innerHeight, covered: covered ? (top.className?.toString().slice(0, 40) || top.tagName) : false, key: el.outerHTML.slice(0, 80) };
  });
  if (!s) break;
  if (stops.length && stops[0].key === s.key) break;
  stops.push(s);
}
for (const [i, s] of stops.entries()) console.log(String(i + 1).padStart(3), s.sec?.padEnd(10), s.tag.padEnd(16), (s.ring ? "" : "NO-RING ") + (s.inView ? "" : "OFFSCREEN ") + (s.covered ? `COVERED(${s.covered}) ` : ""), "|", s.name);
await b.close();
