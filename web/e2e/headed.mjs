// A real, visible Chrome window: real display, real device pixel ratio, the
// system's own scrollbar setting. Sized like Shade's screenshot (narrow, tall,
// one-column X-Ray).
import puppeteer from "puppeteer-core";
const OUT = new URL(process.env.OUT ?? "./out/", import.meta.url).pathname;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(label, base) {
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: false, defaultViewport: null,
    args: ["--window-size=840,1180", "--window-position=40,40", "--no-first-run", "--no-default-browser-check"],
  });
  const [p] = await browser.pages();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
  await p.goto(base + "/analyze?sample", { waitUntil: "networkidle0" });
  await p.waitForSelector("#xray canvas", { timeout: 30000 });
  await p.evaluate(() => document.getElementById("xray").scrollIntoView({ block: "start" }));
  await wait(3500);
  const m = await p.evaluate(() => {
    const c = document.querySelector("#xray canvas");
    const pane = document.querySelector("#xray [class*='overflow-auto']");
    const W = c.width, H = c.height, d = c.getContext("2d").getImageData(0, 0, W, H).data;
    let opaque = 0, n = 0, top = 0, bottom = 0, minX = W, maxX = 0;
    for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
      const i = (y * W + x) * 4; n++;
      if (d[i + 3] > 200) opaque++;
      if (d[i + 3] > 200 && d[i] + d[i + 1] + d[i + 2] < 300) { if (y < H * 0.15) top++; if (y > H * 0.85) bottom++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    }
    return {
      dpr: devicePixelRatio,
      viewport: `${innerWidth}x${innerHeight}`,
      paneScrollbarPx: pane.offsetWidth - pane.clientWidth - 2,
      painted: Math.round((100 * opaque) / n),
      upright: top > bottom * 2,
      inkWidth: Math.round((100 * (maxX - minX)) / W),
    };
  });
  await p.screenshot({ path: `${OUT}headed-${label}.png` });
  await browser.close();
  const ok = m.painted === 100 && m.upright && m.inkWidth >= 50;
  return `${label.padEnd(24)} ${ok ? "CORRECT" : "BROKEN "}  dpr ${m.dpr}  viewport ${m.viewport}  pane scrollbar ${m.paneScrollbarPx}px  painted ${m.painted}%  upright ${m.upright}  ink width ${m.inkWidth}%` + (errors.length ? `\n    ${errors[0]}` : "");
}
console.log(await check("X-Ray render", process.env.BASE ?? "https://fineprint-aid.vercel.app"));
