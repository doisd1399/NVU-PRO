import assert from "node:assert/strict";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright";

// The multiple choice field (registration of a company) and "Simuladores da empresa" (edit of a registered company).
const root = process.cwd(), checks: string[] = [], errors: string[] = [];
const server = await createServer({ configFile: false, root, plugins: [react(), tailwindcss()], server: { host: "127.0.0.1", port: 4200, strictPort: true, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.NVU_CHROMIUM_EXECUTABLE, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usa" + "ge", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
page.on("pageerror", error => errors.push(error.message));
const values = () => page.getByTestId("values").innerText();
try {
  await page.route("**/*", route => /^http:\/\/127\.0\.0\.1:4200\//.test(route.request().url()) ? route.continue() : route.abort());
  await page.goto("http://127.0.0.1:4200/scripts/fixtures/multi-simulator.html");

  // 1. The field: placeholder, picker with checkboxes, Confirmar with the count, chips in the catalog order.
  const field = page.getByTestId("multi-select-field");
  assert.match(await field.innerText(), /Selecione um ou mais…/);
  await field.getByRole("button", { name: /Selecionar simuladores/ }).click();
  const dialog = page.getByRole("dialog", { name: "Selecionar simuladores" });
  await dialog.waitFor();
  assert.equal(await dialog.getByRole("option").count(), 7);
  assert.equal(await dialog.getByRole("listbox").getAttribute("aria-multiselectable"), "true");
  const confirm = dialog.getByRole("button", { name: /^Confirmar/ });
  assert.equal(await confirm.isDisabled(), true, "nothing chosen: nothing to confirm");
  await dialog.getByRole("option", { name: "ATS" }).click();
  await dialog.getByRole("option", { name: "GTO" }).click();
  assert.equal(await dialog.getByRole("option", { name: "ATS" }).getAttribute("aria-selected"), "true");
  assert.equal(await dialog.getByRole("option", { name: "WBDS" }).getAttribute("aria-selected"), "false");
  assert.equal(await confirm.innerText(), "Confirmar (2)");
  assert.match(await dialog.innerText(), /2 selecionados\./);
  assert.equal(await values(), "", "nothing is applied before Confirmar");
  const box = await dialog.boundingBox();
  assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 412 && box.y + box.height <= 915, "the picker fits the screen");
  await confirm.click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(await values(), "gto,ats", "the answer follows the catalog order, not the order of the taps");
  assert.deepEqual(await field.locator("span.pointer-events-auto").allInnerTexts(), ["GTO", "ATS"]);
  checks.push("Multiple choice: toggles, Confirmar (2), nothing applied before it, chips in catalog order, picker fits the screen");

  // 2. Chips are removed one by one; the picker starts from the current choice; Escape and X discard the draft; Limpar empties it.
  await field.getByRole("button", { name: "Remover GTO" }).click();
  assert.equal(await values(), "ats");
  await field.getByRole("button", { name: /Selecionar simuladores/ }).click();
  await dialog.waitFor();
  assert.equal(await dialog.getByRole("option", { name: "ATS" }).getAttribute("aria-selected"), "true");
  await dialog.getByRole("option", { name: "PBS" }).click();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await values(), "ats", "Escape discards the draft");
  await field.getByRole("button", { name: /Selecionar simuladores/ }).click();
  await dialog.waitFor();
  await dialog.getByRole("option", { name: "WTDS" }).click();
  await dialog.getByRole("button", { name: "Fechar selecionar simuladores" }).click();
  assert.equal(await values(), "ats", "closing with X discards the draft");
  await field.getByRole("button", { name: /Selecionar simuladores/ }).click();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Limpar" }).click();
  assert.equal(await dialog.getByRole("button", { name: /^Confirmar/ }).isDisabled(), true);
  await page.keyboard.press("Escape");
  checks.push("Chips removable one by one, Escape and X discard the draft, Limpar empties it");

  // 3. "Simuladores da empresa": rows, tags and the add flow.
  const section = page.getByTestId("company-simulators");
  assert.deepEqual(await section.locator("li").allInnerTexts().then(items => items.map(item => item.replace(/\s+/g, " "))), ["GTO Ambiente atual", "ATS Ativo"]);
  await page.evaluate(() => (window as any).qaMulti.setCanAdd(false));
  await section.getByRole("button", { name: "Adicionar simuladores" }).waitFor({ state: "detached" });
  assert.equal(await section.getByRole("button", { name: "Adicionar simuladores" }).count(), 0, "only the owner, with the server command published, can add");
  await page.evaluate(() => (window as any).qaMulti.setCanAdd(true));
  await section.getByRole("button", { name: "Adicionar simuladores" }).click();
  const picker = page.getByRole("dialog", { name: "Adicionar simuladores" });
  await picker.waitFor();
  assert.deepEqual(await picker.getByRole("option").allInnerTexts().then(items => items.map(item => item.trim())), ["ETS 2", "WTDS", "PBS"], "only the simulators the company does not have");
  await picker.getByRole("option", { name: "ETS 2" }).click();
  await picker.getByRole("option", { name: "WTDS" }).click();
  await picker.getByRole("button", { name: "Confirmar (2)" }).click();
  // The confirmation says what is created before anything is created.
  const confirmation = page.getByRole("dialog", { name: "Adicionar simuladores" });
  await confirmation.getByRole("button", { name: "Adicionar 2 simuladores" }).waitFor();
  const wording = await confirmation.innerText();
  assert.match(wording, /ETS 2/); assert.match(wording, /WTDS/);
  assert.match(wording, /frota, operações, motoristas e ranking separados/);
  assert.match(wording, /Você será administrador de todos/);
  assert.match(wording, /se inscrevem em cada simulador separadamente/);
  assert.deepEqual(await page.evaluate(() => (window as any).qaMulti.added), [], "nothing was sent yet");
  await confirmation.getByRole("button", { name: "Cancelar" }).click();
  assert.deepEqual(await page.evaluate(() => (window as any).qaMulti.added), [], "Cancelar sends nothing");
  checks.push("Simuladores da empresa: rows with tags, add only for the owner, picker lists only missing simulators, confirmation explains the effect and Cancelar sends nothing");

  // 4. Confirm sends the exact ids; busy blocks double taps; a refusal keeps the dialog open with the reason.
  await page.evaluate(() => { (window as any).qaMulti.delay = 300; });
  await section.getByRole("button", { name: "Adicionar simuladores" }).click();
  await picker.waitFor();
  await picker.getByRole("option", { name: "ETS 2" }).click();
  await picker.getByRole("option", { name: "PBS" }).click();
  await picker.getByRole("button", { name: "Confirmar (2)" }).click();
  const add = confirmation.getByRole("button", { name: "Adicionar 2 simuladores" });
  await add.click();
  await confirmation.getByRole("button", { name: "Adicionando…" }).waitFor();
  assert.equal(await confirmation.getByRole("button", { name: "Cancelar" }).isDisabled(), true, "busy: Cancelar is blocked");
  await confirmation.waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => (window as any).qaMulti.added), [["ets-2", "pbs"]], "one command with the chosen ids, in the catalog order");

  await page.evaluate(() => { const state = (window as any).qaMulti; state.failNext = true; state.delay = 40; state.added.length = 0; });
  await section.getByRole("button", { name: "Adicionar simuladores" }).click();
  await picker.waitFor();
  await picker.getByRole("option", { name: "WTDS" }).click();
  await picker.getByRole("button", { name: "Confirmar (1)" }).click();
  await confirmation.getByRole("button", { name: "Adicionar 1 simulador" }).click();
  await confirmation.getByRole("alert").waitFor();
  assert.match(await confirmation.getByRole("alert").innerText(), /Somente o proprietário da empresa pode fazer isso\./);
  assert.equal(await confirmation.getByRole("button", { name: "Adicionar 1 simulador" }).isDisabled(), false, "after a refusal the owner can try again");
  await confirmation.getByRole("button", { name: "Cancelar" }).click();
  checks.push("Confirm sends one command with the ids; busy blocks double taps; a refusal keeps the dialog with the reason");

  // 5. Small screens: the picker and the confirmation stay inside a 320 x 568 window.
  await page.setViewportSize({ width: 320, height: 568 });
  await field.getByRole("button", { name: /Selecionar simuladores/ }).click();
  await dialog.waitFor();
  const small = await dialog.boundingBox();
  assert(small && small.x >= 0 && small.y >= 0 && small.x + small.width <= 320 && small.y + small.height <= 568, "picker inside 320x568: " + JSON.stringify(small));
  assert(await dialog.getByRole("button", { name: /^Confirmar/ }).isVisible(), "the footer stays reachable");
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, [], "no page errors");
  console.log("MULTI_SIMULATOR_UI_PASS", checks.length);
  console.log(checks.map(check => " - " + check).join("\n"));
} finally { await browser.close(); await server.close(); }
