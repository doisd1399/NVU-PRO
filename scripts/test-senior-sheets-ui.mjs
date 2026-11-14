import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Painel Sênior no visual de painel inferior (igual a "Informações da operação") + página Manual com os guias.
// Telas reais (SeniorOptionsSheet, SeniorMemberActions, AppGuidesManagerModal, Manual) com o CSS de produção; só sessão, Firebase e
// os serviços de guias/administração são substituídos por registros locais. Nada aqui toca um projeto Firebase.
const root = process.cwd();
const output = path.resolve(process.env.NVU_SENIOR_SHEETS_QA_DIR || "verification/senior-sheets");
await fs.mkdir(output, { recursive: true });
let playwright;
try { playwright = await import("playwright"); }
catch { playwright = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright/index.mjs")).href); }
const cssFiles = (await fs.readdir("dist/assets")).filter(name => name.endsWith(".css")).sort((a, b) => Number(!a.startsWith("index-")) - Number(!b.startsWith("index-")));
assert(cssFiles.some(name => name.startsWith("index-")), "Build the app before running the UI check");
const css = (await Promise.all(cssFiles.map(name => fs.readFile(path.join("dist/assets", name), "utf8")))).join("\n");

const fixtures = `
export const calls = (window.__calls = []);
let records = {}; let listeners = new Set();
const emit = () => listeners.forEach(fn => fn({ ...records }));
export const useSessionStore = () => ({ currentUser: { id: "senior-qa", name: "Sênior QA" }, activeRole: window.__role || "driver" });
export const watchAppGuides = fn => { listeners.add(fn); fn({ ...records }); return () => listeners.delete(fn); };
window.__seedGuide = (id, patch) => { records = { ...records, [id]: { id, fileName: "Guia.pdf", storagePath: "app-guides/" + id + "/1-guia.pdf", downloadUrl: "https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media&token=t", size: 2411724, contentType: "application/pdf", updatedAt: new Date("2026-11-06T12:00:00Z"), ...patch } }; emit(); };
export const uploadAppGuide = async (id, file, by, previous) => { calls.push({ type: "upload", id, name: file.name, by, previous: previous?.storagePath || null }); window.__seedGuide(id, { fileName: file.name, size: file.size }); };
export const deleteAppGuide = async (id, record) => { calls.push({ type: "delete", id, path: record.storagePath }); const next = { ...records }; delete next[id]; records = next; emit(); };
export const watchPrivateUser = () => () => {};
export const suspendSeniorAccount = async (...a) => { calls.push({ type: "suspend", args: a }); };
export const removeDriverFromFleetSenior = async (...a) => { calls.push({ type: "remove", args: a }); };
export const reactivateSeniorAccount = async (...a) => { calls.push({ type: "reactivate", args: a }); };
export const reverseSeniorSuspension = async (...a) => { calls.push({ type: "reverse", args: a }); };
export const endSeniorOperationalSuspension = async (...a) => { calls.push({ type: "end", args: a }); };
export const deleteSeniorProfile = async (...a) => { calls.push({ type: "delete-profile", args: a }); };
export const seniorCancelOperation = async (company, job, all) => { calls.push({ type: "support-cancel", company: company.id, job: job.id, others: all.length }); if (window.__supportFail) { const e = new Error("A empresa ainda não foi preparada."); e.code = "functions/failed-precondition"; throw e; } };
export const seniorChangeOperationVehicle = async (companyId, jobId, vehicleId) => { calls.push({ type: "support-vehicle", companyId, jobId, vehicleId }); };
export const supportFailureMessage = (error, fallback) => error?.code === "functions/failed-precondition" ? error.message : fallback;
export const db = {}; export const auth = {}; export const storage = {};
export const doc = () => ({}); export const onSnapshot = () => () => {};
`;
const adapters = new Set(["AppContext.tsx", "seniorOperationSupportService.ts", "appGuidesService.ts", "privateUserProfiles.ts", "seniorAccountAdministrationService.ts", "firebase.ts"]);
const bundle = await build({
  stdin: { resolveDir: root, sourcefile: "senior-sheets-ui.tsx", loader: "tsx", contents: `
import React, { useState } from "react";import { createRoot } from "react-dom/client";import { MemoryRouter } from "react-router-dom";
import { SeniorOptionsSheet } from "./src/components/admin/SeniorOptionsSheet";
import { SeniorMemberActions } from "./src/components/admin/SeniorMemberActions";
import { AppGuidesManagerModal } from "./src/components/admin/AppGuidesManagerModal";
import Manual from "./src/pages/Manual";
import { SeniorOperationsSupport } from "./src/components/admin/SeniorOperationsSupport";
function SeniorSupportStage() {
  const [jobs, setJobs] = useState([
    { id: "old-active-0001", companyId: "c1", driverId: "dudu", vehicleId: "v1", status: "active", contractNameSnapshot: "A.10", progress: 3, totalDeliveries: 10, assignedAt: "2026-10-01T10:00:00Z" },
    { id: "A70-pending-0002", companyId: "c1", driverId: "dudu", vehicleId: "v1", status: "pending", contractNameSnapshot: "A.70", progress: 0, totalDeliveries: 12, assignedAt: "2026-11-05T10:00:00Z", operationalCommandVersion: 1 },
    { id: "done-0003", companyId: "c1", driverId: "dudu", vehicleId: "v1", status: "completed", contractNameSnapshot: "A.01" },
    { id: "other-0004", companyId: "c2", driverId: "x", vehicleId: "v9", status: "active", contractNameSnapshot: "Z.9" },
    { id: "member-0005", companyId: "c1", driverId: "ativo", vehicleId: "v2", status: "delayed", contractNameSnapshot: "B.2", progress: 1, totalDeliveries: 5, assignedAt: "2026-10-10T10:00:00Z" },
  ]);
  window.__jobs = jobs;
  return <SeniorOperationsSupport company={{ id: "c1", companyName: "Tijoleira" }} jobs={jobs} users={[{ id: "dudu", firstName: "Dudu", lastName: "Tv" }, { id: "ativo", firstName: "Ana", lastName: "Souza" }]} members={[{ companyId: "c1", userId: "ativo", status: "active" }, { companyId: "c2", userId: "dudu", status: "active" }]}
    vehicles={[{ id: "v1", companyId: "c1", name: "Scania G R 540", status: "in_use" }, { id: "v2", companyId: "c1", name: "Volvo FH12", plate: "ABC-1D23", status: "available" }, { id: "v3", companyId: "c1", name: "Em oficina", status: "maintenance" }, { id: "v9", companyId: "c2", name: "De outra empresa", status: "available" }]}
    onChanged={(id, patch) => setJobs(current => current.map(job => job.id === id ? { ...job, ...patch } : job))} />;
}
function Stage() {
  const [view, setView] = useState(new URLSearchParams(location.search).get("view") || "manual");
  window.__setView = setView;
  const [picked, setPicked] = useState("");
  window.__picked = picked;
  return <div className="nvu-central-shell" style={{ minHeight: "100dvh", padding: 12 }}>
    {view === "manual" && <Manual />}
    {view === "options" && <SeniorOptionsSheet onClose={() => setView("closed")} onSelect={id => { setPicked(id); window.__selected = id; if (id === "guides") setView("guides"); }} />}
    {view === "guides" && <AppGuidesManagerModal onClose={() => setView("closed")} />}
    {view === "member" && <SeniorMemberActions member={{ userId: "u1", suspension: window.__qaSuspension }} user={{ firstName: "Marcos", lastName: "Oliveira", email: "marcos@exemplo.com", accountStatus: window.__qaAccountStatus || "active" }} companyId="c1" companyName="Matecom" triggerLabel="Ações" />}
    {view === "support" && <SeniorSupportStage />}
    {view === "closed" && <p data-testid="closed">fechado</p>}
  </div>;
}
createRoot(document.getElementById("root")).render(<MemoryRouter><Stage /></MemoryRouter>);
` },
  bundle: true, write: false, outfile: path.join(output, "fixture.js"), format: "iife", platform: "browser", jsx: "automatic", loader: { ".css": "empty" }, logLevel: "error",
  define: { "process.env.NODE_ENV": '"test"', "import.meta.env.BASE_URL": '"/"', "import.meta.env.PROD": "false", "import.meta.env.DEV": "false" },
  plugins: [{ name: "senior-sheets-adapters", setup(plugin) {
    plugin.onResolve({ filter: /^qa-fixtures$/ }, () => ({ path: "fixtures", namespace: "qa-fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "qa-fixture" }, () => ({ contents: fixtures, resolveDir: root, loader: "js" }));
    plugin.onResolve({ filter: /^firebase\/(firestore|storage|auth)$/ }, () => ({ path: "fixtures", namespace: "qa-fixture" }));
    plugin.onLoad({ filter: /src\/.*\.tsx?$/ }, args => adapters.has(path.basename(args.path)) ? { contents: 'export * from "qa-fixtures";', loader: "ts", resolveDir: root } : undefined);
  } }],
});
const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const ORIGIN = "http://127.0.0.1:43831";
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${css}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.NVU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NVU_CHROMIUM_EXECUTABLE } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const errors = [], outbound = [], results = [];
async function check(name, run) { await run(); results.push({ name, pass: true }); console.log("PASS " + name); }
async function open(view, { theme = "dark", viewport = { width: 390, height: 844 }, role = "driver", seed } = {}) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600, deviceScaleFactor: 1, timezoneId: "America/Sao_Paulo" });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") { outbound.push(url.href); return route.abort(); }
    if (url.pathname.endsWith(".woff2")) return route.fulfill({ contentType: "font/woff2", body: await fs.readFile(path.join(root, "public", url.pathname)).catch(() => Buffer.alloc(0)) });
    return route.fulfill({ contentType: "text/html", body: html.replace("<html>", `<html${theme === "dark" ? " class=\"dark\"" : ""}>`) });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(([role, seed]) => { window.__role = role; if (seed) Object.assign(window, seed); }, [role, seed || null]);
  await page.goto(ORIGIN + "/?view=" + view);
  return { context, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(output, name + ".png") });
const sheetAtBottom = async page => {
  const box = await page.locator(".nvu-central-sheet").boundingBox();
  const vh = page.viewportSize().height;
  assert(box, "sheet visible"); assert(Math.abs(box.y + box.height - vh) <= 1, `sheet must touch the bottom (${box.y + box.height} vs ${vh})`);
  assert(box.height <= vh - 8, "sheet must not cover the whole screen");
  return box;
};
try {
  for (const theme of ["dark", "light"]) {
    await check(`Opções do Painel Sênior é um painel inferior com grupos e atalhos (${theme})`, async () => {
      const { context, page } = await open("options", { theme });
      await page.getByTestId("senior-options-sheet").waitFor();
      await sheetAtBottom(page);
      assert.equal(await page.locator(".nvu-central-sheet > header h2").textContent(), "Opções");
      for (const label of ["Gerenciar comunicados", "Gerenciar guias", "Gerenciar simuladores", "Gerenciar cidades", "Controle de envio de viagens", "Membros suspensos"]) assert(await page.getByText(label, { exact: true }).isVisible(), label);
      assert.equal(await page.locator(".nvu-senior-group").count(), 3);
      assert.equal(await page.locator(".nvu-central-overlay-sheet").count(), 1, "same overlay as Informações da operação");
      await shot(page, `options-${theme}`);
      await context.close();
    });
  }
  await check("Opções fecha antes de abrir a escolha e o botão Fechar/overlay fecham o painel", async () => {
    const { context, page } = await open("options");
    await page.locator('[data-action="guides"]').click();
    await page.getByTestId("senior-guides-sheet").waitFor();
    assert.equal(await page.getByTestId("senior-options-sheet").count(), 0, "Opções closed");
    assert.equal(await page.evaluate(() => window.__selected), "guides");
    await page.getByRole("button", { name: /Fechar gerenciar guias/i }).click();
    await page.getByTestId("closed").waitFor();
    await context.close();
  });
  for (const theme of ["dark", "light"]) {
    await check(`Ações do funcionário: painel inferior com status, grupos e zona de risco (${theme})`, async () => {
      const { context, page } = await open("member", { theme });
      await page.getByRole("button", { name: "Ações", exact: true }).click();
      await page.getByTestId("senior-member-actions-sheet").waitFor();
      await sheetAtBottom(page);
      assert.equal(await page.locator(".nvu-central-sheet > header h2").textContent(), "Ações do funcionário");
      assert(await page.getByText("Marcos Oliveira", { exact: true }).isVisible());
      assert(await page.getByText("marcos@exemplo.com").isVisible());
      assert(await page.getByText("Frota: Matecom").isVisible());
      assert(await page.locator(".nvu-senior-chip", { hasText: "Conta ativa" }).isVisible());
      for (const label of ["Remover da frota", "Suspender conta", "Excluir perfil/conta"]) assert(await page.locator(".nvu-senior-action strong", { hasText: label }).isVisible(), label);
      assert.equal(await page.locator('[data-action="reactivate"]').count(), 0, "active account has no reactivate");
      await shot(page, `member-actions-${theme}`);
      await context.close();
    });
  }
  await check("Ações do funcionário: suspender exige motivo; confirmar chama o serviço com os mesmos argumentos de antes", async () => {
    const { context, page } = await open("member");
    await page.getByRole("button", { name: "Ações", exact: true }).click();
    await page.locator('[data-action="suspend"]').click();
    const confirm = page.locator(".nvu-central-dialog-actions > button").last();
    assert.equal(await confirm.isDisabled(), true, "disabled without reason");
    await page.locator(".nvu-senior-field textarea").fill("Fraude em comprovantes");
    assert.equal(await confirm.isDisabled(), false);
    await shot(page, "member-suspend-form");
    await confirm.click();
    await page.getByTestId("senior-member-actions-sheet").waitFor({ state: "detached" });
    const calls = await page.evaluate(() => window.__calls);
    assert.equal(calls.length, 1); assert.equal(calls[0].type, "suspend");
    assert.deepEqual([calls[0].args[0], calls[0].args[1], calls[0].args[3]], ["u1", "Fraude em comprovantes", "c1"]);
    await context.close();
  });
  await check("Ações do funcionário: excluir exige motivo e confirmação; remover da frota não exige motivo; Voltar volta à lista", async () => {
    const { context, page } = await open("member");
    await page.getByRole("button", { name: "Ações", exact: true }).click();
    await page.locator('[data-action="delete"]').click();
    const confirm = page.locator(".nvu-central-dialog-actions > button").last();
    await page.locator(".nvu-senior-field textarea").fill("Pedido do titular");
    assert.equal(await confirm.isDisabled(), true, "needs checkbox");
    await page.locator(".nvu-senior-check input").check();
    assert.equal(await confirm.isDisabled(), false);
    await page.getByRole("button", { name: "Voltar" }).click();
    await page.locator('[data-action="remove"]').click();
    assert.equal(await page.locator(".nvu-central-dialog-actions > button").last().isDisabled(), false);
    await page.locator(".nvu-central-dialog-actions > button").last().click();
    await page.getByTestId("senior-member-actions-sheet").waitFor({ state: "detached" });
    const calls = await page.evaluate(() => window.__calls);
    assert.equal(calls[0].type, "remove"); assert.equal(calls[0].args[0], "u1");
    await context.close();
  });
  await check("Ações do funcionário: conta suspensa oferece Reativar e Reverter (não Suspender)", async () => {
    const { context, page } = await open("member", { seed: { __qaAccountStatus: "suspended" } });
    await page.getByRole("button", { name: "Ações", exact: true }).click();
    await page.getByTestId("senior-member-actions-sheet").waitFor();
    assert(await page.locator('[data-action="reactivate"]').isVisible()); assert(await page.locator('[data-action="reverse"]').isVisible());
    assert.equal(await page.locator('[data-action="suspend"]').count(), 0);
    assert(await page.locator(".nvu-senior-chip", { hasText: "Conta suspensa" }).isVisible());
    await shot(page, "member-actions-suspended");
    await context.close();
  });
  await check("Gerenciar guias: padrão do app, enviar PDF novo, excluir com confirmação (sem depender do APK)", async () => {
    const { context, page } = await open("guides");
    await page.getByTestId("senior-guides-sheet").waitFor();
    await sheetAtBottom(page);
    assert.equal(await page.locator('[data-guide="driver"] small', { hasText: "Guia padrão que acompanha o app" }).count(), 1);
    assert.equal(await page.locator('[data-guide="driver"] [aria-label^="Excluir"]').count(), 0, "nothing to delete in the default");
    await page.getByTestId("guide-file-driver").setInputFiles({ name: "Guia-Motorista-v2.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") });
    await page.locator('[data-guide="driver"][data-source="uploaded"]').waitFor();
    assert(await page.getByText("Guia-Motorista-v2.pdf").isVisible());
    await shot(page, "guides-uploaded");
    await page.locator('[data-guide="driver"] [aria-label^="Excluir"]').click();
    await page.locator('[data-guide="driver"]').getByRole("button", { name: "Confirmar" }).click();
    await page.locator('[data-guide="driver"][data-source="bundled"]').waitFor();
    const calls = await page.evaluate(() => window.__calls);
    assert.deepEqual(calls.map(call => call.type), ["upload", "delete"]);
    assert.equal(calls[0].by, "senior-qa");
    await context.close();
  });
  for (const [theme, viewport, name] of [["dark", { width: 390, height: 844 }, "phone"], ["light", { width: 1100, height: 800 }, "desktop"]]) {
    await check(`Guias: um guia por vez com seletor, ícone no título, legenda e etapas; sem manual genérico (${theme}, ${name})`, async () => {
      const { context, page } = await open("manual", { theme, viewport, role: "admin" });
      await page.getByTestId("guides-page").waitFor();
      assert.equal(await page.locator("h1").innerText(), "Guia do Empresário", "admin sees the company guide first");
      assert.deepEqual(await page.locator('[role="tab"]').allInnerTexts(), ["Motorista", "Empresário"]);
      assert.equal(await page.locator('[role="tab"][aria-selected="true"]').innerText(), "Empresário");
      // ordem aprovada: ícone ao lado do título, legenda, depois os botões Motorista/Empresário, depois o PDF e as etapas
      const y = async selector => (await page.locator(selector).first().boundingBox()).y;
      const iconBox = await page.locator(".nvu-guides-icon").boundingBox(), titleBox = await page.locator("h1").boundingBox();
      assert(iconBox.x + iconBox.width <= titleBox.x + 1 && Math.abs((iconBox.y + iconBox.height / 2) - (titleBox.y + titleBox.height / 2)) < 8, "icon beside the title");
      assert(await y(".nvu-guides-lead") < await y(".nvu-guides-tabs"), "tabs below the legend");
      assert(await y(".nvu-guides-tabs") < await y(".nvu-guides-pdf") && await y(".nvu-guides-pdf") < await y(".nvu-guides-stage"));
      assert.equal(await page.locator(".nvu-guides-stage").count(), 3);
      assert.equal(await page.locator(".nvu-guides-stage[open]").count(), 1, "only the first stage starts open");
      assert(await page.getByText("Escolha a empresa").count() === 0 && await page.getByText("Empresa e simulador").isVisible());
      for (const gone of ["Como usar os guias", "Regras da plataforma", "Padrão do comprovante", "Central de orientação", "Pinturas dos veículos"]) assert.equal(await page.getByText(gone).count(), 0, gone);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no horizontal scroll");
      assert.equal(await page.locator('[data-guide-card="company"][data-guide-source="bundled"]').count(), 1);
      await shot(page, `guides-company-${theme}-${name}`);
      await page.locator('[data-guide-tab="driver"]').click();
      assert.equal(await page.locator("h1").innerText(), "Guia do Motorista");
      assert.equal(await page.locator('[role="tab"][aria-selected="true"]').innerText(), "Motorista");
      assert(await page.getByText("Entre na empresa certa").isVisible());
      assert.equal(await page.getByText("Empresa e simulador").count(), 0, "one guide at a time");
      assert.equal(await page.locator('[data-guide-card="driver"]').count(), 1);
      await page.locator(".nvu-guides-stage").nth(1).locator("summary").click();
      assert(await page.getByText("Registre cada viagem").isVisible(), "stages open and close");
      await shot(page, `guides-driver-${theme}-${name}`);
      await context.close();
    });
  }
  await check("Suporte do Sênior: lista todos os trabalhos em aberto da empresa (inclusive o antigo escondido) e cancela com confirmação", async () => {
    const { context, page } = await open("support");
    await page.getByTestId("senior-operations-support").waitFor();
    assert.deepEqual(await page.locator("[data-job-id]").evaluateAll(rows => rows.map(row => row.getAttribute("data-job-id"))), ["old-active-0001", "member-0005", "A70-pending-0002"], "só os abertos da empresa, em execução primeiro");
    assert.deepEqual(await page.locator("[data-orphan]").evaluateAll(chips => chips.map(chip => chip.closest("[data-job-id]").getAttribute("data-job-id"))), ["old-active-0001", "A70-pending-0002"], "só os trabalhos de quem não é mais membro (Dudu é de outra empresa) levam o aviso");
    assert(await page.locator('[data-job-id="old-active-0001"]').getByText("Motorista fora da empresa").isVisible());
    assert(await page.locator('[data-job-id="old-active-0001"]').getByText("Em andamento").isVisible());
    assert(await page.locator('[data-job-id="A70-pending-0002"]').getByText("Não iniciado").isVisible());
    assert(await page.getByText("Dudu Tv · Scania G R 540").first().isVisible());
    await shot(page, "senior-support-list");
    await page.locator('[data-job-id="old-active-0001"] [data-action="cancel"]').click();
    await page.getByTestId("senior-cancel-sheet").waitFor();
    await sheetAtBottom(page);
    assert(await page.getByText("As viagens já registradas são preservadas").isVisible());
    await page.getByRole("button", { name: "Cancelar trabalho", exact: true }).click();
    await page.getByTestId("senior-cancel-sheet").waitFor({ state: "detached" });
    const calls = await page.evaluate(() => window.__calls);
    assert.deepEqual(calls.map(call => [call.type, call.company, call.job]), [["support-cancel", "c1", "old-active-0001"]]);
    assert.equal(await page.locator('[data-job-id="old-active-0001"]').count(), 0, "sai da lista ao cancelar");
    assert.equal(await page.locator("[data-job-id]").count(), 2);
    await context.close();
  });
  await check("Suporte do Sênior: recusa do servidor aparece na tela e o trabalho continua na lista", async () => {
    const { context, page } = await open("support", { seed: { __supportFail: true } });
    await page.locator('[data-job-id="A70-pending-0002"] [data-action="cancel"]').click();
    await page.getByRole("button", { name: "Cancelar trabalho", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByRole("alert").innerText(), "A empresa ainda não foi preparada.");
    assert.equal(await page.locator("[data-job-id]").count(), 3);
    await shot(page, "senior-support-error");
    await context.close();
  });
  await check("Suporte do Sênior: trocar veículo oferece só os veículos da empresa (sem o atual, oficina ou outra empresa)", async () => {
    const { context, page } = await open("support");
    await page.locator('[data-job-id="A70-pending-0002"] [data-action="vehicle"]').click();
    await page.getByTestId("senior-vehicle-sheet").waitFor();
    await sheetAtBottom(page);
    assert.deepEqual(await page.locator("[data-vehicle-id]").evaluateAll(rows => rows.map(row => row.getAttribute("data-vehicle-id"))), ["v2"]);
    await shot(page, "senior-support-vehicle");
    await page.locator('[data-vehicle-id="v2"]').click();
    await page.getByTestId("senior-vehicle-sheet").waitFor({ state: "detached" });
    const calls = await page.evaluate(() => window.__calls);
    assert.deepEqual(calls.map(call => [call.type, call.companyId, call.jobId, call.vehicleId]), [["support-vehicle", "c1", "A70-pending-0002", "v2"]]);
    assert(await page.getByText("Dudu Tv · Volvo FH12").first().isVisible(), "a lista mostra o novo veículo");
    await context.close();
  });
  await check("Guias: motorista abre no guia do motorista", async () => {
    const { context, page } = await open("manual", { role: "driver" });
    await page.getByTestId("guides-page").waitFor();
    assert.equal(await page.locator("h1").innerText(), "Guia do Motorista");
    await context.close();
  });
  await check("Manual: guia enviado pelo Sênior aparece com data e tamanho e o botão baixa o arquivo novo", async () => {
    const { context, page } = await open("manual");
    await page.evaluate(() => window.__seedGuide("driver", { updatedAt: new Date("2026-11-06T15:00:00Z"), size: 800000 }));
    const card = page.locator('[data-guide-card="driver"]');
    await card.waitFor();
    assert.equal(await card.getAttribute("data-guide-source"), "uploaded");
    const text = await card.innerText();
    assert(text.includes("Atualizado pela NVU") && text.includes("06/11/2026") && /781 KB|0,8 MB/.test(text), text);
    const [popup] = await Promise.all([context.waitForEvent("page", { timeout: 4000 }).catch(() => null), card.click()]);
    await context.close();
  });
  assert.deepEqual(errors, [], "page errors: " + errors.join("; "));
  assert.deepEqual(outbound.filter(url => !/firebasestorage\.googleapis\.com/.test(url)), [], "no unexpected outbound requests");
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify({ ok: true, results, outbound }, null, 1));
  console.log(`PASS senior sheets UI: ${results.length} checks`);
} finally { await browser.close(); }
