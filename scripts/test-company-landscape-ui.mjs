import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Real AdminLayout -> Fleet (Empresa, Estatísticas), TripHistory (Atividade) and Reports (Resultados) with the built
// production CSS. Only the session, remote and ranking adapters are fixtures (scripts/fixtures/company-landscape-fixtures.tsx).
// Horizontal windows (landscape, 720px or wider) share the driver's cover box and keep the content in the visible area,
// with lists scrolling inside their own card; portrait and small windows keep the layout they always had.
const root = process.cwd();
const output = path.resolve(process.env.NVU_COMPANY_QA_DIR || "verification/company-landscape");
await fs.mkdir(output, { recursive: true });
let playwright;
try { playwright = await import("playwright"); }
catch { playwright = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright/index.mjs")).href); }
const vehicleBytes = await fs.readFile("scripts/fixtures/central-management/vehicle.jpg");
const photo = `data:image/jpeg;base64,${vehicleBytes.toString("base64")}`;
const avatar = `data:image/png;base64,${(await fs.readFile("scripts/fixtures/central-management/avatar.png")).toString("base64")}`;
const cssFiles = (await fs.readdir("dist/assets")).filter(name => name.endsWith(".css")).sort((a, b) => Number(!a.startsWith("index-")) - Number(!b.startsWith("index-")));
assert(cssFiles.some(name => name.startsWith("index-")), "Build the app before running the UI check");
const css = (await Promise.all(cssFiles.map(name => fs.readFile(path.join("dist/assets", name), "utf8")))).join("\n");
const fixtures = await fs.readFile("scripts/fixtures/company-landscape-fixtures.tsx", "utf8");
const adapters = new Set(["AppContext.tsx", "CompanyContext.tsx", "NotificationsContext.tsx", "firebase.ts", "routePreload.ts", "rankingPhotoWarmup.ts", "usePersistentRankingImage.ts", "useTripHistory.ts", "useDriverTrips.ts", "useMissingOperationTrip.ts", "SimpleAutomationCompletionBridge.tsx", "CompactProfileEditorModal.tsx", "NotificationCenter.tsx", "ProfileModal.tsx", "useVehiclePhoto.ts", "workModeAvailabilityService.ts", "simpleAutomationCityService.ts", "operationIntegrityGuard.ts", "uploadService.ts", "useProfileRanking.ts", "useTripsRealtime.ts", "AutomaticOperationsProvider.tsx", "useLocalOperationPending.ts", "CanonicalTripMigrationService.ts", "CanonicalTripCommandService.ts", "CanonicalTripOperationService.ts", "syncManager.ts", "tripModerationService.ts", "ProPendingAuthButton.tsx", "ProPendingRetryButton.tsx", "ProAttemptDiagnosticDetails.tsx", "FailedHistoryRegistrationRecovery.tsx", "OperationResultModal.tsx"]);
const secondary = new Set(["VehiclesTab.tsx", "TrailersTab.tsx", "DriversTab.tsx", "ContractsTab.tsx", "RecruitmentTab.tsx", "GtoObserverSetup.tsx", "OperationsTab.tsx"]);
const bundle = await build({
  stdin: { resolveDir: root, sourcefile: "company-landscape-ui.tsx", loader: "tsx", contents: `
import React from "react";import {createRoot} from "react-dom/client";import {MemoryRouter,Routes,Route,useLocation,useNavigate} from "react-router-dom";
import AdminLayout from "./src/layouts/AdminLayout";import Fleet from "./src/pages/admin/Fleet";import AdminReports from "./src/pages/admin/Reports";import TripHistoryPage from "./src/pages/driver/TripHistory";
import {WorkspaceScrollMemory} from "./src/components/common/WorkspaceScrollMemory";import {startProfileCoverSync} from "./src/services/profileCoverService";
startProfileCoverSync();
function Probe(){const location=useLocation(),navigate=useNavigate();window.__route={pathname:location.pathname,state:location.state};window.__go=navigate;return null;}
createRoot(document.getElementById("root")).render(<MemoryRouter initialEntries={[{pathname:"/admin/fleet",state:{activeTab:"company"}}]}><Probe/><WorkspaceScrollMemory scope="qa:company"/><Routes><Route path="/admin" element={<AdminLayout/>}><Route path="history" element={<TripHistoryPage/>}/><Route path="fleet" element={<Fleet/>}/><Route path="reports" element={<AdminReports/>}/><Route path="*" element={<div>Destino</div>}/></Route><Route path="*" element={<div>Outra página</div>}/></Routes></MemoryRouter>);
` },
  bundle: true, write: false, outfile: path.join(output, "fixture.js"), format: "iife", platform: "browser", jsx: "automatic", loader: { ".css": "empty" }, logLevel: "error",
  define: { "process.env.NODE_ENV": '"test"', "import.meta.env.BASE_URL": '"/"', "import.meta.env.PROD": "false", "import.meta.env.DEV": "false", "import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID": '""', __AVATAR__: JSON.stringify(avatar), __VEHICLE__: JSON.stringify(photo) },
  plugins: [{ name: "company-adapters", setup(plugin) {
    plugin.onResolve({ filter: /^company-fixtures$/ }, () => ({ path: "fixtures", namespace: "company-fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "company-fixture" }, () => ({ contents: fixtures, resolveDir: root, loader: "tsx" }));
    plugin.onResolve({ filter: /^firebase\/(auth|firestore)$/ }, args => ["/profileCoverService.ts", "/companyDescriptionService.ts", "/useCompanyDescription.ts", "/CompanyTab.tsx", "/TripHistory.tsx"].some(file => args.importer.endsWith(file)) ? { path: "fixtures", namespace: "company-fixture" } : undefined);
    plugin.onLoad({ filter: /src\/.*\.tsx?$/ }, args => adapters.has(path.basename(args.path)) || secondary.has(path.basename(args.path)) ? { contents: 'export * from "company-fixtures";export {default} from "company-fixtures";', resolveDir: root, loader: "tsx" } : undefined);
  } }],
});
const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const ORIGIN = "http://127.0.0.1:43829";
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${css}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.NVU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NVU_CHROMIUM_EXECUTABLE } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const errors = [], outbound = [], results = [];
async function check(name, run) { await run(); results.push({ name, pass: true }); console.log("PASS " + name); }

const PAGES = [
  { name: "Empresa", path: "/admin/fleet", state: { activeTab: "company" } },
  { name: "Estatísticas", path: "/admin/fleet", state: { activeTab: "company" }, tab: "Estatísticas" },
  { name: "Atividade", path: "/admin/history" },
  { name: "Resultados", path: "/admin/reports" },
];

async function openWindow(viewport, { mobile = false } = {}) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, timezoneId: "America/Sao_Paulo" });
  await context.addInitScript(() => {
    const RealDate = Date, fixed = new RealDate("2026-10-29T10:00:00Z").getTime();
    window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
  });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname === "cover-qa.test") return route.fulfill({ body: vehicleBytes, contentType: "image/jpeg", headers: { "access-control-allow-origin": "*" } });
    if (url.hostname !== "127.0.0.1") { outbound.push(url.href); return route.abort(); }
    if (url.pathname.endsWith(".woff2")) return route.fulfill({ contentType: "font/woff2", body: await fs.readFile(path.join(root, "public", url.pathname)) });
    return route.fulfill({ contentType: "text/html", body: html });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  return { context, page };
}

const measure = page => page.evaluate(() => {
  const rect = node => { if (!node) return null; const box = node.getBoundingClientRect(); return { x: Math.round(box.left), y: Math.round(box.top + scrollY), w: Math.round(box.width), h: Math.round(box.height) }; };
  const visible = selector => [...document.querySelectorAll(selector)].find(node => node.getClientRects().length);
  const shell = document.querySelector(".nvu-admin-shell");
  const fill = visible('.nvu-company-fill, .nvu-profile-ranking-layout[data-nvu-profile-view="statistics"]');
  const image = visible(".nvu-cover-image img");
  return {
    landscape: shell.classList.contains("nvu-landscape-company"),
    fillVar: getComputedStyle(shell).getPropertyValue("--nvu-fill-h").trim(),
    cover: rect(visible(".nvu-cover-image")),
    coverLoaded: Boolean(image && image.complete && image.naturalWidth > 0),
    list: fill ? { ...rect(fill), client: fill.clientHeight, scroll: fill.scrollHeight, overflow: getComputedStyle(fill).overflowY, maxHeight: getComputedStyle(fill).maxHeight } : null,
    doc: { scroll: document.documentElement.scrollHeight, inner: innerHeight, scrollWidth: document.documentElement.scrollWidth, width: innerWidth },
  };
});

// Reads the page until two consecutive measurements agree (images decoded, fonts loaded, the fill height applied).
async function stable(page) {
  await page.evaluate(() => document.fonts.ready);
  let previous = "", current = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    current = JSON.stringify(await measure(page));
    if (current === previous) break;
    previous = current; await page.waitForTimeout(90);
  }
  return JSON.parse(current);
}

async function setTheme(page, theme) {
  await page.evaluate(theme => { document.documentElement.classList.toggle("dark", theme === "dark"); window.dispatchEvent(new CustomEvent("nvu:theme-change", { detail: theme })); }, theme);
}

async function go(page, entry) {
  await page.evaluate(({ path: to, state }) => window.__go(to, { state }), { path: entry.path, state: entry.state || {} });
  await page.waitForFunction(({ path: to }) => window.__route.pathname === to, { path: entry.path });
  if (entry.tab) await page.getByRole("button", { name: entry.tab, exact: true }).click();
  await page.locator(".nvu-cover-hero:visible").first().waitFor();
}

// A fresh load of the page, so every page is measured on its own and not on top of the previous one.
async function show(page, entry, theme = "light") {
  await page.goto(ORIGIN + "/");
  await page.waitForFunction(() => window.__go);
  await setTheme(page, theme);
  await go(page, entry);
  return stable(page);
}

try {
  await check("Horizontal company pages share one cover box and fit the visible area (large window, light and dark)", async () => {
    const { context, page } = await openWindow({ width: 1911, height: 947 });
    for (const theme of ["light", "dark"]) {
      const covers = [];
      for (const entry of PAGES) {
        const m = await show(page, entry, theme), info = `${entry.name} ${theme} ${JSON.stringify(m)}`;
        assert(m.landscape, "Horizontal windows get the company layout: " + info);
        assert(m.coverLoaded, "The company cover from the remote URL is displayed: " + info);
        assert(m.cover.w >= 800 && m.cover.w <= 960 && m.cover.h >= 280 && m.cover.h <= 320, "The cover keeps the shared box: " + info);
        assert(m.doc.scroll <= m.doc.inner + 1 && m.doc.scrollWidth <= m.doc.width, "The page fits the visible area: " + info);
        covers.push(JSON.stringify(m.cover));
        if (entry.name === "Atividade" || entry.name === "Resultados") {
          assert(m.list && m.list.overflow === "auto" && m.list.y + m.list.h <= m.doc.inner - 8, "The list ends inside the visible area: " + info);
          if (entry.name === "Atividade") assert(m.list.scroll > m.list.client, "The trips scroll inside their own card: " + info);
        }
        if (theme === "light") await page.screenshot({ path: path.join(output, `company-${entry.name}-${theme}.png`) });
      }
      assert.equal(new Set(covers).size, 1, "Every company page shows the cover at the same place and size: " + covers.join(" | "));
    }
    await context.close();
  });

  await check("Switching between Atividade and Resultados measures the list again", async () => {
    const { context, page } = await openWindow({ width: 1911, height: 947 });
    await page.goto(ORIGIN + "/"); await page.waitForFunction(() => window.__go);
    await go(page, PAGES[2]); const first = await stable(page);
    await go(page, PAGES[3]); const results = await stable(page);
    await go(page, PAGES[2]); const back = await stable(page);
    for (const m of [first, results, back]) assert(m.landscape && m.doc.scroll <= m.doc.inner + 1 && m.list.y + m.list.h <= m.doc.inner - 8, JSON.stringify(m));
    assert(Math.abs(back.list.h - first.list.h) <= 1 && back.fillVar === first.fillVar, "Returning to the first page restores its list height: " + JSON.stringify({ first: first.list, back: back.list }));
    assert.equal(JSON.stringify(first.cover), JSON.stringify(results.cover));
    await context.close();
  });

  await check("A smaller horizontal window keeps one cover box, no sideways overflow and a list of at least a few rows", async () => {
    const { context, page } = await openWindow({ width: 1366, height: 768 });
    const covers = [];
    for (const entry of PAGES) {
      const m = await show(page, entry), info = `${entry.name} ${JSON.stringify(m)}`;
      assert(m.landscape && m.coverLoaded && m.doc.scrollWidth <= m.doc.width, info);
      covers.push(JSON.stringify(m.cover));
      if (entry.name === "Atividade") assert(m.list.overflow === "auto" && m.list.client >= 200, "The list keeps room for a few rows: " + info);
    }
    assert.equal(new Set(covers).size, 1, covers.join(" | "));
    await context.close();
  });

  for (const [label, viewport, mobile] of [["phone portrait", { width: 390, height: 867 }, true], ["tablet portrait", { width: 820, height: 1180 }, false], ["phone landscape below 720px", { width: 700, height: 380 }, true]]) {
    await check(`Portrait and small windows keep the original layout: ${label}`, async () => {
      const { context, page } = await openWindow(viewport, { mobile });
      for (const entry of PAGES) {
        const m = await show(page, entry), info = `${entry.name} ${JSON.stringify(m)}`;
        assert(!m.landscape && m.fillVar === "", "The horizontal company layout is off: " + info);
        assert(m.coverLoaded, "The cover is displayed: " + info);
        if (m.list) assert(m.list.overflow === "visible" && m.list.maxHeight === "none", "Lists are not turned into scroll areas: " + info);
        if (entry.name === "Atividade") assert(m.doc.scroll > m.doc.inner, "Atividade scrolls with the page, as before: " + info);
      }
      await context.close();
    });
  }

  assert.deepEqual(errors, []);
  assert.deepEqual(outbound, []);
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ results, errors, outbound }, null, 2));
  console.log(`COMPANY_LANDSCAPE_UI_PASS ${results.length} checks; no external requests or browser errors.`);
} finally { await browser.close(); }
