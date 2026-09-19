// Three checks against a deployed or local build:
//   1. Do the "needs your answer" selections make ANY network request?
//   2. Reproduce the print-to-PDF the user made.
//   3. Look at the X-Ray at common laptop widths, not just 1440.
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE ?? "https://fineprint-aid.vercel.app";
const OUT = new URL(process.env.OUT ?? "./out/", import.meta.url).pathname;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox", "--force-color-profile=srgb"],
});
const report = {};

// ---------------------------------------------------------------- 1. network
{
  const p = await browser.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto(BASE + "/analyze?sample", { waitUntil: "networkidle0" });
  await p.waitForSelector("#xray canvas", { timeout: 20000 });
  await wait(800);

  // Record everything from here on: any fetch, XHR, or navigation.
  const requests = [];
  p.on("request", (r) => requests.push(`${r.method()} ${r.resourceType()} ${r.url()}`));

  const pick = async (value) => {
    const el = await p.$(`input[value="${value}"]`);
    await p.evaluate((node) => node.closest("label").click(), el);
    await wait(700);
  };
  const readFigures = () =>
    p.evaluate(() => ({
      hero: document.querySelector(".text-6xl")?.textContent,
      cover: [...document.querySelectorAll("dt")]
        .find((d) => d.textContent?.includes("Estimated amount to cover"))
        ?.parentElement?.querySelector(".figures")?.textContent,
    }));

  const before = await readFigures();
  await pick("annual");
  const afterAnnual = await readFigures();
  await pick("four_year_total");
  const afterTotal = await readFigures();
  // Undo, then select X-Ray rows too — every interaction on the page.
  await p.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("undo my answer"))?.click(),
  );
  await wait(500);
  for (const id of ["aid_merit", "aid_sub_loan", "cost_tuition"]) {
    const row = await p.$(`[id^="row-${id}"] > button`);
    if (row) {
      await row.click();
      await wait(600);
    }
  }

  report.network = {
    requestsDuringInteraction: requests.length,
    requests,
    figures: { before, afterAnnual, afterTotal },
  };
  await p.close();
}

// ---------------------------------------------------------------- 2. print
{
  const p = await browser.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto(BASE + "/analyze?sample", { waitUntil: "networkidle0" });
  await p.waitForSelector("#xray canvas", { timeout: 20000 });
  await wait(1200);
  await p.pdf({ path: OUT + "print.pdf", format: "Letter", printBackground: false });
  await p.pdf({ path: OUT + "print-bg.pdf", format: "Letter", printBackground: true });
  await p.close();
}

// ---------------------------------------------------------------- 3. widths
report.widths = {};
for (const [w, h] of [
  [1280, 800],
  [1366, 768],
  [1100, 800],
  [900, 900],
]) {
  const p = await browser.newPage();
  await p.setViewport({ width: w, height: h });
  await p.goto(BASE + "/analyze?sample", { waitUntil: "networkidle0" });
  await p.waitForSelector("#xray canvas", { timeout: 20000 });
  await p.evaluate(() => document.getElementById("xray").scrollIntoView({ block: "start" }));
  await wait(900);
  const row = await p.$('[id^="row-aid_sub_loan"] > button');
  if (row) await row.click();
  await wait(1300);

  report.widths[`${w}x${h}`] = await p.evaluate(() => {
    const pane = document.querySelector("#xray [class*='overflow-auto']");
    const canvas = document.querySelector("#xray canvas");
    const hl = document.querySelector('[data-evidence][aria-pressed="true"]');
    const vis = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), inViewport: r.bottom > 0 && r.top < innerHeight };
    };
    return {
      layout: (() => { const a = pane?.getBoundingClientRect(); const b = document.querySelector('[id^="row-"]')?.getBoundingClientRect(); return a && b && Math.abs(a.left - b.left) > 40 ? "two columns" : "one column"; })(),
      paneScrollsSideways: pane ? pane.scrollWidth > pane.clientWidth + 1 : null,
      paneClientWidth: pane?.clientWidth,
      canvasCssWidth: canvas ? Math.round(canvas.getBoundingClientRect().width) : null,
      selectedHighlight: vis(hl),
      pdfPane: vis(pane),
    };
  });
  await p.screenshot({ path: `${OUT}width-${w}.png` });
  await p.close();
}

await browser.close();
console.log(JSON.stringify(report, null, 2));
