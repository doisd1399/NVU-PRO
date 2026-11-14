import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright";

// The real "Cadastro de Nova Empresa": several simulators can be chosen and the registration records all of them, the first one
// also in the old single fields (older readers keep working).
const root = process.cwd(), checks: string[] = [], errors: string[] = [];
const fixture = 'export * from "/scripts/fixtures/register-company-fixture.tsx";';
const firestoreStub = `export const collection=(db,name)=>({name}); export const doc=(db,...parts)=>({path:parts.join("/")});
export const addDoc=async(ref,data)=>{(window.__registrations||(window.__registrations=[])).push({collection:ref.name,data});return {id:"registration-"+window.__registrations.length};};
export const setDoc=async(ref,data,options)=>{(window.__pointers||(window.__pointers=[])).push({path:ref.path,data,options});};`;
const storageStub = `export const ref=(storage,path)=>({path}); export const uploadString=async()=>{throw new Error("storage unavailable in this test");}; export const getDownloadURL=async()=>"";`;
const server = await createServer({ configFile: false, root, plugins: [{ name: "isolated-registration", enforce: "pre",
  resolveId(id) { if (id === "firebase/firestore") return "\0firestore-stub"; if (id === "firebase/storage") return "\0storage-stub"; },
  load(id) {
    if (id === "\0firestore-stub") return firestoreStub;
    if (id === "\0storage-stub") return storageStub;
    const clean = id.split("?")[0];
    if (clean === path.join(root, "src/context/AppContext.tsx")) return fixture;
    if (clean === path.join(root, "src/lib/firebase.ts")) return fixture;
    if (clean === path.join(root, "src/services/googleAuthService.ts")) return fixture;
  } }, react(), tailwindcss()], server: { host: "127.0.0.1", port: 4202, strictPort: true, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.NVU_CHROMIUM_EXECUTABLE, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usa" + "ge", "--disable-gpu"] });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4EIwESMolGFAAQoAQ3Z5pnPAAAAAElFTkSuQmCC", "base64");
const open = async () => {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => /^http:\/\/127\.0\.0\.1:4202\//.test(route.request().url()) ? route.continue() : route.abort());
  await page.goto("http://127.0.0.1:4202/scripts/fixtures/register-company.html");
  await page.getByRole("heading", { name: "Cadastro de Nova Empresa", exact: false }).or(page.getByText("Cadastro de Nova Empresa")).first().waitFor();
  return page;
};
const fill = async (page: any, name: string) => {
  const files = page.locator('input[type="file"]');
  await files.nth(0).setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  await files.nth(1).setInputFiles({ name: "dono.png", mimeType: "image/png", buffer: png });
  await page.getByText("Remover foto", { exact: true }).first().waitFor({ timeout: 8000 });
  await page.locator('input[required]').first().fill(name);
};
const choose = async (page: any, labels: string[]) => {
  await page.getByTestId("multi-select-field").getByRole("button", { name: /Selecionar simuladores/ }).click();
  const dialog = page.getByRole("dialog", { name: "Selecionar simuladores" });
  await dialog.waitFor();
  for (const label of labels) await dialog.getByRole("option", { name: label, exact: true }).click();
  await dialog.getByRole("button", { name: /^Confirmar/ }).click();
  await dialog.waitFor({ state: "detached" });
};
try {
  // 1. Several simulators: the field, the helper text, the button waits for a choice, the record has every simulator.
  const page = await open();
  const text = await page.locator("body").innerText();
  assert.match(text, /Simuladores/); assert.match(text, /escolha um ou mais/);
  assert.match(text, /Cada simulador cria um ambiente próprio da empresa \(frota, operações e ranking\), com o mesmo nome, logo e proprietário\./);
  const send = page.getByRole("button", { name: "Enviar Solicitação" });
  assert.equal(await send.isDisabled(), true, "no simulator chosen: nothing to send");
  await fill(page, "DC Transportes");
  assert.equal(await send.isDisabled(), true, "the photos and the name are not enough: a simulator is required");
  await page.getByTestId("multi-select-field").getByRole("button", { name: /Selecionar simuladores/ }).click();
  assert.deepEqual(await page.getByRole("dialog", { name: "Selecionar simuladores" }).getByRole("option").allInnerTexts().then(items => items.map(item => item.trim())), ["GTO", "ATS", "ETS 2"], "switched-off simulators are not offered");
  await page.keyboard.press("Escape");
  await choose(page, ["ATS", "GTO"]);
  assert.equal(await send.isDisabled(), false);
  await send.click();
  await page.getByTestId("done").waitFor();
  assert.equal(await page.getByTestId("done").innerText(), "/pending-applications");
  const recorded = await page.evaluate(() => ({ registrations: (window as any).__registrations, pointers: (window as any).__pointers }));
  assert.equal(recorded.registrations.length, 1);
  const data = recorded.registrations[0].data;
  assert.equal(recorded.registrations[0].collection, "recruitment_applications");
  assert.equal(data.type, "company_registration"); assert.equal(data.status, "pending"); assert.equal(data.companyName, "DC Transportes"); assert.equal(data.userId, "owner-1");
  assert.deepEqual(data.simulatorIds, ["gto", "ats"], "every chosen simulator, in the catalog order");
  assert.deepEqual(data.simulatorNames, ["GTO", "ATS"]);
  assert.equal(data.simulatorId, "gto", "the first one stays in the old single fields"); assert.equal(data.simulatorName, "GTO");
  assert.equal(recorded.pointers[0].data.currentRecruitmentSimulatorId, "gto");
  checks.push("Several simulators: required choice, only active ones offered, the registration keeps every simulator and the first in the old fields");
  await page.close();

  // 2. One simulator: same record shape as before plus the one-item lists.
  const single = await open();
  await fill(single, "Solo Cargas");
  await choose(single, ["ETS 2"]);
  await single.getByRole("button", { name: "Enviar Solicitação" }).click();
  await single.getByTestId("done").waitFor();
  const one = (await single.evaluate(() => (window as any).__registrations))[0].data;
  assert.equal(one.simulatorId, "ets-2"); assert.equal(one.simulatorName, "ETS 2"); assert.deepEqual(one.simulatorIds, ["ets-2"]); assert.deepEqual(one.simulatorNames, ["ETS 2"]);
  checks.push("One simulator: simulatorId/simulatorName as always, plus one-item lists");
  await single.close();
  assert.deepEqual(errors, [], "no page errors");
  console.log("REGISTER_COMPANY_MULTI_UI_PASS", checks.length);
  console.log(checks.map(check => " - " + check).join("\n"));
} finally { await browser.close(); await server.close(); }
