import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

// "Histórico de classificações" in the ranking participant sheet must use the sheet's own text colour in both themes, even
// when the driver profile stylesheet (generic .nvu-profile-history-toggle, dark fallback text) is loaded too.
const assets = await fs.readdir("dist/assets");
// Load order matters: the profile sheet stylesheet arrives with the profile page, usually AFTER the ranking page stylesheet.
const rank = name => name.startsWith("index-") ? 0 : name.startsWith("DriverProfileSummary-") ? 2 : 1;
const files = assets.filter(name => name.endsWith(".css")).sort((a, b) => rank(a) - rank(b));
assert(files.some(name => name.startsWith("DriverProfileSummary-")), "Build the app first (DriverProfileSummary css chunk)");
assert(files.some(name => name.startsWith("RankingGlobal-")), "Build the app first (RankingGlobal css chunk)");
const css = (await Promise.all(files.map(name => fs.readFile(path.join("dist/assets", name), "utf8")))).join("\n");
const page = await (await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.NVU_CHROMIUM_EXECUTABLE, headless: true, args: ["--no-sandbox", "--disable-gpu"] })).newPage({ viewport: { width: 412, height: 915 } });
const markup = `<div class="nvu-ranking-profile-overlay"><div class="nvu-ranking-profile-modal"><section class="nvu-profile-history">
  <button type="button" class="nvu-profile-history-toggle" aria-expanded="true"><span class="nvu-profile-history-icon"></span><span>Histórico de classificações</span><svg width="17" height="17"></svg></button>
  <div class="nvu-profile-history-body"><div class="nvu-profile-history-row"><div><p class="nvu-profile-history-period">Out 2026</p><p class="nvu-profile-history-status">2º de 24</p></div></div></div>
  </section><span id="probe" style="color:var(--profile-text)">x</span></div></div>`;
const results = [];
for (const theme of ["light", "dark"]) {
  await page.setContent(`<!doctype html><html class="${theme === "dark" ? "dark" : ""}"><head><meta charset="utf-8"><style>${css}</style></head><body>${markup}</body></html>`);
  const read = async selector => page.$eval(selector, node => getComputedStyle(node).color);
  const expected = await read("#probe");
  const toggle = await read(".nvu-profile-history-toggle"), label = await read(".nvu-profile-history-toggle > span:nth-child(2)");
  assert.equal(toggle, expected, `${theme}: toggle text must be the sheet's text colour`);
  assert.equal(label, expected, `${theme}: label text must be the sheet's text colour`);
  assert.notEqual(toggle, "rgb(24, 35, 50)", `${theme}: the driver profile fallback (#182332) must not apply here`);
  assert.equal(await read(".nvu-profile-history-period"), expected, `${theme}: period text`);
  results.push(`${theme}: ${toggle}`);
}
assert.notEqual(results[0].split(": ")[1], results[1].split(": ")[1], "the colour must follow the theme");
console.log("RANKING_HISTORY_THEME_UI_PASS", results.join(" | "));
process.exit(0);
