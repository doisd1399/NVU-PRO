import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// The new "Editar empresa" form of the real company profile (CompanyTab inside AdminLayout and Fleet, built CSS): cover, logo, name,
// owner, WhatsApp and "Simuladores de atuação" (check adds, uncheck switches off). Only the stores and the group service are fixtures.
const root = process.cwd(), results = [], errors = [];
let playwright;
try { playwright = await import("playwright"); }
catch { playwright = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright/index.mjs")).href); }
const avatar = `data:image/png;base64,${(await fs.readFile("scripts/fixtures/central-management/avatar.png")).toString("base64")}`;
const vehicle = `data:image/jpeg;base64,${(await fs.readFile("scripts/fixtures/central-management/vehicle.jpg")).toString("base64")}`;
const cssFiles = (await fs.readdir("dist/assets")).filter(name => name.endsWith(".css")).sort((a, b) => Number(!a.startsWith("index-")) - Number(!b.startsWith("index-")));
assert(cssFiles.some(name => name.startsWith("index-")), "Build the app first");
const css = (await Promise.all(cssFiles.map(name => fs.readFile(path.join("dist/assets", name), "utf8")))).join("\n");
const baseFixtures = await fs.readFile("scripts/fixtures/company-landscape-fixtures.tsx", "utf8");
const adapters = new Set(["AppContext.tsx", "CompanyContext.tsx", "NotificationsContext.tsx", "firebase.ts", "routePreload.ts", "rankingPhotoWarmup.ts", "usePersistentRankingImage.ts", "useTripHistory.ts", "useDriverTrips.ts", "useMissingOperationTrip.ts", "SimpleAutomationCompletionBridge.tsx", "NotificationCenter.tsx", "ProfileModal.tsx", "useVehiclePhoto.ts", "workModeAvailabilityService.ts", "simpleAutomationCityService.ts", "operationIntegrityGuard.ts", "uploadService.ts", "useProfileRanking.ts", "useTripsRealtime.ts", "AutomaticOperationsProvider.tsx", "useLocalOperationPending.ts", "CanonicalTripMigrationService.ts", "CanonicalTripCommandService.ts", "CanonicalTripOperationService.ts", "syncManager.ts", "tripModerationService.ts", "ProPendingAuthButton.tsx", "ProPendingRetryButton.tsx", "ProAttemptDiagnosticDetails.tsx", "FailedHistoryRegistrationRecovery.tsx", "OperationResultModal.tsx"]);
const secondary = new Set(["VehiclesTab.tsx", "TrailersTab.tsx", "DriversTab.tsx", "ContractsTab.tsx", "RecruitmentTab.tsx", "GtoObserverSetup.tsx", "OperationsTab.tsx"]);
const groupStub = `export const loadCompanyGroupCapabilities=async()=>[...(window.__group.capabilities||[])];
export const addCompanySimulators=async(companyId,ids)=>{window.__group.calls.push(["add",companyId,ids]);if(window.__group.failAdd){const e=new Error("x");e.details={reasonCode:"GROUP_OWNER_ONLY"};throw e;}
  return {created:ids.map(id=>({companyId:companyId+"-"+id,simulatorId:id,simulatorName:id.toUpperCase().replace("-"," ")})),existing:[],reactivated:[],skipped:[]};};
export const deactivateCompanySimulators=async(companyId,ids)=>{window.__group.calls.push(["deactivate",companyId,ids]);if(window.__group.failDeactivate){const e=new Error("x");e.details={reasonCode:"GROUP_OPEN_OPERATIONS"};throw e;}
  return {deactivated:ids.map(id=>({companyId:id,simulatorId:id,simulatorName:id.toUpperCase()})),alreadyInactive:[],remaining:1};};
export const renameCompanyGroup=async(companyId,name)=>{window.__group.calls.push(["rename",companyId,name]);return {companyName:name,updated:1};};`;

const catalog = text => text.replace("simulators:[{id:'gto',name:'GTO'},{id:'wbds',name:'WBDS'}]", "simulators:[{id:'gto',name:'GTO'},{id:'wbds',name:'WBDS'},{id:'ats',name:'ATS'},{id:'ets-2',name:'ETS 2'}]");
const variant = text => catalog(text).replace("simulatorName:'GTO',status:'active'", "simulatorName:'GTO',ownerName:'Diego',whatsapp:'11999999999',status:'active'").replace("updateCompany:load", "updateCompany:async(id,updates)=>{(window.__updates=window.__updates||[]).push([id,updates]);}");
const variants = {
  owner: variant(baseFixtures),
  stranger: variant(baseFixtures).replace("ownerId:'driver',userId:'driver'", "ownerId:'someone',userId:'someone'"),
  group: variant(baseFixtures).replace("const company={id:'dc',", "const company={id:'dc',companyGroupId:'dc',")
    .replace("const companies=[company,{...company,id:'second',companyName:'Outra Empresa',simulatorName:'WBDS',simulatorId:'wbds'}];",
      "const companies=[company,{...company,id:'dc-ats',simulatorId:'ats',simulatorName:'ATS',companyGroupId:'dc'},{...company,id:'second',companyName:'Outra Empresa',simulatorName:'WBDS',simulatorId:'wbds',companyGroupId:'second'}];"),
};
assert.notEqual(variants.group, variant(baseFixtures), "the group variant changed the fixture");
assert.notEqual(variants.stranger, variant(baseFixtures), "the stranger variant changed the fixture");

async function bundleFor(fixtures) {
  const out = await build({
    stdin: { resolveDir: root, sourcefile: "company-edit-group-ui.tsx", loader: "tsx", contents: `
import React from "react";import {createRoot} from "react-dom/client";import {MemoryRouter,Routes,Route} from "react-router-dom";
import AdminLayout from "./src/layouts/AdminLayout";import Fleet from "./src/pages/admin/Fleet";
window.__group={capabilities:[],calls:[],failAdd:false};
createRoot(document.getElementById("root")).render(<MemoryRouter initialEntries={[{pathname:"/admin/fleet",state:{activeTab:"company"}}]}><Routes><Route path="/admin" element={<AdminLayout/>}><Route path="fleet" element={<Fleet/>}/><Route path="*" element={<div>Destino</div>}/></Route></Routes></MemoryRouter>);
` },
    bundle: true, write: false, outfile: "fixture.js", format: "iife", platform: "browser", jsx: "automatic", loader: { ".css": "empty" }, logLevel: "error",
    define: { "process.env.NODE_ENV": '"test"', "import.meta.env.BASE_URL": '"/"', "import.meta.env.PROD": "false", "import.meta.env.DEV": "false", "import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID": '""', __AVATAR__: JSON.stringify(avatar), __VEHICLE__: JSON.stringify(vehicle) },
    plugins: [{ name: "company-adapters", setup(plugin) {
      plugin.onResolve({ filter: /^company-fixtures$/ }, () => ({ path: "fixtures", namespace: "company-fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "company-fixture" }, () => ({ contents: fixtures, resolveDir: root, loader: "tsx" }));
      plugin.onResolve({ filter: /^firebase\/(auth|firestore)$/ }, args => ["/profileCoverService.ts", "/companyDescriptionService.ts", "/useCompanyDescription.ts", "/CompanyTab.tsx", "/TripHistory.tsx"].some(file => args.importer.endsWith(file)) ? { path: "fixtures", namespace: "company-fixture" } : undefined);
      plugin.onLoad({ filter: /src\/services\/companyGroupService\.ts$/ }, () => ({ contents: groupStub, loader: "js" }));
      plugin.onLoad({ filter: /src\/.*\.tsx?$/ }, args => adapters.has(path.basename(args.path)) || secondary.has(path.basename(args.path)) ? { contents: 'export * from "company-fixtures";export {default} from "company-fixtures";', resolveDir: root, loader: "tsx" } : undefined);
    } }],
  });
  return out.outputFiles.find(file => file.path.endsWith(".js")).text;
}

const browser = await playwright.chromium.launch({ headless: true, ...(process.env.NVU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NVU_CHROMIUM_EXECUTABLE } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
async function open(name, capabilities, extra = {}) {
  const js = await bundleFor(variants[name]);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${css}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, timezoneId: "America/Sao_Paulo" });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (url.pathname.endsWith(".woff2")) return route.fulfill({ contentType: "font/woff2", body: await fs.readFile(path.join(root, "public", url.pathname)) });
    return route.fulfill({ contentType: "text/html", body: html });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(`${name}: ${error.message}`));
  await page.addInitScript(({ capabilities, extra }) => { Object.defineProperty(window, "__pending", { value: { capabilities, extra } }); }, { capabilities, extra });
  await page.goto("http://127.0.0.1:43829/");
  await page.evaluate(({ capabilities, extra }) => { Object.assign((window).__group, { capabilities }, extra); }, { capabilities, extra });
  await page.getByRole("button", { name: "Editar empresa" }).first().click();
  await page.getByTestId("profile-editor").waitFor();
  return { page, context };
}
const calls = page => page.evaluate(() => ({ group: window.__group.calls, updates: window.__updates || [] }));
async function check(name, run) { await run(); results.push(name); console.log("PASS " + name); }
try {
  const editor = page => page.getByTestId("profile-editor");
  const save = page => page.getByRole("button", { name: "Salvar" });
  await check("Owner: cover, logo, name, owner, WhatsApp and simulators of the company are in one form", async () => {
    const { page, context } = await open("owner", ["add-simulators", "rename", "deactivate-simulators"]);
    const form = editor(page);
    await form.getByTestId("profile-editor-cover").waitFor();
    await form.getByRole("button", { name: "Alterar capa" }).waitFor();
    await form.getByRole("button", { name: "Alterar logo da empresa" }).waitFor();
    assert.equal(await form.getByLabel("Nome da empresa").inputValue(), "DC Transportes");
    assert.equal(await form.getByLabel("Proprietário (responsável)").inputValue(), "Diego");
    assert.equal(await form.getByLabel("WhatsApp").inputValue(), "11999999999");
    const sims = form.getByTestId("profile-editor-simulators");
    assert.match(await sims.innerText(), /GTO/);
    assert.match(await form.innerText(), /O novo nome vale para todos os simuladores da empresa\./);
    if (process.env.NVU_SHOTS) for (const theme of ["dark", "light"]) {
      await page.evaluate(theme => { document.documentElement.classList.toggle("dark", theme === "dark"); }, theme);
      await form.screenshot({ path: path.join(process.env.NVU_SHOTS, `company-editor-${theme}.png`) });
    }
    // The cover keeps the shape of the profile cover (8 / 3).
    const box = await form.getByTestId("profile-editor-cover").boundingBox();
    assert(Math.abs(box.width / box.height - 8 / 3) < 0.06, "cover ratio " + box.width / box.height);
    await context.close();
  });

  await check("Owner renames: the server command carries the new name; the shared fields go to the fleet without the name", async () => {
    const { page, context } = await open("owner", ["add-simulators", "rename", "deactivate-simulators"]);
    await editor(page).getByLabel("Nome da empresa").fill("  DC   Cargas ");
    await editor(page).getByLabel("WhatsApp").fill("22988887777");
    await save(page).click();
    await page.waitForFunction(() => (window.__updates || []).length === 1);
    const recorded = await calls(page);
    assert.deepEqual(recorded.group, [["rename", "dc", "DC Cargas"]]);
    assert.equal(recorded.updates[0][0], "dc"); assert.equal(recorded.updates[0][1].whatsapp, "22988887777");
    assert.equal("companyName" in recorded.updates[0][1], false, "the name goes through the server, not through the single-fleet update");
    await editor(page).waitFor({ state: "detached" });
    await context.close();
  });

  await check("Unchanged name: no rename command", async () => {
    const { page, context } = await open("owner", ["add-simulators", "rename", "deactivate-simulators"]);
    await save(page).click();
    await page.waitForFunction(() => (window.__updates || []).length === 1);
    assert.deepEqual((await calls(page)).group, []);
    await context.close();
  });

  await check("Server without the commands: the simulator field stays visible but disabled, with the reason; a one-simulator company is still renamed directly", async () => {
    const { page, context } = await open("owner", []);
    const sims = editor(page).getByTestId("profile-editor-simulators");
    await sims.waitFor();
    await editor(page).getByTestId("profile-editor-simulators-unavailable").waitFor();
    assert.match(await sims.innerText(), /depende da atualização do servidor/);
    assert.equal(await sims.getByRole("button", { name: /Simuladores de atuação/ }).isDisabled(), true);
    await editor(page).getByLabel("Nome da empresa").fill("DC Direta");
    await save(page).click();
    await page.waitForFunction(() => (window.__updates || []).length === 1);
    const recorded = await calls(page);
    assert.deepEqual(recorded.group, []); assert.equal(recorded.updates[0][1].companyName, "DC Direta");
    await context.close();
  });

  await check("Checking a simulator adds it (summary first, one command on Save)", async () => {
    const { page, context } = await open("owner", ["add-simulators", "rename", "deactivate-simulators"]);
    const sims = editor(page).getByTestId("profile-editor-simulators");
    await sims.getByRole("button", { name: /Simuladores de atuação/ }).click();
    const picker = page.getByRole("dialog", { name: "Simuladores de atuação" });
    await picker.waitFor();
    assert.deepEqual((await picker.getByRole("option").allInnerTexts()).map(item => item.trim()), ["GTO", "WBDS", "ATS", "ETS 2"]);
    await picker.getByRole("option", { name: "ATS" }).click();
    await picker.getByRole("button", { name: "Confirmar (2)" }).click();
    assert.match(await editor(page).getByTestId("profile-editor-simulator-changes").innerText(), /Será adicionado: ATS/);
    assert.deepEqual((await calls(page)).group, [], "nothing is sent before Save");
    await save(page).click();
    await page.waitForFunction(() => window.__group.calls.some(call => call[0] === "add"));
    const recorded = await calls(page);
    assert.deepEqual(recorded.group, [["add", "dc", ["ats"]]]);
    await editor(page).waitFor({ state: "detached" });
    await context.close();
  });

  await check("Unchecking a simulator switches that fleet off; the simulator of the current environment stays", async () => {
    const { page, context } = await open("group", ["add-simulators", "rename", "deactivate-simulators"]);
    const sims = editor(page).getByTestId("profile-editor-simulators");
    assert.match(await sims.innerText(), /GTO/); assert.match(await sims.innerText(), /ATS/);
    // The chip of the current environment cannot be removed.
    await sims.getByRole("button", { name: "Remover GTO" }).click();
    await sims.getByRole("status").waitFor();
    assert.match(await sims.getByRole("status").innerText(), /simulador do ambiente atual/);
    assert.match(await sims.innerText(), /GTO/, "GTO is still chosen");
    await sims.getByRole("button", { name: "Remover ATS" }).click();
    assert.match(await editor(page).getByTestId("profile-editor-simulator-changes").innerText(), /Será desativado: ATS/);
    await save(page).click();
    await page.waitForFunction(() => window.__group.calls.some(call => call[0] === "deactivate"));
    assert.deepEqual((await calls(page)).group, [["deactivate", "dc", ["dc-ats"]]]);
    await context.close();
  });

  await check("A refusal of the server keeps the form open and says the data was saved", async () => {
    const { page, context } = await open("owner", ["add-simulators", "rename", "deactivate-simulators"], { failAdd: true });
    const sims = editor(page).getByTestId("profile-editor-simulators");
    await sims.getByRole("button", { name: /Simuladores de atuação/ }).click();
    const picker = page.getByRole("dialog", { name: "Simuladores de atuação" });
    await picker.getByRole("option", { name: "ETS 2" }).click();
    await picker.getByRole("button", { name: "Confirmar (2)" }).click();
    await save(page).click();
    const alert = editor(page).getByRole("alert").filter({ hasText: "Dados salvos" });
    await alert.waitFor();
    assert.match(await alert.innerText(), /Somente o proprietário da empresa pode fazer isso/);
    assert.equal(await editor(page).count(), 1, "the form stays open");
    await context.close();
  });

  await check("Not the owner: the name is read-only and there is no simulator field", async () => {
    const { page, context } = await open("stranger", ["add-simulators", "rename", "deactivate-simulators"]);
    assert.equal(await editor(page).getByLabel("Nome da empresa").isDisabled(), true);
    assert.equal(await editor(page).getByTestId("profile-editor-simulators").count(), 0);
    assert.match(await editor(page).innerText(), /Só o proprietário da empresa troca o nome\./);
    await context.close();
  });

  await check("Driver mode: the same form with cover, profile photo, name and WhatsApp, and no company fields", async () => {
    const { page, context } = await open("owner", ["add-simulators", "rename", "deactivate-simulators"]);
    await editor(page).getByRole("button", { name: "Cancelar" }).click();
    await editor(page).waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Abrir perfil do administrador" }).click();
    const form = editor(page);
    await form.waitFor();
    assert.equal(await form.getAttribute("data-mode"), "driver");
    await form.getByRole("button", { name: "Alterar capa" }).waitFor();
    await form.getByRole("button", { name: "Alterar foto do perfil" }).waitFor();
    await form.getByLabel("Nome", { exact: true }).waitFor();
    await form.getByLabel("WhatsApp").waitFor();
    assert.equal(await form.getByLabel("Proprietário (responsável)").count(), 0);
    assert.equal(await form.getByTestId("profile-editor-simulators").count(), 0);
    assert.equal(await form.getByRole("button", { name: "Excluir empresa" }).count(), 0);
    assert.match(await form.innerText(), /Editar perfil/);
    await context.close();
  });

  await check("Delete asks for confirmation inside the form", async () => {
    const { page, context } = await open("owner", ["add-simulators", "rename", "deactivate-simulators"]);
    await editor(page).getByRole("button", { name: "Excluir empresa" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Excluir empresa" });
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /O histórico será preservado/);
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await dialog.waitFor({ state: "detached" });
    await context.close();
  });
  assert.deepEqual(errors, [], "no page errors");
  await fs.mkdir("reports", { recursive: true });
  await fs.writeFile("reports/company-edit-group-ui.json", JSON.stringify({ result: "PASS", results }, null, 2));
  console.log(`COMPANY_EDIT_GROUP_UI_PASS (${results.length} checks)`);
} finally { await browser.close(); }
