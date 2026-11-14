// Actual React components + production CSS, isolated from Firebase and Android.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";

const { chromium } = await import(process.env.NVU_PLAYWRIGHT_MODULE || "playwright");
const cwd = process.cwd(), results = [], errors = [];
const cssNames = fs.readdirSync("dist/assets").filter(name => name.endsWith(".css"));
cssNames.sort((a, b) => Number(!a.startsWith("index-")) - Number(!b.startsWith("index-")));
const css = cssNames.map(name => fs.readFileSync(path.join("dist/assets", name), "utf8")).join("\n");
const compiled = await build({ entryPoints: ["scripts/fixtures/driver-workspace-477.tsx"], bundle: true, write: false,
  platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "no-production-ports", setup(b) {
    b.onResolve({ filter: /\/(?:context\/AppContext|contexts\/AutomaticOperationsProvider)$/ }, () =>
      ({ path: path.join(cwd, "scripts/fixtures/workspace-475-ports.ts") }));
  } }] });
const server = createServer((req, res) => {
  const requestPath = new URL(req.url, "http://localhost").pathname;
  const [type, contents] = requestPath === "/fixture.js" ? ["text/javascript", compiled.outputFiles[0].text]
    : requestPath === "/styles.css" ? ["text/css", css]
      : ["text/html", '<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'];
  res.writeHead(200, { "Content-Type": `${type}; charset=utf-8` }); res.end(contents);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.NVU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NVU_CHROMIUM_EXECUTABLE } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote"] });
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await context.route("**/*", route => new URL(route.request().url()).origin === url ? route.continue() : route.abort());
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(url); await page.locator("#fixture-ready").waitFor({ state: "attached" });
  const reset = async (options = {}) => {
    const generation = await page.locator("#fixture-ready").textContent();
    await page.evaluate(options => window.__workspace477.reset(options), options);
    await page.waitForFunction(old => document.getElementById("fixture-ready").textContent !== old, generation);
  };
  const update = async options => { await page.evaluate(options => window.__workspace477.update(options), options);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
  const calls = () => page.evaluate(() => window.__workspace477.calls());
  const test = async (name, fn) => { await fn(); results.push({ name, result: "PASS" }); console.log(`PASS ${name}`); };
  await test("Next operation stays visible and the complete queue excludes the 13 completed entries", async () => {
    assert.equal(await page.locator("details").count(), 4);
    assert.equal(await page.locator(".nvu-queue-progress").getAttribute("aria-valuenow"), "65");
    await page.getByRole("button", { name: "Fila operacional", exact: true }).click();
    assert(await page.locator(".nvu-queue-entries").isHidden());
    assert(await page.getByRole("button", { name: "Iniciar trabalho", exact: true }).isVisible());
    await page.getByRole("button", { name: "Fila operacional", exact: true }).click();
    await page.getByRole("button", { name: "Ver fila completa", exact: true }).click();
    assert.equal(await page.locator("details").count(), 7);
    const pendingNames = await page.locator("details summary > span:nth-of-type(2)").allTextContents();
    assert.deepEqual(pendingNames, Array.from({ length: 7 }, (_, i) => `BLS - ${(i + 14) * 10}`));
    assert.equal(await page.locator(".nvu-queue-progress").getAttribute("aria-valuenow"), "65", "Hiding completed rows cannot reset progress");
    await page.getByRole("button", { name: "Mostrar próximas operações", exact: true }).click();
    assert.equal(await page.locator("details").count(), 4);
  });
  await test("A completed queue has no operation rows and retains its 100 percent progress", async () => {
    await reset({ reason: "complete" });
    assert.equal(await page.locator("details").count(), 0);
    assert.equal(await page.locator(".nvu-queue-progress").getAttribute("aria-valuenow"), "100");
    assert.equal(await page.getByRole("button", { name: "Iniciar trabalho", exact: true }).count(), 0);
  });
  await test("Vehicle selection and duplicate confirmation preserve one server command", async () => {
    await reset({ slowStart: true });
    await page.getByRole("button", { name: "Iniciar trabalho", exact: true }).click();
    await page.getByRole("radio", { name: /Scania/ }).check();
    await page.getByRole("button", { name: "Confirmar e iniciar", exact: true }).evaluate(button => { button.click(); button.click(); });
    assert.equal((await calls()).filter(call => call.action === "start").length, 1);
    assert.equal((await calls()).find(call => call.action === "start").vehicleId, "v2");
    assert(await page.getByRole("button", { name: "Confirmando…", exact: true }).isDisabled());
    await page.evaluate(() => window.__workspace477.release());
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  });
  await test("Changed preview token or profile scope blocks an open confirmation", async () => {
    for (const change of [{ token: "new-preview" }, { scope: "other-profile" }]) {
      await reset(); await page.getByRole("button", { name: "Iniciar trabalho", exact: true }).click();
      await update(change);
      assert(await page.getByRole("button", { name: "Confirmar e iniciar", exact: true }).isDisabled());
      assert.equal((await calls()).filter(call => call.action === "start").length, 0);
      await page.getByRole("button", { name: "Voltar", exact: true }).click();
    }
  });
  await test("Complete cached queue remains usable offline and during background revalidation", async () => {
    for (const options of [{ offline: true, fresh: false }, { fresh: false, offlineAvailable: true, loading: true }]) {
      await reset(options);
      await page.getByRole("button", { name: "Iniciar trabalho", exact: true }).click();
      await page.getByRole("button", { name: "Confirmar e iniciar", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal((await calls()).filter(call => call.action === "start").length, 1);
    }
  });
  await test("Missing complete cache, suspension and unresolved local command block initiation", async () => {
    for (const options of [{ fresh: false }, { loading: true, fresh: false }, { blocked: true }, { localCommandPending: true }]) {
      await reset(options);
      assert(await page.getByRole("button", { name: "Iniciar trabalho", exact: true }).isDisabled());
    }
  });
  await test("Running, review, manual and no-vehicle reasons never offer automatic initiation", async () => {
    for (const reason of ["running", "review", "manual_pending", "vehicles_unconfigured", "no_vehicles", "complete"]) {
      await reset({ reason }); assert.equal(await page.getByRole("button", { name: "Iniciar trabalho", exact: true }).count(), 0);
    }
    await update({ reason: "ready" });
    assert(await page.getByRole("button", { name: "Iniciar trabalho", exact: true }).isVisible());
  });
  await test("Manual request availability, pending cancellation and completion review remain usable", async () => {
    await reset({ noQueues: true, manual: true, online: false });
    assert(await page.locator(".nvu-work-request button").isDisabled());
    await update({ online: true }); await page.locator(".nvu-work-request button").click();
    assert((await calls()).some(call => call.action === "request"));
    await update({ pending: true }); await page.getByRole("button", { name: "Cancelar pedido", exact: true }).click();
    assert((await calls()).some(call => call.action === "cancel"));
    await page.getByRole("button", { name: "Ver resultado da operação finalizada", exact: true }).click();
    assert((await calls()).some(call => call.action === "review"));
  });
  await test("Compact result preserves separate currencies and incomplete-history feedback", async () => {
    await reset({ partialMoney: true });
    assert.equal(await page.locator(".nvu-completed-money > div > span").count(), 2);
    assert.match(await page.locator(".nvu-completed-operation-pending").innerText(), /sincronizar/);
    await page.locator(".nvu-completed-money summary").click();
    assert.match(await page.locator(".nvu-completed-money").innerText(), /Moeda não identificada/);
  });
  await test("All icon-only dock destinations retain accessible names and callbacks", async () => {
    await reset();
    for (const label of ["Trabalho", "Atividade", "Resultados", "NVU News", "Ranking", "Perfil"]) {
      await page.getByRole("button", { name: label, exact: true }).click();
    }
    assert.deepEqual((await calls()).filter(call => call.action === "navigate").map(call => call.id),
      ["dashboard", "activity", "results", "news", "ranking", "profile"]);
  });
  for (const width of [320, 360, 390, 412, 768, 1280]) for (const dark of [false, true]) for (const company of [false, true]) {
    await page.setViewportSize({ width, height: 900 }); await reset({ dark, company, longName: width === 320 });
    const metrics = await page.evaluate(() => {
      const dock = document.querySelector(".nvu-driver-dock"), rect = dock.getBoundingClientRect(), style = getComputedStyle(dock);
      const icons = [...dock.querySelectorAll("svg")].map(icon => { const r = icon.getBoundingClientRect(); return { top: r.top - rect.top, bottom: rect.bottom - r.bottom }; });
      const actions = [...dock.querySelectorAll("button")].map(button => { const r = button.getBoundingClientRect();
        return { width: r.width, height: r.height, label: button.getAttribute("aria-label"), visibleText: button.textContent.trim() }; });
      return { overflow: document.documentElement.scrollWidth > innerWidth,
        dock: { left: rect.left, right: rect.right, bottom: rect.bottom, height: rect.height, shadow: style.boxShadow,
          color: style.backgroundColor, page: getComputedStyle(document.querySelector(".nvu-driver-surface")).backgroundColor }, icons, actions };
    });
    assert(!metrics.overflow, `Horizontal overflow ${width}/${dark}/${company}`);
    assert.equal(metrics.actions.length, 6); assert.equal(metrics.dock.shadow, "none");
    assert.notEqual(metrics.dock.color, metrics.dock.page);
    assert(metrics.dock.left >= 0 && metrics.dock.right <= width && metrics.dock.bottom <= 890.5);
    assert(metrics.dock.height >= 52 && metrics.dock.height <= 60);
    assert(metrics.actions.every(action => action.label && !action.visibleText && action.width >= 43.9 && action.height >= 44));
    assert(metrics.icons.every(icon => icon.top >= 10 && icon.bottom >= 10));
    await page.locator(".nvu-completed-operation").scrollIntoViewIfNeeded();
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const clear = await page.evaluate(() => document.querySelector(".nvu-completed-operation").getBoundingClientRect().bottom <= document.querySelector(".nvu-driver-dock").getBoundingClientRect().top);
    assert(clear, "Dock must not cover the last result when the page reaches its end");
    if (width === 390 && !company) {
      const directory = process.env.NVU_UI_EVIDENCE || "reports/visual-477"; fs.mkdirSync(directory, { recursive: true });
      await page.screenshot({ path: path.join(directory, `workspace-${dark ? "dark" : "light"}-390.png`), fullPage: true });
    }
    results.push({ name: `Geometry ${width}/${dark ? "dark" : "light"}/${company ? "company" : "driver"}`, result: "PASS", metrics });
  }
  assert.deepEqual(errors, []);
  fs.mkdirSync("reports", { recursive: true });
  fs.writeFileSync("reports/driver-workspace-477-visual.json", JSON.stringify({ result: "PASS", browser: browser.version(),
    productionAccess: false, scope: "Actual UI components + production CSS with isolated fixtures. No signed APK or physical-device test.", results }, null, 2));
  console.log(`WORKSPACE_477_VISUAL ${results.length} PASS`);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
