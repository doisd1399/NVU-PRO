// Geometry QA in Chromium with production CSS and the actual dock component.
// No authenticated app data. Run npm run build first; install Playwright for QA
// or set NVU_PLAYWRIGHT_MODULE and NVU_CHROMIUM_EXECUTABLE in an isolated runner.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import Module from "node:module";
import { build } from "esbuild";
const require = createRequire(import.meta.url), cwd = process.cwd();
const { chromium } = await import(process.env.NVU_PLAYWRIGHT_MODULE || "playwright");
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const bundled = await build({ entryPoints: ["src/components/driver/DriverDock.tsx"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external" });
const compiled = new Module(path.join(cwd, "scripts/.dock-visual.cjs")); compiled.filename = path.join(cwd, "scripts/.dock-visual.cjs");
compiled.paths = Module._nodeModulePaths(path.join(cwd, "scripts")); compiled._compile(bundled.outputFiles[0].text, compiled.filename);
const cssFiles = fs.readdirSync("dist/assets").filter(name => name.endsWith(".css"));
// Index loads before the route stylesheet in the app, including legacy native selectors.
cssFiles.sort((a, b) => Number(!a.startsWith("index-")) - Number(!b.startsWith("index-")));
const css = cssFiles.map(name => fs.readFileSync(path.join("dist/assets", name), "utf8")).join("\n");
const chrome = '<header class="nvu-admin-header nvu-profile-native-header nvu-profile-chrome-header fixed top-0 left-0 right-0 flex items-center justify-between z-50"><span>☰</span><strong data-nvu-layout-brand>NVU</strong><span>○</span></header>';
const companyBody = `<div class="nvu-admin-company-page nvu-company-workspace nvu-workspace-theme min-h-[calc(100vh-64px)] font-sans pb-8 w-full box-border">
  <div class="nvu-company-stack flex flex-col gap-4 pt-4 sm:pt-6 w-full px-4 sm:px-4 md:px-0 box-border">
    <section class="nvu-admin-company-hero nvu-profile-hero relative overflow-hidden h-[300px] sm:h-[320px] rounded-b-[18px]">
      <div class="absolute inset-0 rounded-b-[18px]" style="background:linear-gradient(135deg,#29828c,#43a7b2)"><div class="absolute inset-0" style="background:linear-gradient(0deg,#12475060,transparent)"></div></div>
      <div class="nvu-company-hero-content relative z-10 flex h-full flex-col justify-end p-4 pb-8 sm:p-6 sm:pb-9">
        <div class="flex items-end justify-between gap-3"><div class="min-w-0"><h1 class="nvu-company-hero-name text-white text-[18px] font-bold">DC Transportes</h1><p class="text-white/90">Administrador · David Canto</p></div><button class="nvu-driver-simulator"><span>GTO</span><span>⌄</span></button></div>
      </div>
    </section>
    <div class="nvu-company-surface"><h1 class="text-xl font-bold">Resumo operacional</h1><p>Em tempo real</p><div class="nvu-driver-paper" style="min-height:440px">Operações e motoristas</div></div>
  </div></div>`;
const driverBody = `<div class="nvu-driver-workspace nvu-workspace-theme"><div class="nvu-profile-stack flex flex-col">
  <section class="nvu-profile-hero nvu-driver-hero relative overflow-hidden h-[300px] sm:h-[320px]">
    <div class="absolute inset-0" style="background:linear-gradient(130deg,#215862,#267e88)"></div>
    <div class="nvu-driver-hero-content relative h-full flex flex-col justify-end p-4 pb-8"><div class="flex items-end justify-between"><div><h1 class="text-white font-bold text-[18px]">David Canto</h1><p class="text-white/90">Motorista Parceiro</p></div><button class="nvu-driver-simulator">GTO ⌄</button></div></div>
  </section><div class="nvu-driver-surface" data-page="dashboard"><div class="nvu-driver-page-heading" data-page="dashboard"><h1>Operação atual</h1><p>Acompanhe suas entregas e o prazo.</p></div><div class="nvu-driver-paper" style="min-height:440px">Volvo FH 16 · BLS - 130</div></div>
</div></div>`;
function documentFor(role, dark) {
  const admin = role === "admin", dock = renderToStaticMarkup(React.createElement(compiled.exports.DriverDock, { active: "dashboard", variant: admin ? "company" : "driver", onSelect: () => {} }));
  const shell = admin
    ? `<div class="nvu-admin-shell nvu-workspace-shell nvu-native-android nvu-native-admin-company-route min-h-screen flex flex-col">${chrome}<div class="nvu-admin-shell-content flex-1 flex"><main class="flex-1 min-w-0"><div>${companyBody}</div></main></div><div class="nvu-workspace-dock-space"></div>${dock}</div>`
    : `<div class="nvu-workspace-shell nvu-native-android nvu-native-driver-shell nvu-native-profile-route min-h-screen flex flex-col">${chrome}<div class="nvu-native-shell nvu-native-profile-shell flex-1 flex"><main class="nvu-native-main flex-1 min-w-0"><div class="nvu-native-content nvu-native-profile-content">${driverBody}</div></main></div><div class="nvu-workspace-dock-space"></div>${dock}</div>`;
  return `<!doctype html><html class="${dark ? "dark" : "light"}"><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${css}</style></head><body><div id="root">${shell}</div></body></html>`;
}
const browser = await chromium.launch({ headless: true, ...(process.env.NVU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NVU_CHROMIUM_EXECUTABLE } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote"] });
const cases = [];
fs.mkdirSync("reports/fluency-476-visual", { recursive: true });
try {
  for (const width of [320, 360, 412, 768]) for (const role of ["driver", "admin"]) for (const dark of [false, true]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    await page.route("**/*", route => route.abort());
    await page.setContent(documentFor(role, dark));
    const metrics = await page.evaluate(() => {
      const get = s => document.querySelector(s), style = s => getComputedStyle(get(s));
      const hero = get('.nvu-profile-hero').getBoundingClientRect(), surface = get('.nvu-company-surface,.nvu-driver-surface').getBoundingClientRect();
      return { heroBottom: hero.bottom, surfaceTop: surface.top,
        gap: get('.nvu-company-stack') ? style('.nvu-company-stack').gap : null,
        radius: style('.nvu-profile-hero').borderBottomLeftRadius,
        dock: style('.nvu-driver-dock').backgroundColor, spacer: style('.nvu-workspace-dock-space').backgroundColor,
        shell: style('.nvu-workspace-shell').backgroundColor,
        page: style('.nvu-company-surface,.nvu-driver-surface').backgroundColor,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        buttons: [...document.querySelectorAll('.nvu-driver-dock button')].map(node => {
          const r = node.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width, label: node.getAttribute("aria-label") };
        }) };
    });
    const label = `${role}-${dark ? "dark" : "light"}-${width}`;
    assert(metrics.surfaceTop <= metrics.heroBottom - 16, `${label}: curve must overlap the photo by its entire radius`);
    assert.equal(metrics.radius, "0px", `${label}: hero keeps a straight bottom`);
    if (role === "admin") assert.equal(metrics.gap, "0px", `${label}: legacy company gap must not win`);
    assert.equal(metrics.page, metrics.spacer, `${label}: clearance cannot reveal a dark strip`);
    assert.equal(metrics.page, metrics.shell, `${label}: shell cannot reveal a dark strip`);
    assert.notEqual(metrics.dock, metrics.page, `${label}: approved floating capsule has a discreet distinct tone`);
    assert.equal(metrics.page, dark ? "rgb(16, 21, 28)" : "rgb(247, 249, 250)");
    assert(!metrics.horizontalOverflow, `${label}: no horizontal clipping`);
    assert.equal(metrics.buttons.length, 6);
    assert(metrics.buttons.every(button => button.x >= 0 && button.right <= width + .5 && button.width >= 40), `${label}: all dock targets remain available`);
    if (width === 360) await page.screenshot({ path: `reports/fluency-476-visual/${label}.png`, fullPage: true });
    cases.push({ label, result: "PASS", metrics }); await page.close();
    console.log(`PASS ${label}`);
  }
  fs.writeFileSync("reports/fluency-476-visual.json", JSON.stringify({ result: "PASS", browser: browser.version(), cases,
    scope: "Production generated CSS + actual DriverDock + isolated native-shell geometry fixture. No authenticated data, APK run or device latency measurement." }, null, 2));
  console.log(`FLUENCY_476_VISUAL_PASS ${cases.length} viewport/theme/workspace cases`);
} finally { await browser.close(); }
