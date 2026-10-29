// Runs the actual AssignJob page and picker with local fixture stores and production CSS.
// No Firebase access and no production writes.
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
const css = ["vendor", "index", "AssignmentWorkspace", "AssignJob"].flatMap(prefix => names.filter(name => name.startsWith(prefix + "-") && name.endsWith(".css")))
  .map(name => fs.readFileSync(path.join("dist/assets", name), "utf8")).join("\n");
assert(css.includes(".nvu-assignment-heading"), "Assignment production CSS exists");
const fixture = path.join(root, "scripts/fixtures/assignment-493-ports.tsx");
const compiled = await build({
  entryPoints: ["scripts/fixtures/assignment-approved-493.tsx"], bundle: true, write: false, platform: "browser", format: "iife", loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "local-store-adapters", setup(builder) {
    builder.onResolve({ filter: /\/(?:context\/(?:AppContext|CompanyContext)|contexts\/AutomaticOperationsProvider|components\/common\/StableImage)$/ }, () => ({ path: fixture }));
  } }],
});
const js = compiled.outputFiles.find(file => file.path.endsWith(".js"))?.text || compiled.outputFiles[0].text;
const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (pathname === "/fixture-avatar.png") { response.writeHead(200, { "Content-Type": "image/png" }); return response.end(fs.readFileSync("scripts/fixtures/central-management/avatar.png")); }
  if (pathname.startsWith("/assets/")) { response.writeHead(200, { "Content-Type": "font/woff2" }); return response.end(fs.readFileSync(path.join(root, "public", pathname))); }
  const [type, body] = pathname === "/app.js" ? ["text/javascript", js] : pathname === "/styles.css" ? ["text/css", css] : ["text/html", html];
  response.writeHead(200, { "Content-Type": type }); response.end(body);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.NVU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NVU_CHROMIUM_EXECUTABLE } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  let remoteRequests = 0;
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    remoteRequests++; return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(origin);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const reset = async (options = {}) => {
    await page.evaluate(options => window.__assignment493.reset(options), options);
    await page.getByRole("heading", { name: "Encaminhar trabalho", exact: true }).waitFor();
    await settle();
  };
  const run = async (name, action) => { await action(); results.push({ name, result: "PASS" }); console.log("PASS " + name); };
  const open = async (type) => {
    await page.getByRole("button", { name: type === "contract" ? /^(Selecionar|Alterar) operação/ : /^(Selecionar|Alterar) veículo/ }).click();
    await page.getByRole("dialog").waitFor();
    await settle();
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), "SECTION", "Opening a picker focuses the dialog, not an input");
    assert.equal(await page.locator(".nvu-assign-picker-dialog input:focus").count(), 0, "No automatic search focus / mobile keyboard trigger");
  };
  const choose = async (type, name) => {
    await open(type);
    await page.getByRole("radio", { name, exact: true }).click();
    await page.getByRole("button", { name: type === "contract" ? "Usar operação" : "Usar veículo", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
  };

  await run("Operation search, selection preview, explicit confirm and cancel", async () => {
    await reset(); await open("contract");
    assert.equal(await page.getByRole("radio", { name: "Já finalizada" }).count(), 0);
    await page.getByRole("searchbox", { name: "Buscar operação" }).fill("operacao especial");
    assert.equal(await page.getByRole("radio").count(), 1, "Accent-insensitive search");
    await page.getByRole("radio", { name: "Operação especial" }).click();
    assert(await page.getByRole("dialog").isVisible());
    assert(await page.getByRole("button", { name: "Selecionar operação", exact: true }).isVisible());
    await page.getByRole("button", { name: "Cancelar", exact: true }).last().click();
    assert(await page.getByRole("button", { name: "Selecionar operação", exact: true }).isVisible(), "Cancel does not commit the draft");
    await choose("contract", "BLS - 20");
    await open("contract");
    assert.equal(await page.getByRole("searchbox").inputValue(), "");
    assert.equal(await page.getByRole("radio", { name: "BLS - 20", exact: true }).getAttribute("aria-checked"), "true");
    await page.getByRole("radio", { name: "BLS - 10", exact: true }).click();
    await page.keyboard.press("Escape");
    assert(await page.getByRole("button", { name: "Alterar operação: BLS - 20", exact: true }).isVisible());
  });
  await run("Folder collapse, keyboard radio navigation, focus trap and Android Back", async () => {
    await reset(); await open("contract");
    const folder = page.getByRole("button", { name: /Operação padrão/ });
    await folder.click(); assert.equal(await page.getByRole("radio", { name: "BLS - 10", exact: true }).count(), 0);
    await folder.click();
    await page.getByRole("radio", { name: "BLS - 10", exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.getByRole("radio", { name: "BLS - 20", exact: true }).getAttribute("aria-checked"), "true");
    await page.getByRole("button", { name: "Usar operação", exact: true }).focus(); await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Fechar seleção");
    assert.equal(await page.evaluate(() => window.__assignment493.back()), true);
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Selecionar operação");
  });
  await run("Vehicle selection uses keys, zero/known/unknown usage, search needs explicit touch", async () => {
    await reset(); await open("vehicle");
    assert.equal(await page.locator(".nvu-assign-picker-dialog .lucide-key-round").count(), 7);
    assert.equal(await page.locator(".nvu-assign-picker-dialog img").count(), 0);
    assert.equal(await page.locator(".nvu-assign-picker-dialog .lucide-truck").count(), 0);
    await page.getByRole("searchbox", { name: "Buscar veículo" }).click();
    assert.equal(await page.evaluate(() => document.activeElement?.type), "search");
    await page.getByRole("searchbox").fill("mercedes");
    assert.equal(await page.getByRole("radio").count(), 2);
    await page.getByRole("radio", { name: "Mercedes 1620", exact: true }).click();
    await page.getByRole("button", { name: "Usar veículo", exact: true }).click();
    assert(await page.getByRole("button", { name: "Alterar veículo: Mercedes 1620", exact: true }).isVisible());
    await reset({ membersReady: false }); await open("vehicle");
    assert.equal(await page.getByText("Vínculos em consulta", { exact: true }).count(), 6);
    assert.equal(await page.getByText("Sem motoristas vinculados", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "Fechar seleção", exact: true }).click();
  });
  await run("Assignment keeps driver eligibility, derived trailer, per-driver deadline and return route", async () => {
    await reset();
    assert.equal(await page.getByRole("checkbox").count(), 2, "Only active members of the company");
    await choose("contract", "BLS - 20"); await choose("vehicle", "Mercedes 1620");
    await page.getByRole("checkbox", { name: "Selecionar David Canto", exact: true }).check();
    await page.getByText("Ajustar prazos por motorista", { exact: true }).click();
    await page.getByRole("spinbutton", { name: "Prazo em dias para David Canto", exact: true }).fill("6");
    await page.getByRole("button", { name: "Encaminhar trabalho", exact: true }).click();
    await page.locator("#assignment-return").waitFor();
    const calls = await page.evaluate(() => window.__assignment493.calls());
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 5), ["c20", "david", "v1", "t2", 6]);
    assert(calls[0][5] && typeof calls[0][5] === "string", "Idempotency request id retained");
  });
  await run("Partial failure retries only remaining drivers with the same request id", async () => {
    await reset({ failDriverIds: ["aline"] });
    await choose("contract", "BLS - 10"); await choose("vehicle", "Mercedes 1620");
    await page.getByRole("button", { name: "Selecionar todos", exact: true }).click();
    await page.getByRole("button", { name: "Encaminhar trabalho", exact: true }).click();
    await page.getByRole("checkbox", { name: "Selecionar David Canto", exact: true }).waitFor();
    await page.waitForFunction(() => window.__assignment493.calls().length === 2 && !document.querySelector('[aria-busy="true"]'));
    assert.equal(await page.getByRole("checkbox", { name: "Selecionar David Canto", exact: true }).isChecked(), false);
    assert.equal(await page.getByRole("checkbox", { name: "Selecionar Aline Santos", exact: true }).isChecked(), true);
    await page.evaluate(() => window.__assignment493.retry());
    await page.getByRole("button", { name: "Encaminhar trabalho", exact: true }).click();
    await page.locator("#assignment-return").waitFor();
    const calls = await page.evaluate(() => window.__assignment493.calls());
    assert.equal(calls.length, 3); assert.equal(calls[2][1], "aline"); assert.equal(calls[2][5], calls.find(call => call[1] === "aline")[5]);
  });
  await run("Busy state blocks duplicate sends and empty driver list remains compact", async () => {
    await reset({ hold: true }); await choose("contract", "BLS - 10"); await choose("vehicle", "Mercedes 1620");
    await page.getByRole("checkbox", { name: "Selecionar David Canto", exact: true }).check();
    await page.getByRole("button", { name: "Encaminhar trabalho", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Encaminhando…", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: /Alterar operação/ }).isDisabled(), true);
    assert.equal((await page.evaluate(() => window.__assignment493.calls())).length, 1);
    await page.evaluate(() => window.__assignment493.release()); await page.locator("#assignment-return").waitFor();
    await reset({ emptyDrivers: true });
    assert(await page.getByText("Nenhum motorista disponível para encaminhamento.", { exact: true }).isVisible());
    assert.equal(await page.getByRole("button", { name: "Encaminhar trabalho", exact: true }).isDisabled(), true);
  });

  for (const width of [320, 360, 393, 412, 768, 1280]) for (const dark of [false, true]) {
    await run("Responsive approved form and selectors " + width + " / " + (dark ? "dark" : "light"), async () => {
      await page.setViewportSize({ width, height: 915 }); await reset({ dark });
      const form = await page.locator(".nvu-assignment-panel").evaluate(node => {
        const panel = node.getBoundingClientRect(), header = document.querySelector(".nvu-admin-header").getBoundingClientRect();
        return { gap: panel.top - header.bottom, overflow: document.documentElement.scrollWidth > innerWidth, background: getComputedStyle(node).backgroundColor };
      });
      assert.equal(form.overflow, false);
      assert(form.gap >= 18 && form.gap <= 28, "Moderate gap below app header");
      if (dark) assert.equal(form.background, "rgb(26, 37, 45)");
      if (width === 412 && dark) {
        fs.mkdirSync("verification/assignment-493", { recursive: true });
        await page.screenshot({ path: "verification/assignment-493/assignment-dark.png", fullPage: true });
      }
      for (const type of ["contract", "vehicle"]) {
        await open(type);
        const measurements = await page.locator(".nvu-assign-picker-dialog").evaluate(node => {
          const panel = node.getBoundingClientRect(), header = document.querySelector(".nvu-admin-header").getBoundingClientRect();
          const footer = node.querySelector("footer").getBoundingClientRect(), list = node.querySelector(".nvu-assign-picker-list").getBoundingClientRect();
          const cards = [...node.querySelectorAll(".nvu-assignment-choice")].map(card => card.getBoundingClientRect());
          return { gap: panel.top - header.bottom, bottom: footer.bottom, listHeight: list.height, overflow: panel.right > innerWidth || panel.left < 0 || node.scrollWidth > panel.width + 1,
            cardsGap: cards.length > 1 ? cards[1].top - cards[0].bottom : 0 };
        });
        assert(measurements.gap >= 16 && measurements.gap <= 24);
        assert(measurements.bottom <= 915 && measurements.listHeight > 40);
        assert.equal(measurements.overflow, false);
        assert(measurements.cardsGap >= 9);
        if (width === 412 && dark) await page.screenshot({ path: "verification/assignment-493/" + type + "-dark.png", fullPage: true });
        await page.getByRole("button", { name: "Fechar seleção", exact: true }).click();
      }
    });
  }
  await run("Short landscape keeps list, footer and explicit search available", async () => {
    await page.setViewportSize({ width: 740, height: 390 }); await reset();
    await open("vehicle");
    const footer = await page.locator(".nvu-assignment-picker-footer").boundingBox();
    assert(footer.y + footer.height <= 390);
    assert((await page.locator(".nvu-assign-picker-list").boundingBox()).height > 30);
    await page.getByRole("button", { name: "Fechar seleção", exact: true }).click();
  });
  assert.deepEqual(errors, []);
  assert.equal(remoteRequests, 0);
  fs.mkdirSync("reports", { recursive: true });
  fs.writeFileSync("reports/assignment-approved-493-ui.json", JSON.stringify({ result: "PASS", actualComponents: ["AssignJob", "AssignJobAssetPicker"], productionCSS: true, keyboardCheck: "Dialog receives focus; search only on explicit touch. Android system keyboard not physically tested.", productionAccess: false, physicalDeviceTested: false, results }, null, 2));
  console.log("ASSIGNMENT_APPROVED_493_UI_PASS " + results.length + " checks");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
