import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// "Último resultado salvo · atualizando" must not move the ranking: the podium sits at the same place with and without the message,
// and the message lives in the gap above the podium without covering the filter summary. Real stylesheet + the real class names.
let playwright;
try { playwright = await import("playwright"); }
catch { playwright = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright/index.mjs")).href); }
const source = await fs.readFile("src/pages/RankingGlobal.tsx", "utf8");
assert.match(source, /data-testid="ranking-saved-snapshot" className="nvu-gamer-saved-snapshot /, "the page uses the out-of-flow class");
assert.doesNotMatch(source, /data-testid="ranking-saved-snapshot" className="[^"]*\bmb-3\b/, "the message no longer takes a row of its own");
const assets = await fs.readdir("dist/assets");
const css = (await Promise.all(assets.filter(n => n.endsWith(".css")).map(n => fs.readFile(path.join("dist/assets", n), "utf8")))).join("\n");
assert.match(css, /nvu-gamer-saved-snapshot/, "build the app first");
const html = withMessage => `<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>
<body class="nvu-gamer-ranking"><div class="nvu-gamer-content" style="padding-top:20px">
<div class="nvu-gamer-filters" id="filters"><button class="nvu-gamer-summary" id="summary" style="display:block;margin:0 auto;height:44px;padding:0 24px">GTO · Global · Mês de Novembro</button></div>
<div class="nvu-gamer-results" id="results">
${withMessage ? '<p role="status" data-testid="ranking-saved-snapshot" class="nvu-gamer-saved-snapshot text-slate-500">Último resultado salvo · atualizando</p>' : ""}
<div class="nvu-gamer-top-title" id="title"><strong>TOP 3</strong><span>Destaques do período</span></div><div style="height:300px"></div></div></div></body></html>`;
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.NVU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NVU_CHROMIUM_EXECUTABLE } : {}), args: ["--no-sandbox"] });
let checks = 0;
try {
  const page = await (await browser.newContext()).newPage();
  for (const [width, height] of [[320, 640], [390, 800], [412, 900], [768, 1000], [844, 390], [1280, 800]]) {
    await page.setViewportSize({ width, height });
    const measure = async withMessage => {
      await page.setContent(html(withMessage), { waitUntil: "load" });
      return page.evaluate(() => {
        const r = id => document.getElementById(id).getBoundingClientRect(), message = document.querySelector('[data-testid="ranking-saved-snapshot"]')?.getBoundingClientRect();
        return { title: r("title").top, summaryBottom: r("summary").bottom, message: message ? { top: message.top, bottom: message.bottom, height: message.height } : null,
          overflow: document.documentElement.scrollWidth > innerWidth };
      });
    };
    const without = await measure(false), withIt = await measure(true);
    assert.equal(withIt.title, without.title, `${width}x${height}: the podium title moved by ${withIt.title - without.title}px`);
    assert.ok(withIt.message, "the message is rendered");
    assert.ok(withIt.message.top >= withIt.summaryBottom - 0.5, `${width}x${height}: the message does not cover the filter summary (${withIt.message.top} < ${withIt.summaryBottom})`);
    assert.ok(withIt.message.bottom <= withIt.title + 0.5, `${width}x${height}: the message ends above the podium title`);
    assert.ok(!withIt.overflow, `${width}x${height}: no horizontal overflow`);
    checks++;
  }
  console.log(`RANKING_NO_LAYOUT_SHIFT_UI_PASS (${checks} viewports)`);
} finally { await browser.close(); }
