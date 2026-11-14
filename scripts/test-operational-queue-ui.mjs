import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
const require = createRequire(import.meta.url),
  playwright = process.env.NVU_PLAYWRIGHT_MODULE
    ? await import(pathToFileURL(process.env.NVU_PLAYWRIGHT_MODULE))
    : require("playwright");
const root = process.cwd(),
  evidence = path.resolve(process.env.NVU_UI_EVIDENCE || "../evidence"),
  fixture = path.join(root, "scripts/fixtures/queue-context.tsx");
fs.mkdirSync(evidence, { recursive: true });
const server = await createServer({
  configFile: false,
  root,
  plugins: [react(), tailwind()],
  optimizeDeps: {
    noDiscovery: true,
    entries: ["scripts/fixtures/operational-queues.html"],
    include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react", "sonner"],
  },
  resolve: {
    alias: [
      {
        find: /^.*\/contexts\/AutomaticOperationsProvider(?:\.tsx)?$/,
        replacement: fixture,
      },
      { find: /^.*\/context\/AppContext(?:\.tsx)?$/, replacement: fixture },
      { find: "@", replacement: root },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 4179,
    strictPort: true,
    watch: null,
    hmr: false,
  },
});
await server.listen();
const browser = await playwright.chromium.launch({
  headless: true,
  ...(process.env.NVU_CHROMIUM_PATH
    ? {
        executablePath: process.env.NVU_CHROMIUM_PATH,
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-zygote",
        ],
      }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
let remoteBlocked = 0;
await context.route("**/*", (route) => {
  const u = new URL(route.request().url());
  if (!["127.0.0.1", "localhost"].includes(u.hostname)) {
    remoteBlocked++;
    return route.abort();
  }
  return route.continue();
});
const page = await context.newPage(),
  errors = [];
page.setDefaultTimeout(8000);
// Vite's first dependency/CSS compilation is separate from an app interaction.
page.setDefaultNavigationTimeout(60000);
page.on("pageerror", (e) => errors.push(e.message));
const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, result: "PASS" });
    console.log(`PASS ${name}`);
  } catch (e) {
    await page
      .screenshot({
        path: path.join(evidence, `ui-failure-${results.length}.png`),
        fullPage: true,
      })
      .catch(() => {});
    fs.writeFileSync(
      path.join(evidence, `ui-failure-${results.length}.txt`),
      await page.locator("body").innerText(),
    );
    results.push({ name, result: "FAIL", error: e.stack });
    console.error(`FAIL ${name}`, e);
  }
}
const reset = async (options) => {
  await page.evaluate((options) => window.__queues.reset(options), options);
  await page.waitForTimeout(60);
};
const calls = () => page.evaluate(() => window.__queues.calls());
try {
  await page.goto(
    "http://127.0.0.1:4179/scripts/fixtures/operational-queues.html",
  );
  await page
    .getByRole("heading", { name: "Fila operacional", exact: true })
    .waitFor({ timeout: 60000 });
  await test("driver sees pending operations, keeps completed progress and can inspect the route", async () => {
    await page.getByRole("button", { name: "Ver fila completa", exact: true }).click();
    assert.equal(await page.locator("details").count(), 2);
    assert.equal(await page.locator("details[open]").count(), 0);
    assert.equal(await page.locator("details").getByText("Entrega no porto", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("progressbar").getAttribute("aria-valuetext"), "1 de 3 realizadas");
    await page.locator("details").getByText("Coleta de grãos", { exact: true }).click();
    assert.match(
      await page.locator("details[open]").innerText(),
      /Curitiba → Santos/,
    );
    await page.screenshot({
      path: path.join(evidence, "motorista-fila-mobile.png"),
      fullPage: true,
    });
  });
  await test("compact available vehicle cards confirm the chosen vehicle exactly once", async () => {
    await page
      .getByRole("button", { name: "Iniciar trabalho", exact: true })
      .click();
    const modal = page.getByRole("dialog");
    assert.equal(await modal.locator("img").count(), 0);
    assert.equal(await modal.getByRole("radio").count(), 2);
    assert.equal(
      await modal
        .getByRole("button", { name: "Confirmar e iniciar" })
        .isEnabled(),
      true,
    );
    await modal.getByLabel(/Volvo/).check();
    await page.screenshot({
      path: path.join(evidence, "motorista-escolher-veiculo-mobile.png"),
      fullPage: true,
    });
    await modal.getByRole("button", { name: "Confirmar e iniciar" }).click();
    await modal.waitFor({ state: "hidden" });
    const starts = (await calls()).filter((c) => c.action === "start");
    assert.equal(starts.length, 1);
    assert.equal(starts[0].vehicleId, "v2");
    assert.equal(starts[0].next.contractId, "c2");
  });
  await test("a changed queue disables an already open confirmation", async () => {
    await reset({});
    await page
      .getByRole("button", { name: "Iniciar trabalho", exact: true })
      .click();
    await page.evaluate(() => window.__queues.setScenario("stale"));
    await page.getByRole("alert").waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Confirmar e iniciar" })
        .isDisabled(),
      true,
    );
    assert.match(await page.getByRole("alert").innerText(), /atualizados/);
    await page.getByRole("button", { name: "Voltar", exact: true }).click();
    assert.equal((await calls()).filter((c) => c.action === "start").length, 0);
  });
  await test("a saved offline queue remains readable and stages the selected operation once", async () => {
    await reset({ scenario: "offline", dark: true });
    assert.equal(
      await page
        .getByRole("button", { name: "Iniciar trabalho", exact: true })
        .isDisabled(),
      false,
    );
    await page.getByRole("button", { name: "Ver fila completa", exact: true }).click();
    assert.equal(await page.locator("details").count(), 2);
    assert.match(await page.getByRole("status").first().innerText(), /Sem conexão.*sincronizar depois/);
    await page.screenshot({
      path: path.join(evidence, "motorista-offline-mobile-dark.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Iniciar trabalho", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirmar e iniciar", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    const starts = (await calls()).filter((c) => c.action === "start");
    assert.equal(starts.length, 1);
    assert.equal(starts[0].next.contractId, "c2");
    assert.equal(starts[0].vehicleId, "v1");
  });
  await test("an offline view without a saved snapshot cannot stage an operation", async () => {
    await reset({ scenario: "offline-no-cache" });
    assert.equal(await page.getByRole("button", { name: "Iniciar trabalho", exact: true }).isDisabled(), true);
    assert.equal((await calls()).filter((c) => c.action === "start").length, 0);
  });
  await test("manager creates a selected-driver queue through three steps without an early write", async () => {
    await reset({ role: "manager", empty: true });
    await page.getByRole("button", { name: "Nova fila", exact: true }).click();
    assert.match(await page.getByRole("dialog").innerText(), /Etapa 1 de 3/);
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByLabel("Motoristas específicos", { exact: true }).check();
    assert.equal(
      await page
        .getByRole("button", { name: "Continuar", exact: true })
        .isDisabled(),
      true,
    );
    await page.getByLabel("Ana Costa", { exact: true }).check();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    assert.equal((await calls()).length, 0);
    await page.getByRole("button", { name: "Descer Entrega no porto" }).click();
    await page.screenshot({
      path: path.join(evidence, "gestor-criar-fila-mobile.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Ativar fila", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Nova fila", exact: true })
      .waitFor();
    const save = (await calls()).find((c) => c.action === "saveQueue");
    assert.deepEqual(save.queue.orderIds, ["c2", "c1"]);
    assert.deepEqual(save.queue.driverIds, ["d2"]);
  });
  await test("blocked activation opens actionable preparation and preserves the queue draft without writes", async () => {
    await reset({ role: "manager", empty: true, scenario: "preparation-blocked" });
    await page.getByRole("button", { name: "Nova fila", exact: true }).click();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByRole("button", { name: "Descer Entrega no porto" }).click();
    await page.getByRole("button", { name: "Ativar fila", exact: true }).click();
    await page.getByRole("region", { name: "Conferência de trabalhos" }).waitFor();
    assert.equal((await calls()).length, 0);
    assert.match(await page.getByRole("dialog").innerText(), /Etapa 3 de 3/);
    assert.equal(await page.getByRole("button", { name: /Corrigir 1 cadastro/ }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Manter selecionado e cancelar os demais" }).isDisabled(), true);
    await page.screenshot({ path: path.join(evidence, "gestor-preparacao-bloqueada-390.png"), fullPage: true });
  });
  await test("manager confirms compatible repair and explicitly chooses the surviving job before activation", async () => {
    const region = page.getByRole("region", { name: "Conferência de trabalhos" });
    await region.getByLabel(/Confirmo a atualização dos campos/).check();
    await region.getByRole("button", { name: /Corrigir 1 cadastro/ }).click();
    await region.getByLabel(/Manter Entrega no porto/).waitFor();
    assert.equal((await calls()).filter((call) => call.action === "normalizeLegacyJobs").length, 1);
    assert.equal((await calls()).filter((call) => call.action === "saveQueue").length, 0);
    assert.equal(await region.getByRole("button", { name: "Manter selecionado e cancelar os demais" }).isDisabled(), true);
    await region.getByLabel(/Manter Entrega no porto/).check();
    await region.getByLabel(/Confirmo o cancelamento dos/).check();
    await region.getByRole("button", { name: "Manter selecionado e cancelar os demais" }).click();
    const resolution = (await calls()).find((call) => call.action === "resolveLegacyConflict");
    assert.equal(resolution.keepJobId, "old-1"); assert.equal(resolution.confirmed, true);
    const enableConfirmation = page.getByRole("checkbox", {
      name: "Confirmo habilitar os comandos operacionais desta empresa",
      exact: true,
    });
    await enableConfirmation.waitFor();
    assert.equal(await page.getByRole("button", { name: "Ativar fila", exact: true }).isDisabled(), true);
    assert.equal((await calls()).some((call) => call.action === "enableOperationalCommands"), false);
    assert.equal((await calls()).some((call) => call.action === "saveQueue"), false);
    await enableConfirmation.check();
    await page.getByRole("button", { name: "Ativar fila", exact: true }).click();
    await page.getByRole("button", { name: "Nova fila", exact: true }).waitFor();
    const finalCalls = await calls();
    const actions = finalCalls.map((call) => call.action);
    assert.ok(actions.indexOf("enableOperationalCommands") >= 0);
    assert.ok(actions.indexOf("enableOperationalCommands") < actions.indexOf("saveQueue"));
    const save = finalCalls.find((call) => call.action === "saveQueue");
    assert.deepEqual(save.queue.orderIds, ["c2", "c1"]);
    assert.equal(save.expectedRevision, 3);
  });
  await test("manager reorders queues with cancel and explicit save", async () => {
    await reset({ role: "manager" });
    await page
      .getByRole("button", { name: "Organizar filas", exact: true })
      .click();
    await page.getByRole("button", { name: "Descer Rotas da semana" }).click();
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal((await calls()).length, 0);
    await page
      .getByRole("button", { name: "Organizar filas", exact: true })
      .click();
    await page.getByRole("button", { name: "Descer Rotas da semana" }).click();
    await page
      .getByRole("button", { name: "Salvar ordem", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Nova fila", exact: true })
      .waitFor();
    assert.deepEqual(
      (await calls()).find((c) => c.action === "reorderQueues").queueIds,
      ["f2", "f1"],
    );
  });
  await test("manager sees the short guide and a clear next step when there are no folders", async () => {
    await reset({ role: "manager", noFolders: true });
    assert.equal(await page.getByRole("button", { name: "Nova fila", exact: true }).isDisabled(), true);
    assert.match(await page.getByRole("dialog").innerText(), /Comece pelas operações e pastas/);
    await page.getByText("Como funciona o envio automático?", { exact: true }).click();
    assert.match(await page.getByRole("dialog").innerText(), /escolhe o veículo e confirma o início/);
    assert.match(await page.getByRole("dialog").innerText(), /Cada motorista tem seu próprio progresso/);
    assert.equal((await calls()).length, 0);
  });
  await test("actions open one centered modal and pause and resume only the selected queue", async () => {
    await reset({ role: "manager" });
    await page.getByRole("button", { name: "Ações da fila Rotas da semana", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Ações da fila", exact: true });
    assert.equal(await page.getByRole("dialog").count(), 1);
    assert.match(await modal.innerText(), /Quem já iniciou uma operação pode continuar/);
    assert.equal((await calls()).length, 0);
    await modal.getByRole("button", { name: /^Pausar fila/ }).click();
    await page.getByRole("dialog", { name: "Filas operacionais", exact: true }).waitFor();
    assert.deepEqual((await calls()).filter((c) => c.action === "setState").map((c) => [c.queueId, c.state, c.expectedRevision]), [["f1", "paused", 1]]);
    await page.getByRole("button", { name: "Ações da fila Rotas da semana", exact: true }).click();
    await page.getByRole("button", { name: /^Retomar fila/ }).click();
    await page.getByRole("dialog", { name: "Filas operacionais", exact: true }).waitFor();
    assert.deepEqual((await calls()).filter((c) => c.action === "setState").map((c) => [c.queueId, c.state, c.expectedRevision]), [["f1", "paused", 1], ["f1", "active", 2]]);
  });
  await test("removal requires a second confirmation and cancel leaves the queue unchanged", async () => {
    await reset({ role: "manager" });
    await page.getByRole("button", { name: "Ações da fila Rotas da semana", exact: true }).click();
    await page.getByRole("button", { name: /^Remover fila/ }).click();
    assert.equal((await calls()).length, 0);
    assert.match(await page.getByRole("dialog").innerText(), /os trabalhos em andamento e o histórico serão mantidos/);
    await page.getByRole("button", { name: "Voltar", exact: true }).click();
    assert.equal((await calls()).length, 0);
    await page.getByRole("button", { name: /^Remover fila/ }).click();
    await page.getByRole("button", { name: "Confirmar remoção", exact: true }).click();
    await page.getByRole("dialog", { name: "Filas operacionais", exact: true }).waitFor();
    const states = (await calls()).filter((c) => c.action === "setState");
    assert.equal(states.length, 1);
    assert.equal(states[0].queueId, "f1");
    assert.equal(states[0].state, "archived");
    const catalog = await page.evaluate(() => window.__queues.catalog());
    assert.equal(catalog.contracts.length, 3);
    assert.equal(catalog.folders.length, 2);
    assert.equal(await page.getByRole("button", { name: "Ações da fila Rotas da semana", exact: true }).count(), 0);
  });
  await test("offline and newly changed settings block actions without a write", async () => {
    for (const scenario of ["offline", "manager-stale"]) {
      await reset({ role: "manager" });
      await page.getByRole("button", { name: "Ações da fila Rotas da semana", exact: true }).click();
      await page.evaluate((value) => window.__queues.setScenario(value), scenario);
      await page.getByRole("alert").waitFor();
      assert.equal(await page.getByRole("button", { name: /^Pausar fila/ }).isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: /^Remover fila/ }).isDisabled(), true);
      assert.equal((await calls()).length, 0);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog", { name: "Filas operacionais", exact: true }).waitFor();
    }
  });
  await test("a failed mutation stays visible and a rapid double tap sends one request", async () => {
    await reset({ role: "manager", scenario: "save-failed" });
    await page.getByRole("button", { name: "Ações da fila Rotas da semana", exact: true }).click();
    await page.getByRole("button", { name: /^Pausar fila/ }).click();
    assert.match(await page.getByRole("alert").innerText(), /Não foi possível confirmar/);
    assert.equal(await page.getByRole("dialog", { name: "Ações da fila", exact: true }).count(), 1);
    assert.equal((await page.evaluate(() => window.__queues.catalog())).settings.queues[0].state, "active");
    await reset({ role: "manager", scenario: "save-slow" });
    await page.getByRole("button", { name: "Ações da fila Rotas da semana", exact: true }).click();
    await page.getByRole("button", { name: /^Pausar fila/ }).evaluate((button) => { button.click(); button.click(); });
    await page.getByRole("dialog", { name: "Filas operacionais", exact: true }).waitFor();
    assert.equal((await calls()).filter((c) => c.action === "setState").length, 1);
  });
  await test("action cards fit narrow screens in both themes and focus remains inside the active modal", async () => {
    for (const width of [320, 390, 1280]) {
      for (const dark of [false, true]) {
        await page.setViewportSize({ width, height: 844 });
        await reset({ role: "manager", dark });
        await page.getByRole("button", { name: "Ações da fila Rotas da semana", exact: true }).click();
        const modal = page.getByRole("dialog", { name: "Ações da fila", exact: true }), box = await modal.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width);
        assert.ok(box.y > 0 && box.y + box.height < 844);
        assert.ok(Math.abs((box.y + box.height / 2) - 422) < 2);
        assert.equal(await modal.evaluate((node) => node.scrollWidth > node.clientWidth), false);
        await modal.getByRole("button", { name: "Fechar", exact: true }).focus();
        await page.keyboard.press("Shift+Tab");
        assert.equal(await modal.evaluate((node) => node.contains(document.activeElement)), true);
        await page.screenshot({ path: path.join(evidence, `acoes-fila-${width}-${dark ? "escuro" : "claro"}.png`), fullPage: true });
        await page.keyboard.press("Escape");
        await page.getByRole("dialog", { name: "Filas operacionais", exact: true }).waitFor();
        assert.equal(await page.getByRole("dialog").count(), 1);
        assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await test("manager can save an empty per-driver selection and restore inheritance", async () => {
    await reset({ role: "manager", dark: true });
    await page.getByRole("tab", { name: "Veículos", exact: true }).click();
    await page.getByRole("button", { name: "Aplicar a", exact: true }).click();
    await page.getByRole("dialog", { name: "Aplicar disponibilidade", exact: true }).getByRole("option", { name: "João Silva", exact: true }).click();
    await page.getByLabel("Usar padrão da frota", { exact: true }).uncheck();
    await page.getByRole("button", { name: "Limpar", exact: true }).click();
    await page.screenshot({
      path: path.join(evidence, "gestor-veiculos-mobile-dark.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Salvar seleção", exact: true })
      .click();
    await page.waitForTimeout(120);
    assert.match(await page.getByRole("button", { name: "Aplicar a", exact: true }).innerText(), /João Silva/);
    const saved = (await calls()).find((c) => c.action === "saveVehicles");
    assert.deepEqual(saved.vehicleIds, []);
    assert.equal(saved.useDefault, false);
    await page.getByLabel("Usar padrão da frota", { exact: true }).check();
    await page
      .getByRole("button", { name: "Salvar seleção", exact: true })
      .click();
    await page.waitForTimeout(120);
    assert.equal(
      (await calls()).filter((c) => c.action === "saveVehicles").at(-1)
        .useDefault,
      true,
    );
  });
  await test("historical ambiguity requires explicit manager attestation", async () => {
    await reset({ role: "manager" });
    await page
      .getByRole("tab", { name: "Progresso", exact: true })
      .click();
    await page.getByRole("button", { name: "Motorista para acompanhamento", exact: true }).click();
    await page.getByRole("dialog", { name: "Motorista da fila", exact: true }).getByRole("option", { name: "João Silva", exact: true }).click();
    await page
      .getByRole("button", { name: "Conferir histórico", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: "Salvar conferência" })
        .isDisabled(),
      true,
    );
    await page.getByLabel(/Entrega no porto/).check();
    await page
      .getByLabel(
        "Confirmo que conferi os trabalhos realizados por este motorista.",
        { exact: true },
      )
      .check();
    await page.getByRole("button", { name: "Salvar conferência" }).click();
    await page.waitForTimeout(120);
    const saved = (await calls()).find((c) => c.action === "reviewHistory");
    assert.deepEqual(saved.doneIds, ["c1"]);
    assert.deepEqual(saved.reviewedIds, ["c1", "c2"]);
    assert.equal(saved.confirmed, true);
  });
  await test("desktop and mobile dialogs fit the viewport and keyboard focus stays inside", async () => {
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await reset({ role: "manager", dark: width === 320 });
      const modal = page.getByRole("dialog"),
        box = await modal.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: path.join(evidence, `gestor-filas-${width}.png`),
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "Fechar", exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    assert.equal(
      await page
        .getByRole("dialog")
        .evaluate((node) => node.contains(document.activeElement)),
      true,
    );
    await page.keyboard.press("Escape");
    await page.getByText("Fechado", { exact: true }).waitFor();
  });
  await test("isolated presentation fixture has no runtime errors or external requests", async () => {
    assert.deepEqual(errors, []);
    assert.equal(remoteBlocked, 0);
  });
} finally {
  fs.writeFileSync(
    path.join(evidence, "queue-ui-cases.json"),
    JSON.stringify(
      { browser: browser.version(), remoteBlocked, errors, results },
      null,
      2,
    ),
  );
  await browser.close();
  await server.close();
}
console.log(
  `OPERATIONAL_QUEUE_UI ${results.filter((r) => r.result === "PASS").length}/${results.length} PASS`,
);
if (results.some((r) => r.result !== "PASS")) process.exitCode = 1;
