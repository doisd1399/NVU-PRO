import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";

// The real application page opened from "Empresas": the back arrow of the header must leave it (step 1) or go back to the
// company's page (step 2). Before, with a company that came from the address, it cleared the company and the address
// loaded it again, so the arrow did nothing.
const root = process.cwd(), checks: string[] = [], errors: string[] = [];
const fixture = 'export * from "/scripts/fixtures/apply-back-fixture.tsx";';
const server = await createServer({ configFile: false, root, plugins: [{ name: "isolated-read-model", enforce: "pre", load(id) {
  const clean = id.split("?")[0];
  if (["src/context/AppContext.tsx", "src/context/CompanyContext.tsx", "src/services/googleAuthService.ts"].some(file => clean === path.join(root, file))) return fixture;
  if (clean === path.join(root, "src/lib/firebase.ts")) return fixture;
} }, react()], server: { host: "127.0.0.1", port: 4199, strictPort: true, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.NVU_CHROMIUM_EXECUTABLE, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usa" + "ge", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
page.on("pageerror", error => errors.push(error.message));
try {
  await page.route("**/*", route => /^http:\/\/127\.0\.0\.1:4199\//.test(route.request().url()) ? route.continue() : route.abort());
  await page.goto("http://127.0.0.1:4199/scripts/fixtures/apply-back.html");
  const back = () => page.getByTitle("Voltar").first();

  // 1. Step 1 (company's page): the arrow returns to Empresas.
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.getByRole("button", { name: "Continuar Inscrição" }).first().waitFor();
  await back().click();
  await page.getByRole("heading", { name: "Empresas", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/driver/companies");
  checks.push("The arrow of the company page returns to Empresas");

  // 2. Step 2 (form): the arrow returns to the company's page first, then to Empresas.
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.getByRole("button", { name: "Continuar Inscrição" }).first().click();
  await page.getByRole("button", { name: /Enviar Inscrição|Enviar inscrição|Enviar Solicitação/i }).first().waitFor({ timeout: 5000 }).catch(() => undefined);
  assert.equal(await page.getByRole("button", { name: "Continuar Inscrição" }).count(), 0, "the form is open");
  // The photo field is the same card as "Foto do proprietário", worded for the driver.
  const card = page.getByTestId("driver-photo-card");
  await card.waitFor();
  assert.match(await card.innerText(), /Foto do motorista/);
  assert.match(await card.innerText(), /Obrigatória · o RH verá esta foto/);
  assert.equal(await page.getByText("Remover foto", { exact: true }).count(), 0, "no photo chosen yet");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4EIwESMolGFAAQoAQ3Z5pnPAAAAAElFTkSuQmCC", "base64");
  await card.locator('input[type="file"]').setInputFiles({ name: "motorista.png", mimeType: "image/png", buffer: png });
  await card.getByRole("button", { name: "Remover foto" }).waitFor({ timeout: 8000 });
  await card.getByRole("button", { name: "Remover foto" }).click();
  await card.getByText("Obrigatória · o RH verá esta foto").waitFor();
  checks.push("Step 2 shows the 'Foto do motorista' card; choosing a photo offers 'Remover foto' and removing brings the hint back");
  await back().click();
  await page.getByRole("button", { name: "Continuar Inscrição" }).first().waitFor();
  assert.equal(new URL(page.url()).pathname, "/apply/norte", "step 2 goes back to the company page, not out of the application");
  await back().click();
  await page.getByRole("heading", { name: "Empresas", exact: true }).waitFor();
  checks.push("From the form the arrow goes back to the company page, and from there to Empresas");
  assert.deepEqual(errors, [], "no page errors");
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally { await browser.close(); await server.close(); }
