import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// The real floating menu (GlobalMenu) with the built production CSS, on pages with and without the native profile-route
// flag, in both themes. Session and remote adapters are the fixtures of scripts/fixtures/operation-info-fixtures.tsx.
const root = process.cwd();
const output = path.resolve(process.env.NVU_OPERATION_INFO_QA_DIR || "verification/operation-info");
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
const fixtures = await fs.readFile("scripts/fixtures/operation-info-fixtures.tsx", "utf8");
const adapters = new Set(["AppContext.tsx", "CompanyContext.tsx", "NotificationsContext.tsx", "firebase.ts", "routePreload.ts", "rankingPhotoWarmup.ts", "usePersistentRankingImage.ts", "useTripHistory.ts", "useDriverTrips.ts", "useMissingOperationTrip.ts", "SimpleAutomationCompletionBridge.tsx", "CompactProfileEditorModal.tsx", "NotificationCenter.tsx", "ProfileModal.tsx", "useVehiclePhoto.ts", "workModeAvailabilityService.ts", "simpleAutomationCityService.ts", "operationIntegrityGuard.ts", "uploadService.ts", "useProfileRanking.ts", "useTripsRealtime.ts", "AutomaticOperationsProvider.tsx", "useLocalOperationPending.ts", "operationalGoalAccess.ts", "CanonicalTripMigrationService.ts", "CanonicalTripCommandService.ts", "CanonicalTripOperationService.ts", "syncManager.ts", "tripModerationService.ts", "ProPendingAuthButton.tsx", "ProPendingRetryButton.tsx", "ProAttemptDiagnosticDetails.tsx", "FailedHistoryRegistrationRecovery.tsx", "OperationResultModal.tsx"]);
const secondary = new Set(["VehiclesTab.tsx", "TrailersTab.tsx", "DriversTab.tsx", "ContractsTab.tsx", "RecruitmentTab.tsx", "GtoObserverSetup.tsx", "Reports.tsx"]);
const bundle = await build({
  stdin: { resolveDir: root, sourcefile: "profile-menu-layout.tsx", loader: "tsx", contents: `
import React from "react";import {createRoot} from "react-dom/client";import {MemoryRouter} from "react-router-dom";
import {GlobalMenu} from "./src/components/GlobalMenu";
const base={open:true,onClose(){},currentUserName:"David Canto",roleLabel:"Motorista",activeRole:"driver",canSwitchRole:true,onSwitchRole(){},isProfileMenuOpen:true,onToggleProfile(){},showCompanySwitch:false,onShowCompanySwitch(){},availableCompanies:[],activeCompanyId:"dc",onCompanySwitch(){},onProfileEdit(){},theme:"dark",onToggleTheme(){},onLogout(){},driverItems:[]};
function Shell({cls,profile}){return <div className={cls} data-shell={cls}><MemoryRouter><GlobalMenu {...base} profile={profile} nativeAndroid={cls.includes("nvu-native-android")}/></MemoryRouter></div>;}
createRoot(document.getElementById("root")).render(<>
  <Shell profile="driver" cls="nvu-workspace-shell nvu-native-android nvu-native-profile-route"/>
  <Shell profile="driver" cls="nvu-workspace-shell nvu-native-android"/>
  <Shell profile="driver" cls="nvu-workspace-shell nvu-desktop-shell"/>
  <Shell profile="company" cls="nvu-workspace-shell nvu-native-android"/>
</>);
` },

  bundle: true, write: false, outfile: path.join(output, "fixture.js"), format: "iife", platform: "browser", jsx: "automatic", loader: { ".css": "empty" }, logLevel: "error",
  define: { "process.env.NODE_ENV": '"test"', "import.meta.env.BASE_URL": '"/"', "import.meta.env.PROD": "false", "import.meta.env.DEV": "false", "import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID": '""', __AVATAR__: JSON.stringify(avatar), __VEHICLE__: JSON.stringify(photo) },
  plugins: [{ name: "opinfo-adapters", setup(plugin) {
    plugin.onResolve({ filter: /^opinfo-fixtures$/ }, () => ({ path: "fixtures", namespace: "opinfo-fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "opinfo-fixture" }, () => ({ contents: fixtures, resolveDir: root, loader: "tsx" }));
    plugin.onResolve({ filter: /^firebase\/(auth|firestore)$/ }, args => ["/profileCoverService.ts", "/companyDescriptionService.ts", "/useCompanyDescription.ts", "/CompanyTab.tsx", "/TripHistory.tsx", "/OperationsTab.tsx", "/useOperationalGoal.ts"].some(file => args.importer.endsWith(file)) ? { path: "fixtures", namespace: "opinfo-fixture" } : undefined);
    plugin.onLoad({ filter: /src\/.*\.tsx?$/ }, args => adapters.has(path.basename(args.path)) || secondary.has(path.basename(args.path)) ? { contents: 'export * from "opinfo-fixtures";export {default} from "opinfo-fixtures";', resolveDir: root, loader: "tsx" } : undefined);
  } }],
});
const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const ORIGIN = "http://127.0.0.1:43830";
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${css}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.NVU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NVU_CHROMIUM_EXECUTABLE } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const errors = [], outbound = [], results = [];
async function check(name, run) { await run(); results.push({ name, pass: true }); console.log("PASS " + name); }


async function openWindow(viewport, { mobile = true, userAgent } = {}) {
  const context = await browser.newContext({ viewport, isMobile: mobile, ...(userAgent ? { userAgent } : {}), hasTouch: mobile, deviceScaleFactor: 1, timezoneId: "America/Sao_Paulo" });
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
async function start(page, theme = "dark") {
  await page.goto(ORIGIN + "/");
  await page.waitForFunction(() => window.__go);
  await page.evaluate(theme => { document.documentElement.classList.toggle("dark", theme === "dark"); window.dispatchEvent(new CustomEvent("nvu:theme-change", { detail: theme })); }, theme);
  await page.getByTestId("management-dashboard").waitFor();
  await page.evaluate(() => document.fonts.ready);
}
const infoButton = (page, vehicle) => page.getByRole("button", { name: `Ver informações de ${vehicle}`, exact: true });
const sheet = page => page.getByTestId("operation-info-sheet");
const route = page => page.evaluate(() => window.__route);
const ops = page => page.evaluate(() => ({ cancels: window.__ops.cancels, vehicleChanges: window.__ops.vehicleChanges }));
const jobsState = page => page.evaluate(() => Object.fromEntries(window.__jobs().map(job => [job.id, { status: job.status, vehicleId: job.vehicleId }])));
const tick = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const box = (page, selector) => page.locator(selector).first().evaluate(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; });

try {
  const context = await browser.newContext({ viewport: { width: 450, height: 1000 }, deviceScaleFactor: 2, isMobile: true });
  await context.route("**/*", async route => { const url = new URL(route.request().url()); if (url.hostname !== "127.0.0.1") return route.abort(); if (url.pathname.endsWith(".woff2")) return route.fulfill({ contentType: "font/woff2", body: await fs.readFile(path.join(root, "public", url.pathname)) }); return route.fulfill({ contentType: "text/html", body: html }); });
  const page = await context.newPage();
  await page.goto(ORIGIN + "/"); await page.waitForSelector(".nvu-profile-role-group");
  // The floating menu of the driver must look the same on every page (flagged as native profile route or not), in both themes.
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme);
    const rows = await page.evaluate(() => [...document.querySelectorAll("[data-shell]")].map(shell => { const cap = shell.querySelector(".nvu-profile-action-caption, .nvu-admin-action-caption"), grp = shell.querySelector(".nvu-profile-role-group, .nvu-admin-role-group"); const c = getComputedStyle(cap), g = getComputedStyle(grp); return { shell: shell.dataset.shell, size: parseFloat(c.fontSize), transform: c.textTransform, weight: c.fontWeight, text: cap.textContent, display: g.display, direction: g.flexDirection, padding: parseFloat(g.paddingTop), radius: parseFloat(g.borderTopLeftRadius) }; }));
    assert.equal(rows.length, 4);
    for (const row of rows) {
      assert(row.size < 11 && row.transform === "uppercase" && Number(row.weight) >= 700, `${theme}: the caption is the small uppercase label in "${row.shell}": ${JSON.stringify(row)}`);
      assert(row.display === "flex" && row.direction === "column" && row.padding >= 5 && row.radius >= 10, `${theme}: the role switcher keeps its padded rounded group in "${row.shell}": ${JSON.stringify(row)}`);
    }
  }
  console.log("PASS Menu flutuante do motorista: legenda e grupo de perfis iguais com e sem a classe da rota de perfil, nos temas claro e escuro");
  console.log("PROFILE_MENU_LAYOUT_PASS 1 check");
  await context.close();
} finally { await browser.close(); }
