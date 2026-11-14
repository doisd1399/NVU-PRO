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
const css = ["vendor", "index", "DriverWorkspace", "Profile"].flatMap(p => names.filter(n => n.startsWith(p + "-") && n.endsWith(".css")))
  .map(n => fs.readFileSync(path.join("dist/assets", n), "utf8")).join("\n");
const compiled = await build({ entryPoints: ["scripts/fixtures/driver-idle-panel-492.tsx"], bundle: true, write: false, loader: { ".css": "empty" }, jsx: "automatic", platform: "browser", format: "iife",
  define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "no-production-ports", setup(b) {
    b.onResolve({ filter: /\/(?:context\/AppContext|contexts\/AutomaticOperationsProvider)$/ }, () => ({ path: path.join(root, "scripts/fixtures/workspace-475-ports.ts") }));
    b.onResolve({ filter: /\/hooks\/useRewards$/ }, () => ({ path: path.join(root, "scripts/fixtures/rewards-ports.ts") }));
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
  await context.route("**/*", route => { const u = new URL(route.request().url()); if (u.origin === url) return route.continue(); remoteBlocked++; if (process.env.DBG) console.log("BLOCKED", route.request().url().slice(0, 120)); return route.abort(); });
  const page = await context.newPage(); page.setDefaultTimeout(7000); page.on("pageerror", e => errors.push(e.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(url); await page.locator("#idle-fixture-ready").waitFor({ state: "attached" });
  const reset = async options => { await page.evaluate(o => window.__idle492.reset(o), options); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); };
  const calls = () => page.evaluate(() => window.__idle492.calls());
  const test = async (name, fn) => { await fn(); results.push({ name, result: "PASS" }); console.log(`PASS ${name}`); };
  await test("Menu: sem card de empresa; opções na ordem pedida (sem Solicitar trabalho), Carteira e Perfil abrem as páginas e Conquistas fica em breve", async () => {
    await reset({});
    assert.equal(await page.locator(".nvu-idle-company").count(), 0); assert.equal(await page.getByText("Empresa vinculada").count(), 0);
    assert.deepEqual(await page.locator(".nvu-idle-menu-item .nvu-idle-menu-label").evaluateAll(n => n.map(e => e.childNodes[0].textContent)), ["Trabalho atual", "Ver Trabalhos", "Histórico de operações", "Carteira", "Perfil", "Conquistas"]);
    const order = await page.evaluate(() => { const status = document.querySelector(".nvu-driver-status-row").getBoundingClientRect(), menu = document.querySelector(".nvu-idle-menu").getBoundingClientRect(); return menu.top >= status.bottom; });
    assert(order, "a lista de opções fica abaixo do status");
    assert(await page.locator('.nvu-idle-menu-item[data-item="achievements"]').isDisabled()); assert.match(await page.locator('.nvu-idle-menu-item[data-item="achievements"]').innerText(), /Em breve/);
    await page.locator('.nvu-idle-menu-item[data-item="wallet"]').click(); await page.locator('.nvu-idle-menu-item[data-item="profile"]').click();
    assert.deepEqual((await calls()).map(c => c.action), ["wallet", "profile"]);
    assert(await page.locator('.nvu-idle-menu-item[data-item="current"]').isDisabled(), "sem trabalho atual a opção fica desabilitada"); assert.match(await page.locator('.nvu-idle-menu-item[data-item="current"]').innerText(), /Nenhum em andamento/);
    await reset({ current: true }); const current = page.locator('.nvu-idle-menu-item[data-item="current"]');
    assert(await current.isEnabled()); assert.match(await current.innerText(), /BLS - 30 · 3 de 12 entregas/);
    assert(await page.evaluate(() => document.querySelector(".nvu-idle-menu-item").dataset.item === "current"), "Trabalho atual é a primeira opção");
    await current.click(); assert.deepEqual((await calls()).map(c => c.action), ["current"]);
    assert.equal(await page.locator('.nvu-idle-menu-item[data-item="request"]').count(), 0, "Solicitar trabalho fica só dentro de Ver Trabalhos");
    await page.locator('.nvu-idle-menu-item[data-item="works"]').click(); assert(await page.getByRole("button", { name: "Solicitar trabalho", exact: true }).isVisible());
    await page.getByRole("button", { name: "Voltar ao painel do motorista" }).click(); assert(await page.locator(".nvu-idle-menu").isVisible());
  });
  await test("Ver Trabalhos reúne solicitar trabalho, trabalhos recebidos e fila operacional; Histórico abre a própria tela", async () => {
    await reset({ manual: true }); assert.match(await page.locator('.nvu-idle-menu-item[data-item="works"]').innerText(), /1/);
    await page.locator('.nvu-idle-menu-item[data-item="works"]').click();
    assert(await page.getByRole("heading", { name: "Trabalhos", exact: true }).isVisible());
    assert(await page.getByRole("heading", { name: "Sem operação em andamento" }).isVisible());
    assert.match(await page.locator(".nvu-idle-assigned-heading").innerText(), /Trabalhos recebidos/); assert.doesNotMatch(await page.locator("body").innerText(), /Encaminhamentos da empresa/);
    await page.getByRole("button", { name: "Voltar ao painel do motorista" }).click();
    await page.locator('.nvu-idle-menu-item[data-item="history"]').click();
    assert(await page.getByRole("heading", { name: "Histórico de operações", exact: true }).isVisible()); assert.equal(await page.getByTestId("driver-previous-work").locator("li").count(), 1);
    await reset({ view: "works" }); assert(await page.getByRole("heading", { name: "Fila operacional" }).first().isVisible() || await page.locator(".nvu-queue-entries, .nvu-driver-queue").first().isVisible());
  });
  await test("Request, pending confirmation and cancellation keep the real action callbacks", async () => {
    await reset({ view: "works" }); await page.getByRole("button", { name: "Solicitar trabalho", exact: true }).click();
    assert(await page.getByRole("heading", { name: "Solicitação em andamento" }).isVisible());
    await page.getByRole("button", { name: "Cancelar pedido" }).click();
    assert.deepEqual((await calls()).map(c => c.action), ["request", "cancel"]);
  });
  await test("Availability, suspension and busy state guard work requests", async () => {
    for (const options of [{ online: false }, { suspended: true }, { busy: true }]) {
      await reset({ ...options, view: "works" }); assert(await page.getByRole("button", { name: /^(Solicitar trabalho|Enviando…)$/ }).isDisabled());
    }
    await reset({ view: "works" }); await page.locator(".nvu-driver-status-row label").click();
    assert(!(await page.getByRole("checkbox", { name: "Disponível para fretes" }).isChecked()));
    assert.match(await page.locator(".nvu-driver-status-value").innerText(), /Indisponível/);
    assert(await page.getByRole("button", { name: "Solicitar trabalho", exact: true }).isDisabled());
    await reset({ suspended: true, view: "works" }); assert(await page.getByRole("checkbox", { name: "Disponível para fretes" }).isDisabled());
  });
  await test("History excludes other drivers and cancelled jobs, and resets by company", async () => {
    await reset({ view: "history" }); const history = page.getByTestId("driver-previous-work");
    assert.equal(await history.locator("li").count(), 1);
    await history.getByRole("button", { name: "Ver trabalho Operação finalizada A" }).click();
    assert.deepEqual((await calls()).filter(c => c.action === "review"), [{ action: "review", id: "done-a" }]);
    await page.evaluate(() => window.__idle492.update({ company: "b" }));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.match(await history.innerText(), /Operação finalizada B/);
    assert.doesNotMatch(await history.innerText(), /finalizada A|outro motorista|cancelled/);
  });
  await test("Automatic queue retains vehicle confirmation, single initiation and offline cache", async () => {
    for (const offline of [false, true]) {
      await reset({ offline, view: "works" }); await page.getByRole("button", { name: "Iniciar trabalho", exact: true }).click();
      await page.getByRole("button", { name: "Confirmar e iniciar", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal((await calls()).filter(c => c.action === "automatic-start").length, 1);
      await page.getByRole("button", { name: /Ver fila completa/ }).click();
      assert.doesNotMatch(await page.locator(".nvu-queue-entries").innerText(), /BLS - 130/);
    }
  });
  await test("Manual forwarded operation remains accessible and suspension blocks its start", async () => {
    await reset({ manual: true, view: "works" }); await page.locator(".nvu-idle-assigned-row summary").click();
    await page.getByRole("button", { name: "Iniciar operação", exact: true }).click();
    assert((await calls()).some(c => c.action === "manual-start" && c.id === "manual"));
    await reset({ manual: true, suspended: true, view: "works" }); await page.locator(".nvu-idle-assigned-row summary").click();
    assert(await page.getByRole("button", { name: "Iniciar operação", exact: true }).isDisabled());
  });
  for (const width of [320, 360, 390, 412, 768, 1280]) for (const dark of [false, true]) {
    await page.setViewportSize({ width, height: 900 }); await page.mouse.move(0, 0); await reset({ dark, longName: width === 320, view: "works" });
    await page.evaluate(() => document.fonts.ready);
    const geometry = await page.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect(), hero = r("[data-nvu-profile-banner]"), title = r(".nvu-idle-heading h1"), desc = r(".nvu-idle-heading p"), status = r(".nvu-driver-status-row"), request = r(".nvu-idle-work-request"), button = r(".nvu-idle-request-action"), copy = r(".nvu-idle-work-request p");
      const css = getComputedStyle(document.querySelector(".nvu-idle-request-action"));
      return { overflow: document.documentElement.scrollWidth > innerWidth, titleGap: title.top - hero.bottom, descriptionGap: desc.top - title.bottom,
        companyGap: status.top - desc.bottom, buttonGap: button.top - copy.bottom, buttonBottom: request.bottom - button.bottom,
        background: css.backgroundColor, color: css.color,
        switchBackground: getComputedStyle(document.querySelector(".nvu-driver-status-switch")).backgroundColor,
        titleWidth: title.width, heroHeight: hero.height };
    });
    assert(!geometry.overflow, JSON.stringify({ width, dark, geometry }));
    assert(geometry.titleGap >= 0 && geometry.descriptionGap >= 4 && geometry.companyGap >= 20, JSON.stringify(geometry));
    assert(geometry.buttonGap >= 18 && geometry.buttonBottom >= 14, JSON.stringify(geometry));
    assert.equal(geometry.background, "rgb(40, 92, 100)");
    assert.equal(geometry.switchBackground, "rgb(63, 129, 120)");
    assert.equal(await page.getByRole("button", { name: "Selecionar simulador", exact: true }).count(), 1);
    await page.evaluate(() => document.querySelector(".nvu-idle-request-action").scrollIntoView({ block: "center" }));
    await reset({ dark, view: "menu" }); await page.locator(".nvu-idle-menu-item").last().scrollIntoViewIfNeeded();
    const clear = await page.evaluate(() => { const h = document.querySelector(".nvu-idle-menu").getBoundingClientRect(), d = document.querySelector(".nvu-driver-dock").getBoundingClientRect(); return { fits: h.bottom <= d.top, overflow: document.documentElement.scrollWidth > innerWidth }; });
    assert(clear.fits && !clear.overflow, "Dock must leave the last option accessible: " + JSON.stringify({ width, dark, clear }));
    results.push({ width, dark, result: "PASS", geometry });
    if (width === 390) { fs.mkdirSync("verification/driver-idle-492", { recursive: true }); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `verification/driver-idle-492/${dark ? "dark" : "light"}-menu.png`, fullPage: true }); await reset({ dark, view: "works" }); await page.screenshot({ path: `verification/driver-idle-492/${dark ? "dark" : "light"}.png`, fullPage: true }); }
  }
  assert.deepEqual(errors, []); assert.equal(remoteBlocked, 0);
  fs.mkdirSync("reports", { recursive: true }); fs.writeFileSync("reports/driver-idle-panel-492.json", JSON.stringify({ result: "PASS", browser: browser.version(), productionAccess: false, results }, null, 2) + "\n");
  console.log(`DRIVER_IDLE_PANEL_492_PASS (${results.length} checks)`);
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
