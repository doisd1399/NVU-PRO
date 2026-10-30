import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Real AdminLayout -> Fleet -> OperationsTab (management center), the "Informações da operação" sheet and its four flows
// (profile of the driver, trips of the operation, change of vehicle, cancellation) with the built production CSS. Only the
// session, remote and ranking adapters are fixtures (scripts/fixtures/operation-info-fixtures.tsx); the commands record
// what they were asked to do. Writes always go to those fakes: nothing here touches a real Firebase project.
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
  stdin: { resolveDir: root, sourcefile: "operation-info-ui.tsx", loader: "tsx", contents: `
import React from "react";import {createRoot} from "react-dom/client";import {MemoryRouter,Routes,Route,useLocation,useNavigate} from "react-router-dom";
import AdminLayout from "./src/layouts/AdminLayout";import Fleet from "./src/pages/admin/Fleet";import DriverProfileReference from "./src/pages/admin/DriverProfileReference";
import {WorkspaceScrollMemory} from "./src/components/common/WorkspaceScrollMemory";import {startProfileCoverSync} from "./src/services/profileCoverService";import {handleSafeAppBack} from "./src/lib/safeBackNavigation";window.__back=()=>handleSafeAppBack({canGoBack:true});
startProfileCoverSync();
function Probe(){const location=useLocation(),navigate=useNavigate();window.__route={pathname:location.pathname,state:location.state};window.__go=navigate;return null;}
createRoot(document.getElementById("root")).render(<MemoryRouter initialEntries={[{pathname:"/admin/fleet",state:{activeTab:"operations"}}]}><Probe/><WorkspaceScrollMemory scope="qa:company"/><Routes><Route path="/admin" element={<AdminLayout/>}><Route path="fleet" element={<Fleet/>}/><Route path="driver/:id/perfil" element={<DriverProfileReference/>}/><Route path="*" element={<div>Destino</div>}/></Route><Route path="*" element={<div>Outra página</div>}/></Routes></MemoryRouter>);
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
  await check("Information sheet: bottom panel with the real data of each operation (same operation name, different jobs)", async () => {
    const { context, page } = await openWindow({ width: 390, height: 780 });
    await start(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await infoButton(page, "Scania G").click();
    await sheet(page).waitFor();
    const text = await sheet(page).innerText();
    assert.match(text, /Ana Souza/); assert.match(text, /DC Transportes · GTO/); assert.match(text, /BLS - 150/); assert.match(text, /Em andamento/);
    assert.match(text, /Tempo restante\s+\d+d · \d+h · \d+min/); assert.match(text, /40%/); assert.match(text, /4 de 10 entregas/); assert.match(text, /6 restantes/);
    assert.deepEqual(await page.locator(".nvu-op-sheet-action").evaluateAll(nodes => nodes.map(node => node.textContent.trim())), ["Visualizar perfil", "Viagens da operação", "Trocar veículo", "Cancelar trabalho"]);
    assert.equal(await page.getByRole("progressbar", { name: "Progresso da operação" }).getAttribute("aria-valuenow"), "40");
    const geometry = await page.evaluate(() => {
      const dialog = document.querySelector(".nvu-central-sheet"), r = dialog.getBoundingClientRect(), s = getComputedStyle(dialog), photo = document.querySelector(".nvu-op-sheet-photo").getBoundingClientRect();
      const last = [...document.querySelectorAll(".nvu-op-sheet-action")].at(-1).getBoundingClientRect();
      return { bottom: r.bottom, innerHeight, top: r.top, radius: s.borderTopLeftRadius, background: s.backgroundColor, photo: [photo.width, photo.height], lastBottom: last.bottom, bodyOverflow: document.body.style.overflow, overlay: getComputedStyle(document.querySelector(".nvu-central-overlay")).backgroundColor };
    });
    assert(Math.abs(geometry.bottom - geometry.innerHeight) <= 1 && parseFloat(geometry.radius) >= 20, "Anchored to the bottom with rounded top corners: " + JSON.stringify(geometry));
    assert(geometry.lastBottom < geometry.bottom - 14 && geometry.top >= 0, "Room under the last button and every control reachable: " + JSON.stringify(geometry));
    assert(Math.abs(geometry.photo[0] - geometry.photo[1]) <= 1, "Square photo: " + JSON.stringify(geometry));
    assert.equal(geometry.bodyOverflow, "hidden", "The page behind cannot scroll");
    assert.equal(geometry.background, "rgb(26, 37, 45)");
    const colors = await page.evaluate(() => { const c = selector => getComputedStyle(document.querySelector(selector)); return { action: c(".nvu-op-sheet-action").backgroundColor, arrow: c(".nvu-op-sheet-arrow").backgroundColor, text: c(".nvu-op-sheet-driver strong").color, muted: c(".nvu-op-sheet-driver span").color, danger: c('.nvu-op-sheet-action[data-danger="true"]').color, dangerArrow: c('.nvu-op-sheet-action[data-danger="true"] .nvu-op-sheet-arrow').color, status: c(".nvu-op-sheet-status").color }; });
    assert.deepEqual(colors, { action: "rgb(35, 53, 62)", arrow: "rgb(64, 85, 98)", text: "rgb(243, 247, 249)", muted: "rgb(179, 192, 203)", danger: "rgb(255, 136, 0)", dangerArrow: "rgb(255, 136, 0)", status: "rgb(36, 207, 222)" });
    await page.screenshot({ path: path.join(output, "sheet-portrait.png") });
    // the other job has the same operation name: its own driver, progress and overdue state
    await page.keyboard.press("Escape"); await sheet(page).waitFor({ state: "detached" });
    await infoButton(page, "Iveco S Way").click(); await sheet(page).waitFor();
    const other = await sheet(page).innerText();
    assert.match(other, /Bruno Lima/); assert.match(other, /3 de 12 entregas/); assert.match(other, /25%/); assert.match(other, /Atrasado/); assert.match(other, /Prazo vencido/);
    assert.doesNotMatch(other, /Ana Souza/);
    assert.equal(await page.getByRole("heading", { name: "Informações da operação" }).count(), 1);
    await context.close();
  });

  await check("Close paths: button, scrim, Escape and the Android Back button; the scroll of the page is restored", async () => {
    const { context, page } = await openWindow({ width: 390, height: 780 });
    await start(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    for (const how of ["button", "scrim", "escape", "back"]) {
      await infoButton(page, "Scania G").click(); await sheet(page).waitFor();
      if (how === "button") await page.getByRole("button", { name: "Fechar informações da operação" }).click();
      if (how === "scrim") await page.mouse.click(195, 40);
      if (how === "escape") await page.keyboard.press("Escape");
      if (how === "back") await page.evaluate(() => window.__back());
      await sheet(page).waitFor({ state: "detached" });
      assert.notEqual(await page.evaluate(() => document.body.style.overflow), "hidden", how);
    }
    await context.close();
  });

  await check("Visualizar perfil: the page of the driver of the operation (not the signed-in user), Resumo first, then Estatísticas; Back restores the center", async () => {
    const { context, page } = await openWindow({ width: 390, height: 844 });
    await start(page);
    await infoButton(page, "Iveco S Way").click(); await sheet(page).waitFor();
    await page.getByRole("button", { name: "Visualizar perfil" }).click();
    await page.waitForFunction(() => window.__route.pathname === "/admin/driver/bruno/perfil");
    const state = (await route(page)).state;
    assert.equal(state.companyId, "dc"); assert.equal(state.returnUrl, "/admin/fleet"); assert.equal(state.returnState.activeTab, "operations");
    await page.locator(".nvu-driver-reference").waitFor();
    assert.equal(await page.locator(".nvu-cover-copy h2").innerText(), "Bruno Lima");
    assert.equal(await page.getByRole("button", { name: "Resumo", exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal(await page.getByRole("button", { name: "Estatísticas", exact: true }).getAttribute("aria-pressed"), "false");
    assert.equal(await page.locator(".nvu-central-sheet").count(), 0, "The sheet is closed on the profile");
    await page.getByRole("button", { name: "Estatísticas", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Estatísticas", exact: true }).getAttribute("aria-pressed"), "true");
    await page.screenshot({ path: path.join(output, "profile-statistics.png") });
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.getByRole("button", { name: "Voltar", exact: true }).click();
    await page.waitForFunction(() => window.__route.pathname === "/admin/fleet");
    assert.equal((await route(page)).state.activeTab, "operations");
    await page.getByTestId("management-dashboard").waitFor();
    // another driver: Ana, in the same company
    await infoButton(page, "Scania G").click(); await sheet(page).waitFor();
    await page.getByRole("button", { name: "Visualizar perfil" }).click();
    await page.waitForFunction(() => window.__route.pathname === "/admin/driver/ana/perfil");
    assert.equal(await page.locator(".nvu-cover-copy h2").innerText(), "Ana Souza");
    await context.close();
  });

  await check("Cards de operações: container único com cabeçalho, cartões individuais sem divisórias, card de métricas e uma linha de tempo restante", async () => {
    for (const [theme, viewport, file] of [["dark", { width: 412, height: 915 }, "cards-dark-412.png"], ["light", { width: 390, height: 844 }, "cards-light-390.png"], ["dark", { width: 360, height: 740 }, "cards-dark-360.png"]]) {
      const { context, page } = await openWindow(viewport);
      await start(page, theme);
      await page.locator(".nvu-central-jobs").scrollIntoViewIfNeeded();
      const m = await page.evaluate(() => {
        const rect = n => { const r = n.getBoundingClientRect(); return { l: r.left, r2: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
        const jobs = document.querySelector(".nvu-central-jobs"), head = jobs.querySelector(".nvu-central-jobs-header"), cards = [...jobs.querySelectorAll(".nvu-central-operation")];
        const cs = n => getComputedStyle(n);
        const lines = n => [...[n, ...n.querySelectorAll("*")]].filter(x => ["Top", "Right", "Bottom", "Left"].some(side => parseFloat(cs(x)["border" + side + "Width"]) > 0 && cs(x)["border" + side + "Style"] !== "none" && x.tagName !== "BUTTON" && !x.classList.contains("nvu-central-job-status") && !x.closest("button")));
        return {
          headInside: jobs.contains(head) && jobs.contains(head.querySelector("h2")) && jobs.contains(head.querySelector(".nvu-central-count")) && jobs.contains(head.querySelector(".nvu-central-subtitle")) && jobs.contains(head.querySelector("button[aria-expanded]")),
          count: head.querySelector(".nvu-central-count").textContent, headText: head.innerText.replace(/\s+/g, " "),
          cards: cards.map(card => {
            const stats = card.querySelector(".nvu-central-operation-stats"), timing = card.querySelector(".nvu-central-operation-timing"), metrics = card.querySelector(".nvu-central-operation-metrics"), r = rect(card), tr = rect(timing), sr = rect(stats);
            const pad = cs(card);
            const lh = parseFloat(cs(timing.querySelector("strong")).lineHeight) || 20;
            return { bg: cs(card).backgroundColor, radius: cs(card).borderTopLeftRadius, pad: [pad.paddingTop, pad.paddingRight, pad.paddingBottom, pad.paddingLeft], lines: lines(card).map(x => x.className), statsBg: cs(stats).backgroundColor, statsHasProgress: !!stats.querySelector("[role=progressbar]"), metricsCols: getComputedStyle(metrics).gridTemplateColumns.split(" ").length, text: card.innerText.replace(/\s+/g, " "), timingH: tr.h, timingLines: Math.round(tr.h / lh), timingCentered: Math.abs((tr.l + tr.r2) / 2 - (r.l + r.r2) / 2) < 3, timingBelowStats: tr.t >= sr.b - 1, timingColors: [cs(timing.querySelector("span")).color, cs(timing.querySelector("strong")).color], cardBottom: r.b, cardTop: r.t, overflow: card.scrollWidth > card.clientWidth + 1 };
          }), jobsBg: cs(jobs).backgroundColor, scrollW: document.documentElement.scrollWidth, width: innerWidth,
        };
      });
      const label = theme + " " + viewport.width + " " + JSON.stringify(m).slice(0, 900);
      assert(m.headInside, "Title, counter, subtitle and collapse button live in the container of the operations: " + label);
      assert.match(m.headText, /Trabalhos ativos\s*\d+\s*Operações em andamento/);
      assert(m.cards.length >= 2 && m.scrollW <= m.width, "Cards render without page overflow: " + label);
      for (const [i, card] of m.cards.entries()) {
        assert.notEqual(card.bg, m.jobsBg, "Each operation has a background of its own");
        assert(parseFloat(card.radius) >= 14, "Rounded card: " + card.radius);
        assert(card.pad.every(v => parseFloat(v) >= 14 && parseFloat(v) <= 20), "Inner breathing room of 16px: " + card.pad);
        assert.deepEqual(card.lines, [], "No divider lines inside card " + i);
        assert(card.statsHasProgress && card.metricsCols === 3 && card.statsBg !== card.bg, "Metrics card with three columns and the progress bar inside: " + label);
        assert.doesNotMatch(card.text, /Prazo limite|\d{2}\/\d{2}\/\d{4}/, "No deadline label/date in the list");
        assert.match(card.text, /Entregas/); assert.match(card.text, /Restantes/); assert.match(card.text, /Concluído/);
        assert.match(card.text, /Tempo restante:\s*(\d+d · \d+h · \d+min|Prazo vencido|Não definido)$/, "Single remaining time line: " + card.text);
        assert(card.timingLines === 1 && card.timingCentered && card.timingBelowStats, "One centered line below the metrics: " + JSON.stringify(card));
        if (i > 0) assert(card.cardTop - m.cards[i - 1].cardBottom >= 8, "Space between the cards");
      }
      const overdue = m.cards.find(card => /Prazo vencido/.test(card.text));
      assert(overdue, "An overdue operation shows 'Tempo restante: Prazo vencido'");
      assert.equal(overdue.timingColors[1], theme === "dark" ? "rgb(255, 136, 0)" : "rgb(184, 102, 13)", "Overdue/remaining value in the warning orange");
      await page.evaluate(() => window.scrollTo(0, document.querySelector(".nvu-central-jobs").getBoundingClientRect().top + scrollY - 56));
      await page.screenshot({ path: path.join(output, file) });
      await context.close();
    }
    for (const [viewport, file, mobile] of [[{ width: 844, height: 390 }, "cards-landscape-phone-844.png", true], [{ width: 1280, height: 800 }, "cards-landscape-desktop-1280.png", false], [{ width: 820, height: 1180 }, "cards-tablet-portrait.png", true]]) {
      const { context, page } = await openWindow(viewport, { mobile });
      await start(page);
      const cards = await page.locator(".nvu-central-operation").evaluateAll(nodes => nodes.map(node => { const text = node.innerText.replace(/\s+/g, " "); return { overflow: node.scrollWidth > node.clientWidth + 1, deadline: /Prazo limite/.test(text), time: /Tempo restante:/.test(text), lines: node.querySelector(".nvu-central-operation-timing").getBoundingClientRect().height }; }));
      assert(cards.length >= 2 && cards.every(card => !card.overflow && !card.deadline && card.time && card.lines < 30), file + " " + JSON.stringify(cards));
      await page.screenshot({ path: path.join(output, file) });
      await context.close();
    }
  });

  await check("Operação expandida e minimizada: mesmos componentes e medidas; só a foto e a seta mudam", async () => {
    const measure = (page, index) => page.evaluate(index => {
      const card = document.querySelectorAll(".nvu-central-operation")[index], cs = n => getComputedStyle(n), rect = n => { const r = n.getBoundingClientRect(); return [Math.round(r.width * 100) / 100, Math.round(r.height * 100) / 100]; };
      const rel = n => { const r = n.getBoundingClientRect(), c = card.getBoundingClientRect(); return [Math.round((r.left - c.left) * 100) / 100, Math.round((r.right - c.right) * 100) / 100]; };
      const typo = n => { const c = cs(n); return [c.fontFamily, c.fontSize, c.fontWeight, c.lineHeight, c.letterSpacing, c.color, c.textTransform].join("|"); };
      const box = n => { const c = cs(n); return [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft, c.borderTopWidth, c.borderTopColor, c.backgroundColor, c.borderTopLeftRadius, c.gap, c.transform === "none" ? "" : c.transform].join("|"); };
      const q = selector => card.querySelector(selector), all = selector => [...card.querySelectorAll(selector)];
      const stats = q(".nvu-central-operation-stats"), status = q(".nvu-central-job-status"), progress = q(".nvu-central-progress"), fill = progress.firstElementChild, timing = q(".nvu-central-operation-timing");
      return {
        stats: rect(stats), statsRel: rel(stats), statsBox: box(stats), status: rect(status), statusBox: box(status), statusTypo: typo(status), progress: rect(progress), progressBox: box(progress), fill: rect(fill), fillBg: cs(fill).backgroundColor,
        metrics: rect(q(".nvu-central-operation-metrics")), metricCells: all(".nvu-central-operation-metrics > div").map(n => [rect(n), rel(n)]),
        metricType: all(".nvu-central-operation-metrics strong, .nvu-central-operation-metrics span").map(typo), metricText: all(".nvu-central-operation-metrics > div").map(n => n.innerText.replace(/\s+/g, " ")),
        timing: rect(timing), timingRel: rel(timing), timingType: [...timing.children].map(typo), timingText: timing.innerText,
        driverRow: rect(q(".nvu-central-driver-row")), avatar: rect(q(".nvu-central-avatar")), driverType: typo(q(".nvu-central-driver strong")), vehicleLine: rect(q(".nvu-central-vehicle-line")), vehicleType: [typo(q(".nvu-central-vehicle-name strong")), q(".nvu-central-vehicle-name small") ? typo(q(".nvu-central-vehicle-name small")) : ""],
        info: rect(q(".nvu-central-operation-info")), pill: rect(q(".nvu-central-operation-name")), pillType: typo(q(".nvu-central-operation-name")), toggle: rect(q(".nvu-central-operation-toggle")), arrow: cs(q(".nvu-central-operation-toggle svg")).transform,
        order: [...card.children].map(n => n.className.split(" ")[0]), card: rect(card), cardBox: box(card), photo: q(".nvu-central-vehicle-photo") ? rect(q(".nvu-central-vehicle-photo")) : null, photoPlaceholder: /Foto do veículo indisponível|Carregando foto/.test(card.innerText), expanded: card.dataset.expanded, pressed: q(".nvu-central-operation-toggle").getAttribute("aria-expanded"), label: q(".nvu-central-operation-toggle").getAttribute("aria-label"), overflow: card.scrollWidth > card.clientWidth + 1 || [...card.querySelectorAll("*")].some(n => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflow === "visible" && n.children.length === 0 && n.clientWidth > 0 && n.tagName !== "I" && n.tagName !== "svg"),
      };
    }, index);
    const same = (a, b, keys, label) => { for (const key of keys) assert.deepEqual(a[key], b[key], `${label}: ${key} must be identical in both states: ${JSON.stringify(a[key])} vs ${JSON.stringify(b[key])}`); };
    const shared = ["stats", "statsRel", "statsBox", "status", "statusBox", "statusTypo", "progress", "progressBox", "fill", "fillBg", "metrics", "metricCells", "metricType", "metricText", "timing", "timingRel", "timingType", "timingText", "driverRow", "avatar", "driverType", "vehicleLine", "vehicleType", "info", "pill", "pillType", "toggle", "cardBox", "card0"].filter(key => key !== "card0");
    const scenarios = [
      [{ width: 412, height: 915 }, true, "cards-expandido-412.png", "cards-minimizado-412.png"], [{ width: 360, height: 740 }, true], [{ width: 320, height: 640 }, true],
      [{ width: 844, height: 390 }, true, "cards-expandido-844.png", "cards-minimizado-844.png"], [{ width: 820, height: 1180 }, true], [{ width: 1280, height: 800 }, false, "cards-expandido-1280.png", "cards-minimizado-1280.png"], [{ width: 1024, height: 768 }, false],
    ];
    for (const [viewport, mobile, shotOpen, shotClosed] of scenarios) {
      const { context, page } = await openWindow(viewport, { mobile });
      await start(page);
      const toggle = index => page.locator(".nvu-central-operation-toggle").nth(index);
      await page.locator(".nvu-central-operation").first().scrollIntoViewIfNeeded();
      const label = JSON.stringify(viewport);
      const listed = await measure(page, 0);
      assert.equal(listed.expanded, "false", "The list opens minimized: " + label); assert.equal(listed.photo, null, "No photo area when the list opens: " + label); assert.equal(listed.photoPlaceholder, false);
      assert.equal(await page.locator(".nvu-central-operation[data-expanded=true]").count(), 0, "No operation opens expanded: " + label);
      await toggle(0).click(); await toggle(1).click(); await tick(page);
      const open = await measure(page, 0), other = await measure(page, 1);
      same(listed, open, shared, label + " list -> expanded");
      assert.equal(open.expanded, "true"); assert(open.photo && open.photo[0] > 0, "Expanded shows the photo: " + label);
      assert.equal(open.pressed, "true"); assert.match(open.label, /^Minimizar operação de /);
      assert.deepEqual(open.order, ["nvu-central-driver-row", "nvu-central-vehicle-photo", "nvu-central-vehicle-line", "nvu-central-operation-stats", "nvu-central-operation-timing"]);
      assert(!open.overflow, "No clipped content: " + label);
      if (shotOpen) { await page.evaluate(() => window.scrollTo(0, document.querySelector(".nvu-central-jobs").getBoundingClientRect().top + scrollY - 56)); await page.screenshot({ path: path.join(output, shotOpen) }); }
      await toggle(0).click(); await tick(page);
      const closed = await measure(page, 0), otherAfter = await measure(page, 1);
      assert.equal(closed.expanded, "false"); assert.equal(closed.pressed, "false"); assert.match(closed.label, /^Expandir operação de /);
      assert.equal(closed.photo, null, "Minimized: the photo area does not exist: " + label); assert.equal(closed.photoPlaceholder, false, "Minimized: no placeholder either: " + label);
      assert.deepEqual(closed.order, ["nvu-central-driver-row", "nvu-central-vehicle-line", "nvu-central-operation-stats", "nvu-central-operation-timing"]);
      same(open, closed, shared, label);
      assert.notEqual(open.arrow, closed.arrow, "The arrow changes direction");
      assert(Math.abs(open.card[1] - closed.card[1] - open.photo[1] - 9) <= 0.6, `The card height follows the photo: ${open.card[1]} - ${closed.card[1]} vs photo ${open.photo[1]} ${label}`);
      assert.deepEqual(otherAfter.order, other.order); assert.equal(otherAfter.expanded, "true", "Each operation toggles independently: " + label); same(other, otherAfter, ["card", "stats", "status"], "neighbour");
      if (shotClosed) { await page.evaluate(() => window.scrollTo(0, document.querySelector(".nvu-central-jobs").getBoundingClientRect().top + scrollY - 56)); await page.screenshot({ path: path.join(output, shotClosed) }); }
      for (let i = 0; i < 12; i++) { await toggle(0).click(); await toggle(1).click(); }
      await tick(page);
      const again = await measure(page, 0), againOther = await measure(page, 1);
      assert.equal(again.expanded, "false"); assert.equal(againOther.expanded, "true", "An even number of toggles restores the neighbour");
      same(open, again, shared, label + " after repeated toggles"); same(other, againOther, shared, label + " neighbour after repeated toggles");
      await toggle(0).click(); await tick(page);
      same(open, await measure(page, 0), [...shared, "card", "photo"], label + " back to expanded");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "No horizontal overflow: " + label);
      await context.close();
    }
    // long names and a vehicle without photo: same equality, nothing clipped or overlapping
    for (const [viewport, mobile] of [[{ width: 360, height: 740 }, true], [{ width: 1280, height: 800 }, false]]) {
      const { context, page } = await openWindow(viewport, { mobile });
      await start(page);
      await page.evaluate(() => { window.__noPhoto.push("iveco"); window.__mutate(o => { o.contracts.find(c => c.id === "bls2").name = "Operação de transporte internacional de grãos – contrato BLS 150 especial"; o.vehicles.find(v => v.id === "iveco").name = "Iveco S-Way 570 Highway Edition com nome muito longo"; o.users = o.users.map(u => u.id === "bruno" ? { ...u, name: "Bruno Henrique de Albuquerque e Silva Nascimento Lima" } : u); }); });
      await tick(page); await tick(page);
      const label = "long " + JSON.stringify(viewport);
      const index = await page.locator(".nvu-central-operation").evaluateAll(nodes => nodes.findIndex(n => /Iveco/.test(n.innerText)));
      assert(index >= 0, "The long-name operation is listed");
      assert.equal((await measure(page, index)).photo, null, "Long-name operation also opens as a list: " + label);
      await page.locator(".nvu-central-operation-toggle").nth(index).click(); await tick(page);
      const open = await measure(page, index);
      assert(open.photo && open.photoPlaceholder, "Unavailable photo still shows its placeholder when expanded: " + label);
      assert(!open.overflow, "Long names stay inside the card: " + label);
      const geometry = await page.evaluate(index => { const card = document.querySelectorAll(".nvu-central-operation")[index], c = card.getBoundingClientRect(), r = n => n.getBoundingClientRect(), row = card.querySelector(".nvu-central-driver-row"), line = card.querySelector(".nvu-central-vehicle-line"); const parts = [...line.children].map(r); return { inside: [...card.querySelectorAll("*")].every(n => { const b = r(n); return b.width === 0 || (b.left >= c.left - 1 && b.right <= c.right + 1); }), lineOverlap: parts.some((a, i) => parts.some((b, j) => j > i && a.left < b.right - 0.5 && b.left < a.right - 0.5)), rowOverlap: [...row.children].map(r).some((a, i, all) => all.some((b, j) => j > i && a.left < b.right - 0.5 && b.left < a.right - 0.5)) }; }, index);
      assert.deepEqual(geometry, { inside: true, lineOverlap: false, rowOverlap: false }, "Long names do not overlap or spill: " + label);
      await page.locator(".nvu-central-operation-toggle").nth(index).click(); await tick(page);
      const closed = await measure(page, index);
      assert.equal(closed.photo, null); assert.equal(closed.photoPlaceholder, false, "Minimized hides the placeholder as well: " + label);
      same(open, closed, shared, label);
      await context.close();
    }
  });

  await check("Perfil aberto com a lista rolada: topo da página, sem rolagem herdada nem bloqueios residuais; Voltar restaura a lista", async () => {
    const androidAgent = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
    for (const viewport of [{ width: 390, height: 640 }, { width: 844, height: 390 }, { width: 1280, height: 720 }, { width: 412, height: 700, android: true }, { width: 915, height: 412, android: true }]) {
      const { context, page } = await openWindow(viewport, { mobile: viewport.width < 1000, userAgent: viewport.android ? androidAgent : undefined });
      await start(page);
      const target = page.locator(".nvu-central-operation").last();
      await target.scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => window.scrollY);
      if (viewport.width < 1000) assert(before > 120, "The list was scrolled before opening: " + before + " " + JSON.stringify(viewport)); // the desktop center fits the window and cannot scroll
      await infoButton(page, "Iveco S Way").click(); await sheet(page).waitFor();
      await page.getByRole("button", { name: "Visualizar perfil" }).click();
      await page.locator(".nvu-driver-reference").waitFor();
      await tick(page); await tick(page);
      const m = await page.evaluate(() => {
        const cover = document.querySelector(".nvu-cover-hero")?.getBoundingClientRect(), header = document.querySelector("header")?.getBoundingClientRect();
        return { scrollY: window.scrollY, coverTop: cover?.top, headerBottom: header?.bottom, bodyOverflow: document.body.style.overflow, htmlOverflow: document.documentElement.style.overflow, backdrops: document.querySelectorAll(".nvu-central-backdrop,.nvu-central-scrim,[data-nvu-modal-backdrop]").length, dialogs: document.querySelectorAll("[role=dialog]").length, name: document.querySelector(".nvu-cover-copy h2")?.getBoundingClientRect().top };
      });
      const label = JSON.stringify(viewport) + " " + JSON.stringify(m);
      assert.equal(m.scrollY, 0, "Profile opens at the top: " + label);
      assert(m.coverTop >= (m.headerBottom || 0) - 1, "Cover below the header: " + label);
      assert(m.name > 0 && m.name < viewport.height, "Name visible: " + label);
      assert.notEqual(m.bodyOverflow, "hidden", "No scroll lock left behind: " + label);
      assert.equal(m.dialogs, 0, "No dialog left: " + label);
      await page.evaluate(() => window.scrollTo(0, 300));
      assert((await page.evaluate(() => window.scrollY)) > 0, "The profile scrolls: " + label);
      await page.getByRole("button", { name: "Voltar", exact: true }).click();
      await page.waitForFunction(() => window.__route.pathname === "/admin/fleet");
      await page.getByTestId("management-dashboard").waitFor(); await tick(page); await tick(page);
      const back = await page.evaluate(() => window.scrollY);
      assert(Math.abs(back - before) <= 2, `List position restored (${before} -> ${back}): ` + label);
      await context.close();
    }
  });

  await check("Viagens da operação: only the trips of the selected job, newest first, fixed header and its own scroll", async () => {
    const { context, page } = await openWindow({ width: 390, height: 600 });
    await start(page);
    for (const [vehicle, count, driver] of [["Scania G", 4, "Ana Souza"], ["Iveco S Way", 3, "Bruno Lima"]]) {
      await infoButton(page, vehicle).click(); await sheet(page).waitFor();
      await page.getByRole("button", { name: "Viagens da operação" }).click();
      await page.getByTestId("operation-trips-sheet").waitFor();
      await page.locator(".nvu-op-trips-list .nvu-trip-card").first().waitFor();
      assert.equal((await page.getByTestId("operation-trips-count").innerText()).trim(), `${count} viagens`);
      assert.equal(await page.locator(".nvu-op-trips-list .nvu-trip-card").count(), count, vehicle);
      const panel = await page.getByTestId("operation-trips-sheet").innerText();
      assert.match(panel, new RegExp(driver)); assert.doesNotMatch(panel, /Outra operação/);
      // newest first: the card values increase with the trip number, which follows the date
      const values = await page.locator(".nvu-op-trips-list .nvu-trip-card").evaluateAll(nodes => nodes.map(node => Number((node.innerText.match(/R\$\s*([\d.]+),/) || [])[1]?.replaceAll(".", "") || 0)));
      assert.deepEqual([...values].sort((a, b) => b - a), values, "Newest first: " + values);
      const header = await box(page, ".nvu-op-trips-summary");
      const scroller = await page.locator(".nvu-op-trips-list").evaluate(node => { node.scrollTop = 9999; return { overflow: getComputedStyle(node).overflowY, client: node.clientHeight, scroll: node.scrollHeight, top: node.scrollTop }; });
      assert.equal(scroller.overflow, "auto");
      assert.deepEqual(await box(page, ".nvu-op-trips-summary"), header, "The header stays fixed while the list scrolls");
      if (count === 4) { assert(scroller.scroll > scroller.client && scroller.top > 0, "The list scrolls inside the panel: " + JSON.stringify(scroller)); await page.screenshot({ path: path.join(output, "trips-sheet.png") }); }
      await page.getByRole("button", { name: "Fechar viagens da operação" }).click();
      await page.getByTestId("operation-trips-sheet").waitFor({ state: "detached" });
      await sheet(page).waitFor();
      await page.keyboard.press("Escape"); await sheet(page).waitFor({ state: "detached" });
    }
    // the job of the other company never shows here and has no entry in the center
    assert.equal(await page.locator(".nvu-central-operation").count(), 2);
    await context.close();
  });

  await check("Trocar veículo: catalog of the company with folders, usage and the current vehicle; one selection; discard on close; validated save", async () => {
    const { context, page } = await openWindow({ width: 390, height: 780 });
    await start(page);
    await infoButton(page, "Scania G").click(); await sheet(page).waitFor();
    await page.getByRole("button", { name: "Trocar veículo" }).click();
    const dialog = page.getByRole("dialog", { name: "Escolher veículo" });
    await dialog.waitFor();
    const names = await dialog.getByRole("radio").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")));
    assert.deepEqual([...names].sort(), ["DAF XF 480", "Iveco S Way", "Scania G", "Volvo FH 540"], "Only vehicles of this company, none in maintenance: " + names);
    const folders = await dialog.locator(".nvu-assignment-folder-heading strong").allInnerTexts();
    assert.deepEqual(folders, ["Cavalos A", "Cavalos B", "Sem pasta"]);
    assert.match(await dialog.getByRole("radio", { name: "Scania G" }).innerText(), /Veículo atual/);
    assert.match(await dialog.getByRole("radio", { name: "Iveco S Way" }).innerText(), /Em uso por 1 motorista/);
    const use = dialog.getByRole("button", { name: "Usar veículo" });
    assert.equal(await use.isDisabled(), true, "The current vehicle cannot be confirmed again");
    await dialog.getByRole("searchbox", { name: "Buscar veículo" }).fill("volvo");
    assert.deepEqual(await dialog.getByRole("radio").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label"))), ["Volvo FH 540"]);
    await dialog.getByRole("radio", { name: "Volvo FH 540" }).click();
    assert.equal(await use.isEnabled(), true);
    // closing discards the selection and writes nothing
    await dialog.getByRole("button", { name: "Cancelar" }).click(); await dialog.waitFor({ state: "detached" });
    assert.deepEqual((await ops(page)).vehicleChanges, []);
    await page.getByRole("button", { name: "Trocar veículo" }).click();
    const again = page.getByRole("dialog", { name: "Escolher veículo" });
    assert.equal(await again.getByRole("button", { name: "Usar veículo" }).isDisabled(), true, "A new opening starts without the discarded selection");
    // double click on the confirmation: one command only
    await page.evaluate(() => { window.__ops.delay = 400; });
    await again.getByRole("radio", { name: "Volvo FH 540" }).click();
    await again.getByRole("button", { name: "Usar veículo" }).dblclick();
    await page.getByText("Trocando o veículo da operação…").waitFor();
    await page.getByText("Trocando o veículo da operação…").waitFor({ state: "detached" });
    assert.deepEqual((await ops(page)).vehicleChanges, [{ id: "job-a", vehicleId: "volvo" }]);
    assert.deepEqual(await jobsState(page), { "job-a": { status: "active", vehicleId: "volvo" }, "job-b": { status: "active", vehicleId: "iveco" }, "job-c": { status: "active", vehicleId: "foreign-truck" } });
    await page.keyboard.press("Escape"); await sheet(page).waitFor({ state: "detached" });
    await infoButton(page, "Volvo FH 540").waitFor();
    assert.equal(await infoButton(page, "Scania G").count(), 0, "The center shows the new vehicle");
    await context.close();
  });

  await check("Trocar veículo: network failure keeps the old vehicle and offers a retry; offline and finished jobs are refused before writing", async () => {
    const { context, page } = await openWindow({ width: 390, height: 780 });
    await start(page);
    await page.evaluate(() => { window.__ops.failVehicle = 1; });
    await infoButton(page, "Scania G").click(); await sheet(page).waitFor();
    await page.getByRole("button", { name: "Trocar veículo" }).click();
    let dialog = page.getByRole("dialog", { name: "Escolher veículo" });
    await dialog.getByRole("radio", { name: "DAF XF 480" }).click(); await dialog.getByRole("button", { name: "Usar veículo" }).click();
    const failure = page.getByRole("alert");
    await failure.waitFor();
    assert.match(await failure.innerText(), /O veículo não está disponível/);
    assert.equal((await jobsState(page))["job-a"].vehicleId, "scania", "A failed write leaves the link untouched");
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await page.getByRole("alert").waitFor({ state: "detached" });
    assert.deepEqual((await ops(page)).vehicleChanges, [{ id: "job-a", vehicleId: "daf" }, { id: "job-a", vehicleId: "daf" }]);
    assert.equal((await jobsState(page))["job-a"].vehicleId, "daf");
    // offline: refused locally, nothing is sent
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { value: false, configurable: true }); window.dispatchEvent(new Event("offline")); });
    if (!await sheet(page).count()) await infoButton(page, "DAF XF 480").click();
    await sheet(page).waitFor();
    await page.getByRole("button", { name: "Trocar veículo" }).click();
    dialog = page.getByRole("dialog", { name: "Escolher veículo" });
    await dialog.getByRole("radio", { name: "Volvo FH 540" }).click(); await dialog.getByRole("button", { name: "Usar veículo" }).click();
    assert.match(await page.getByRole("alert").innerText(), /Sem conexão/);
    assert.equal((await ops(page)).vehicleChanges.length, 2);
    await context.close();
  });

  await check("Cancelar trabalho: confirmation first; nothing is written before it; one command; failure and retry; the trips stay", async () => {
    const { context, page } = await openWindow({ width: 390, height: 780 });
    await start(page);
    await infoButton(page, "Scania G").click(); await sheet(page).waitFor();
    await page.getByRole("button", { name: "Cancelar trabalho" }).click();
    const dialog = page.getByRole("dialog", { name: "Cancelar trabalho" });
    await dialog.waitFor();
    assert.equal((await dialog.locator("p").first().innerText()).trim(), "Deseja cancelar o trabalho BLS - 150 de Ana Souza? As viagens já registradas serão preservadas.");
    assert.deepEqual((await ops(page)).cancels, [], "No write before the confirmation");
    const confirm = dialog.getByRole("button", { name: "Confirmar cancelamento" });
    assert.equal(await confirm.evaluate(node => getComputedStyle(node).backgroundColor), "rgb(255, 136, 0)");
    await dialog.getByRole("button", { name: "Voltar", exact: true }).click(); await dialog.waitFor({ state: "detached" });
    assert.deepEqual((await ops(page)).cancels, []); await sheet(page).waitFor();
    await page.evaluate(() => { window.__ops.failCancel = 1; window.__ops.delay = 300; });
    await page.getByRole("button", { name: "Cancelar trabalho" }).click();
    await dialog.waitFor();
    await confirm.dblclick();
    await dialog.getByRole("alert").waitFor();
    assert.match(await dialog.getByRole("alert").innerText(), /Não foi possível cancelar/);
    assert.deepEqual((await ops(page)).cancels, ["job-a"], "Repeated clicks send one command");
    assert.equal((await jobsState(page))["job-a"].status, "active");
    await confirm.click();
    await dialog.waitFor({ state: "detached" }); await sheet(page).waitFor({ state: "detached" });
    assert.deepEqual((await ops(page)).cancels, ["job-a", "job-a"]);
    assert.equal((await jobsState(page))["job-a"].status, "cancelled");
    assert.equal(await page.locator(".nvu-central-operation").count(), 1, "The center keeps only the other job");
    assert.equal((await jobsState(page))["job-b"].status, "active");
    await context.close();
  });

  for (const [label, width, height, mobile, theme] of [["small phone", 360, 640, true, "dark"], ["phone landscape", 844, 390, true, "dark"], ["phone landscape, low", 720, 340, true, "dark"], ["tablet", 820, 1180, false, "light"], ["desktop", 1366, 768, false, "dark"]]) {
    await check(`Sheet adapts to the screen (${label} ${width}x${height}): every control reachable, nothing cut, room below the last button`, async () => {
      const { context, page } = await openWindow({ width, height }, { mobile });
      await start(page, theme);
      await infoButton(page, "Scania G").click(); await sheet(page).waitFor();
      const m = await page.evaluate(() => {
        const dialog = document.querySelector(".nvu-central-sheet"), r = dialog.getBoundingClientRect(), actions = [...document.querySelectorAll(".nvu-op-sheet-action")].map(node => node.getBoundingClientRect());
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, innerWidth, innerHeight, scrolls: dialog.scrollHeight > dialog.clientHeight + 1, actions: actions.map(a => [a.top, a.bottom, a.left, a.right]), overflowX: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      const info = label + JSON.stringify(m);
      assert(m.top >= 0 && Math.abs(m.bottom - m.innerHeight) <= 1 && m.left >= 0 && m.right <= m.innerWidth + 1 && !m.overflowX, info);
      if (!m.scrolls) assert(m.actions.every(([t, b, l, r]) => t >= m.top && b <= m.bottom - 8 && l >= m.left && r <= m.right), "All four buttons inside the panel: " + info);
      else {
        // a panel taller than the screen scrolls inside itself: the last button can be reached
        await page.locator('.nvu-op-sheet-action[data-action="cancel"]').scrollIntoViewIfNeeded();
        const last = await box(page, '.nvu-op-sheet-action[data-action="cancel"]');
        assert(last.bottom <= m.innerHeight && last.top >= 0, "Reachable by scrolling: " + info);
      }
      await page.screenshot({ path: path.join(output, `sheet-${label.replaceAll(/[ ,]+/g, "-")}.png`) });
      await context.close();
    });
  }

  assert.deepEqual(errors, []);
  assert.deepEqual(outbound, []);
  console.log(`OPERATION_INFO_UI_PASS ${results.length} checks`);
} finally { await browser.close(); }
