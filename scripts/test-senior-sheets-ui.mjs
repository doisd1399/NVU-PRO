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
export const db = {}; export const auth = {}; export const storage = {};
export const doc = () => ({}); export const onSnapshot = () => () => {};
`;
const adapters = new Set(["AppContext.tsx", "appGuidesService.ts", "privateUserProfiles.ts", "seniorAccountAdministrationService.ts", "firebase.ts"]);
const bundle = await build({
  stdin: { resolveDir: root, sourcefile: "senior-sheets-ui.tsx", loader: "tsx", contents: `
import React, { useState } from "react";import { createRoot } from "react-dom/client";import { MemoryRouter } from "react-router-dom";
import { SeniorOptionsSheet } from "./src/components/admin/SeniorOptionsSheet";
import { SeniorMemberActions } from "./src/components/admin/SeniorMemberActions";
import { AppGuidesManagerModal } from "./src/components/admin/AppGuidesManagerModal";
import Manual from "./src/pages/Manual";
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
    await check(`Manual: resumo dos dois guias, botões de download e instruções (${theme}, ${name})`, async () => {
      const { context, page } = await open("manual", { theme, viewport, role: "admin" });
      await page.getByRole("heading", { name: "Guia do Empresário" }).waitFor();
      for (const heading of ["Guia do Motorista", "Guia do Empresário"]) assert(await page.getByRole("heading", { name: heading }).isVisible(), heading);
      assert.equal(await page.locator("[data-guide-card]").count(), 2);
      assert.deepEqual(await page.locator("[data-guide-card]").evaluateAll(cards => cards.map(card => card.getAttribute("data-guide-card"))), ["company", "driver"], "admin sees the company guide first");
      assert.equal(await page.getByRole("button", { name: /Baixar Guia do Motorista/ }).count(), 1);
      assert(await page.getByText("Como usar os guias").isVisible());
      assert(await page.getByText("Etapa 1 · Prepare sua empresa").isVisible());
      assert(await page.getByText("Etapa 3 · Conclua no prazo").isVisible());
      assert(await page.getByText("Guia que acompanha o aplicativo").first().isVisible());
      assert.equal(await page.getByText("Pinturas dos veículos").count(), 0, "generic app manual is gone");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no horizontal scroll");
      await page.locator("details").first().evaluate(element => { element.open = true; });
      await shot(page, `manual-${theme}-${name}`);
      await context.close();
    });
  }
  await check("Manual: guia enviado pelo Sênior aparece com data e tamanho e o botão baixa o arquivo novo", async () => {
    const { context, page } = await open("manual");
    await page.evaluate(() => window.__seedGuide("driver", { updatedAt: new Date("2026-11-06T15:00:00Z"), size: 800000 }));
    const card = page.locator('[data-guide-card="driver"]');
    await card.waitFor();
    assert.equal(await card.getAttribute("data-guide-source"), "uploaded");
    const text = await card.innerText();
    assert(text.includes("Atualizado pela NVU") && text.includes("06/11/2026") && /781 KB|0,8 MB/.test(text), text);
    const [popup] = await Promise.all([context.waitForEvent("page", { timeout: 4000 }).catch(() => null), card.getByRole("button", { name: /Baixar/ }).click()]);
    await context.close();
  });
  assert.deepEqual(errors, [], "page errors: " + errors.join("; "));
  assert.deepEqual(outbound.filter(url => !/firebasestorage\.googleapis\.com/.test(url)), [], "no unexpected outbound requests");
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify({ ok: true, results, outbound }, null, 1));
  console.log(`PASS senior sheets UI: ${results.length} checks`);
} finally { await browser.close(); }
