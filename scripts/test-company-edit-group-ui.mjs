import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// "Editar Empresa" of the real company profile (CompanyTab inside AdminLayout and Fleet, built CSS): the company name for the owner,
// the "Simuladores da empresa" list and the add flow. Only the stores and the group service are fixtures.
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
const adapters = new Set(["AppContext.tsx", "CompanyContext.tsx", "NotificationsContext.tsx", "firebase.ts", "routePreload.ts", "rankingPhotoWarmup.ts", "usePersistentRankingImage.ts", "useTripHistory.ts", "useDriverTrips.ts", "useMissingOperationTrip.ts", "SimpleAutomationCompletionBridge.tsx", "CompactProfileEditorModal.tsx", "NotificationCenter.tsx", "ProfileModal.tsx", "useVehiclePhoto.ts", "workModeAvailabilityService.ts", "simpleAutomationCityService.ts", "operationIntegrityGuard.ts", "uploadService.ts", "useProfileRanking.ts", "useTripsRealtime.ts", "AutomaticOperationsProvider.tsx", "useLocalOperationPending.ts", "CanonicalTripMigrationService.ts", "CanonicalTripCommandService.ts", "CanonicalTripOperationService.ts", "syncManager.ts", "tripModerationService.ts", "ProPendingAuthButton.tsx", "ProPendingRetryButton.tsx", "ProAttemptDiagnosticDetails.tsx", "FailedHistoryRegistrationRecovery.tsx", "OperationResultModal.tsx"]);
const secondary = new Set(["VehiclesTab.tsx", "TrailersTab.tsx", "DriversTab.tsx", "ContractsTab.tsx", "RecruitmentTab.tsx", "GtoObserverSetup.tsx", "OperationsTab.tsx"]);
const groupStub = `export const loadCompanyGroupCapabilities=async()=>[...(window.__group.capabilities||[])];
export const addCompanySimulators=async(companyId,ids)=>{window.__group.calls.push(["add",companyId,ids]);if(window.__group.failAdd){const e=new Error("x");e.details={reasonCode:"GROUP_OWNER_ONLY"};throw e;}
  return {success:true,companyId,created:ids.map(id=>({companyId:companyId+"-"+id,simulatorId:id,simulatorName:id.toUpperCase().replace("-"," ")})),existing:[],skipped:[]};};
export const renameCompanyGroup=async(companyId,name)=>{window.__group.calls.push(["rename",companyId,name]);return {companyName:name,updated:1};};`;

const variant = text => text.replace("simulatorName:'GTO',status:'active'", "simulatorName:'GTO',ownerName:'Diego',whatsapp:'11999999999',status:'active'").replace("updateCompany:load", "updateCompany:async(id,updates)=>{(window.__updates=window.__updates||[]).push([id,updates]);}");
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
  await page.getByRole("heading", { name: "Editar Empresa" }).waitFor();
  return { page, context };
}
const calls = page => page.evaluate(() => ({ group: window.__group.calls, updates: window.__updates || [] }));
async function check(name, run) { await run(); results.push(name); console.log("PASS " + name); }
try {
  await check("Owner: name field, own simulator listed, add button offered when the server lists it", async () => {
    const { page, context } = await open("owner", ["add-simulators", "rename"]);
    assert.equal(await page.getByLabel("Nome da Empresa").inputValue(), "DC Transportes");
    assert.match(await page.locator("form").innerText(), /O novo nome vale para todos os simuladores da empresa\./);
    const section = page.getByTestId("company-simulators");
    assert.deepEqual((await section.locator("li").allInnerTexts()).map(item => item.replace(/\s+/g, " ")), ["GTO Ambiente atual"], "another company of the same owner is not listed");
    await section.getByRole("button", { name: "Adicionar simuladores" }).waitFor();
    await context.close();
  });

  await check("Owner renames: the server command carries the new name; the direct update no longer writes the name", async () => {
    const { page, context } = await open("owner", ["add-simulators", "rename"]);
    await page.getByLabel("Nome da Empresa").fill("  DC   Cargas ");
    await page.getByRole("button", { name: "Salvar" }).click();
    await page.waitForFunction(() => (window.__updates || []).length === 1, null, { timeout: 5000 }).catch(async () => { console.log("DEBUG", JSON.stringify(await calls(page)), (await page.locator("form").innerText()).slice(-400)); throw new Error("no update"); });
    const recorded = await calls(page);
    assert.deepEqual(recorded.group, [["rename", "dc", "DC Cargas"]]);
    assert.equal(recorded.updates.length, 1); assert.equal(recorded.updates[0][0], "dc");
    assert.equal("companyName" in recorded.updates[0][1], false, "the name goes through the server, not through the single-fleet update");
    await context.close();
  });

  await check("Unchanged name: no rename command", async () => {
    const { page, context } = await open("owner", ["add-simulators", "rename"]);
    await page.getByRole("button", { name: "Salvar" }).click();
    await page.waitForFunction(() => (window.__updates || []).length === 1);
    assert.deepEqual((await calls(page)).group, []);
    await context.close();
  });

  await check("Server without the command: a company with one simulator is still renamed directly; the add option stays hidden", async () => {
    const { page, context } = await open("owner", []);
    assert.equal(await page.getByTestId("company-simulators").getByRole("button", { name: "Adicionar simuladores" }).count(), 0);
    await page.getByLabel("Nome da Empresa").fill("DC Direta");
    await page.getByRole("button", { name: "Salvar" }).click();
    await page.waitForFunction(() => (window.__updates || []).length === 1);
    const recorded = await calls(page);
    assert.deepEqual(recorded.group, []); assert.equal(recorded.updates[0][1].companyName, "DC Direta");
    await context.close();
  });

  await check("Add flow: pick, confirm and the new simulators appear in the list at once", async () => {
    const { page, context } = await open("owner", ["add-simulators", "rename"]);
    const section = page.getByTestId("company-simulators");
    await section.getByRole("button", { name: "Adicionar simuladores" }).click();
    const picker = page.getByRole("dialog", { name: "Adicionar simuladores" });
    await picker.waitFor();
    const offered = (await picker.getByRole("option").allInnerTexts()).map(item => item.trim());
    assert(!offered.includes("GTO"), "the simulator the company has is not offered: " + offered.join(","));
    await picker.getByRole("option").first().click();
    await picker.getByRole("button", { name: "Confirmar (1)" }).click();
    await page.getByRole("button", { name: "Adicionar 1 simulador" }).click();
    await page.waitForFunction(() => window.__group.calls.some(call => call[0] === "add"));
    const recorded = await calls(page);
    assert.equal(recorded.group[0][0], "add"); assert.equal(recorded.group[0][1], "dc"); assert.equal(recorded.group[0][2].length, 1);
    await page.getByRole("dialog", { name: "Adicionar simuladores" }).waitFor({ state: "detached" });
    assert.equal((await section.locator("li").count()), 2, "the new simulator is listed at once");
    assert.match(await section.locator("li").nth(1).innerText(), /Ativo/);
    await context.close();
  });

  await check("A refusal of the server keeps the confirmation open with the reason", async () => {
    const { page, context } = await open("owner", ["add-simulators", "rename"], { failAdd: true });
    const section = page.getByTestId("company-simulators");
    await section.getByRole("button", { name: "Adicionar simuladores" }).click();
    const picker = page.getByRole("dialog", { name: "Adicionar simuladores" });
    await picker.getByRole("option").first().click();
    await picker.getByRole("button", { name: "Confirmar (1)" }).click();
    await page.getByRole("button", { name: "Adicionar 1 simulador" }).click();
    await page.getByRole("alert").filter({ hasText: "Somente o proprietário" }).waitFor();
    assert.equal(await section.locator("li").count(), 1, "nothing was added to the list");
    await context.close();
  });

  await check("Not the owner: no name field and no add button, but the simulators are listed", async () => {
    const { page, context } = await open("stranger", ["add-simulators", "rename"]);
    assert.equal(await page.getByLabel("Nome da Empresa").count(), 0);
    const section = page.getByTestId("company-simulators");
    assert.equal(await section.locator("li").count(), 1);
    assert.equal(await section.getByRole("button", { name: "Adicionar simuladores" }).count(), 0);
    await context.close();
  });

  await check("Company with several simulators: all listed (the other company is not), and rename needs the server command", async () => {
    const { page, context } = await open("group", ["add-simulators"]);
    const section = page.getByTestId("company-simulators");
    assert.deepEqual((await section.locator("li").allInnerTexts()).map(item => item.replace(/\s+/g, " ")), ["GTO Ambiente atual", "ATS Ativo"]);
    await page.getByLabel("Nome da Empresa").fill("DC Nova");
    await page.getByRole("button", { name: "Salvar" }).click();
    await page.getByText(/o servidor precisa estar atualizado/).waitFor();
    const recorded = await calls(page);
    assert.deepEqual(recorded.group, []); assert.deepEqual(recorded.updates, [], "nothing was written: one fleet must not get a name the others lack");
    await context.close();
  });
  assert.deepEqual(errors, [], "no page errors");
  await fs.mkdir("reports", { recursive: true });
  await fs.writeFile("reports/company-edit-group-ui.json", JSON.stringify({ result: "PASS", results }, null, 2));
  console.log(`COMPANY_EDIT_GROUP_UI_PASS (${results.length} checks)`);
} finally { await browser.close(); }
