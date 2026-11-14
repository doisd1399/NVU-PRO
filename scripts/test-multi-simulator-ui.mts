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

  // 3. Small screens: the picker stays inside a 320 x 568 window.
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
