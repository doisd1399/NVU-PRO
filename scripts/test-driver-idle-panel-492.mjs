// Real approved-panel components, queue actions and production CSS. No backend.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { build } from "esbuild";
let playwright;
try { playwright = await import(process.env.NVU_PLAYWRIGHT_MODULE || "playwright"); }
catch { playwright = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright/index.mjs"))); }
const root = process.cwd(), results = [], errors = [];
const names = fs.readdirSync("dist/assets");
const css = ["vendor", "index", "DriverWorkspace"].flatMap(p => names.filter(n => n.startsWith(p + "-") && n.endsWith(".css")))
  .map(n => fs.readFileSync(path.join("dist/assets", n), "utf8")).join("\n");
const compiled = await build({ entryPoints: ["scripts/fixtures/driver-idle-panel-492.tsx"], bundle: true, write: false, platform: "browser", format: "iife",
  define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "no-production-ports", setup(b) {
    b.onResolve({ filter: /\/(?:context\/AppContext|contexts\/AutomaticOperationsProvider)$/ }, () => ({ path: path.join(root, "scripts/fixtures/workspace-475-ports.ts") }));
  } }] });
const server = createServer((req, res) => {
  const p = new URL(req.url, "http://127.0.0.1").pathname;
  if (p.endsWith("broken-logo.png")) { res.writeHead(404); return res.end(); }
  if (p.startsWith("/assets/")) { res.writeHead(200, { "Content-Type": "font/woff2" }); return res.end(fs.readFileSync(path.join(root, "public", p))); }
  const [type, body] = p === "/app.js" ? ["text/javascript", compiled.outputFiles[0].text] : p === "/styles.css" ? ["text/css", css]
    : ["text/html", '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'];
  res.writeHead(200, { "Content-Type": type }); res.end(body);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;
let browser, remoteBlocked = 0;
try {
  browser = await playwright.chromium.launch({ headless: true, ...(process.env.NVU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NVU_CHROMIUM_EXECUTABLE } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext();
  await context.route("**/*", route => { const u = new URL(route.request().url()); if (u.origin === url) return route.continue(); remoteBlocked++; return route.abort(); });
  const page = await context.newPage(); page.setDefaultTimeout(7000); page.on("pageerror", e => errors.push(e.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(url); await page.locator("#idle-fixture-ready").waitFor({ state: "attached" });
  const reset = async options => { await page.evaluate(o => window.__idle492.reset(o), options); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); };
  const calls = () => page.evaluate(() => window.__idle492.calls());
  const test = async (name, fn) => { await fn(); results.push({ name, result: "PASS" }); console.log(`PASS ${name}`); };
  await test("Request, pending confirmation and cancellation keep the real action callbacks", async () => {
    await reset({}); await page.getByRole("button", { name: "Solicitar trabalho", exact: true }).click();
    assert(await page.getByRole("heading", { name: "Solicitação em andamento" }).isVisible());
    await page.getByRole("button", { name: "Cancelar pedido" }).click();
    assert.deepEqual((await calls()).map(c => c.action), ["request", "cancel"]);
  });
  await test("Availability, suspension and busy state guard work requests", async () => {
    for (const options of [{ online: false }, { suspended: true }, { busy: true }]) {
      await reset(options); assert(await page.getByRole("button", { name: /^(Solicitar trabalho|Enviando…)$/ }).isDisabled());
    }
    await reset({}); await page.locator(".nvu-driver-status-row label").click();
    assert(!(await page.getByRole("checkbox", { name: "Disponível para fretes" }).isChecked()));
    assert.match(await page.locator(".nvu-driver-status-value").innerText(), /Indisponível/);
    assert(await page.getByRole("button", { name: "Solicitar trabalho", exact: true }).isDisabled());
    await reset({ suspended: true }); assert(await page.getByRole("checkbox", { name: "Disponível para fretes" }).isDisabled());
  });
  await test("History starts collapsed, excludes other drivers and cancelled jobs, and resets by company", async () => {
    await reset({}); const history = page.getByTestId("driver-previous-work"), toggle = history.locator("button").first();
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await history.locator("li").count(), 0);
    await toggle.click(); assert.equal(await history.locator("li").count(), 1);
    await history.getByRole("button", { name: "Ver trabalho Operação finalizada A" }).click();
    assert.deepEqual((await calls()).filter(c => c.action === "review"), [{ action: "review", id: "done-a" }]);
    await page.evaluate(() => window.__idle492.update({ company: "b" }));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await history.locator("button").first().getAttribute("aria-expanded"), "false");
    await history.locator("button").first().click(); assert.match(await history.innerText(), /Operação finalizada B/);
    assert.doesNotMatch(await history.innerText(), /finalizada A|outro motorista|cancelled/);
  });
  await test("Automatic queue retains vehicle confirmation, single initiation and offline cache", async () => {
    for (const offline of [false, true]) {
      await reset({ offline }); await page.getByRole("button", { name: "Iniciar trabalho", exact: true }).click();
      await page.getByRole("button", { name: "Confirmar e iniciar", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal((await calls()).filter(c => c.action === "automatic-start").length, 1);
      await page.getByRole("button", { name: /Ver fila completa/ }).click();
      assert.doesNotMatch(await page.locator(".nvu-queue-entries").innerText(), /BLS - 130/);
    }
  });
  await test("Manual forwarded operation remains accessible and suspension blocks its start", async () => {
    await reset({ manual: true }); await page.locator(".nvu-idle-assigned-row summary").click();
    await page.getByRole("button", { name: "Iniciar operação", exact: true }).click();
    assert((await calls()).some(c => c.action === "manual-start" && c.id === "manual"));
    await reset({ manual: true, suspended: true }); await page.locator(".nvu-idle-assigned-row summary").click();
    assert(await page.getByRole("button", { name: "Iniciar operação", exact: true }).isDisabled());
  });
  for (const width of [320, 360, 390, 412, 768, 1280]) for (const dark of [false, true]) {
    await page.setViewportSize({ width, height: 900 }); await reset({ dark, longName: width === 320 });
    await page.evaluate(() => document.fonts.ready);
    const geometry = await page.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect(), hero = r("[data-nvu-profile-banner]"), title = r(".nvu-idle-heading h1"), desc = r(".nvu-idle-heading p"), company = r(".nvu-idle-company"), request = r(".nvu-idle-work-request"), button = r(".nvu-idle-request-action"), copy = r(".nvu-idle-work-request p");
      const css = getComputedStyle(document.querySelector(".nvu-idle-request-action"));
      return { overflow: document.documentElement.scrollWidth > innerWidth, titleGap: title.top - hero.bottom, descriptionGap: desc.top - title.bottom,
        companyGap: company.top - desc.bottom, buttonGap: button.top - copy.bottom, buttonBottom: request.bottom - button.bottom,
        background: css.backgroundColor, color: css.color,
        switchBackground: getComputedStyle(document.querySelector(".nvu-driver-status-switch")).backgroundColor,
        titleWidth: title.width, heroHeight: hero.height };
    });
    assert(!geometry.overflow, JSON.stringify({ width, dark, geometry }));
    assert(geometry.titleGap >= 20 && geometry.descriptionGap >= 10 && geometry.companyGap >= 20, JSON.stringify(geometry));
    assert(geometry.buttonGap >= 18 && geometry.buttonBottom >= 14, JSON.stringify(geometry));
    assert.equal(geometry.background, "rgb(40, 92, 100)");
    assert.equal(geometry.switchBackground, "rgb(63, 129, 120)");
    assert.equal(await page.getByRole("button", { name: "Selecionar simulador", exact: true }).count(), 1);
    await page.getByTestId("driver-previous-work").scrollIntoViewIfNeeded();
    const clear = await page.evaluate(() => { const h = document.querySelector('[data-testid="driver-previous-work"]').getBoundingClientRect(), d = document.querySelector(".nvu-driver-dock").getBoundingClientRect(); return h.bottom <= d.top; });
    assert(clear, "Dock must leave the last history card accessible");
    results.push({ width, dark, result: "PASS", geometry });
    if (width === 390) { fs.mkdirSync("verification/driver-idle-492", { recursive: true }); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `verification/driver-idle-492/${dark ? "dark" : "light"}.png`, fullPage: true }); }
  }
  assert.deepEqual(errors, []); assert.equal(remoteBlocked, 0);
  fs.mkdirSync("reports", { recursive: true }); fs.writeFileSync("reports/driver-idle-panel-492.json", JSON.stringify({ result: "PASS", browser: browser.version(), productionAccess: false, results }, null, 2) + "\n");
  console.log(`DRIVER_IDLE_PANEL_492_PASS (${results.length} checks)`);
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
