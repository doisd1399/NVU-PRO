import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";

const root = process.cwd(), checks: string[] = [], errors: string[] = [];
const fixture = 'export * from "/scripts/fixtures/personal-area-fixture.tsx";';
const server = await createServer({ configFile: false, root, plugins: [{ name: "isolated-read-model", enforce: "pre", load(id) {
  const clean = id.split("?")[0];
  if (["src/context/AppContext.tsx", "src/context/CompanyContext.tsx", "src/hooks/useCurrentUserPendingApplications.ts", "src/hooks/useDriverTrips.ts"].some(file => clean === path.join(root, file))) return fixture;
  if (clean === path.join(root, "src/lib/firebase.ts")) return "export const db={}; export const auth={currentUser:null}; export const functions={};";
} }, react()], server: { host: "127.0.0.1", port: 4195, strictPort: true, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.NVU_CHROMIUM_EXECUTABLE, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
const url = (query = "") => `http://127.0.0.1:4195/scripts/fixtures/personal-area.html${query}`;
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
page.on("pageerror", error => errors.push(error.message));
const q = () => page.evaluate(() => (window as any).qaPersonal);
try {
  await page.route("**/*", route => /^http:\/\/127\.0\.0\.1:4195\//.test(route.request().url()) ? route.continue() : route.abort());

  // 1. Not enabled by the server: the page is the old Pendências, untouched.
  await page.goto(url("?enabled=0"));
  await page.getByRole("heading", { name: "Pendências" }).first().waitFor();
  assert.equal(await page.getByTestId("personal-area").count(), 0);
  assert.match(await page.locator("body").innerText(), /Nenhuma inscrição ou cadastro pendente foi encontrado nesta conta\./);
  checks.push("An account the server has not enabled still sees the old Pendências page");

  // 2. Enabled: the personal area.
  await page.goto(url());
  await page.getByTestId("personal-area").waitFor();
  const text = await page.locator("body").innerText();
  assert.match(text, /Meu perfil/); assert.match(text, /Sem empresa vinculada/);
  assert.match(text, /David Canto/); assert.match(text, /david@example\.test/); assert.match(text, /11999990000/);
  assert.equal(await page.getByRole("button", { name: "Encontrar empresas" }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Minhas inscrições" }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Desconectar" }).count(), 1);
  assert.match(text, /2 viagens registradas em 2 empresas\./);
  checks.push("Personal area: identity, contacts, empresas, inscrições and trips of every past company");

  // 3. Results card: closed by default, opens with its own scroll.
  const results = page.locator("[data-nvu-profile-results]");
  assert.equal(await results.getByRole("button", { name: /Resultados/ }).getAttribute("aria-expanded"), "false");
  await results.getByRole("button", { name: /Resultados/ }).click();
  await results.locator(".nvu-profile-results-scroll").waitFor();
  assert.equal(await results.getByRole("button", { name: /Resultados/ }).getAttribute("aria-expanded"), "true");
  checks.push("Resultados is a collapsible card that opens its own scrolling region");

  // 4. Empresas inside the same page, with Voltar returning to the personal area.
  await page.getByRole("button", { name: "Encontrar empresas" }).click();
  await page.getByRole("heading", { name: "Empresas" }).waitFor();
  assert.equal((await q()).loads >= 1, true, "the catalog loads by itself");
  await page.getByRole("button", { name: "Voltar" }).click();
  await page.getByTestId("personal-area").waitFor();
  await page.getByRole("button", { name: "Minhas inscrições" }).click();
  await page.getByRole("heading", { name: "Empresas" }).waitFor();
  await page.getByRole("button", { name: "Voltar" }).click();
  await page.getByTestId("personal-area").waitFor();
  checks.push("Empresas and Minhas inscrições open inside the page and Voltar returns to the personal area");

  // 5. A pending application appears; logout and home work.
  await page.goto(url("?pending=1"));
  await page.getByTestId("personal-area").waitFor();
  assert.match(await page.locator("body").innerText(), /Norte Cargas/);
  await page.getByRole("button", { name: "Desconectar" }).click();
  await page.getByTestId("home").waitFor();
  assert.equal((await q()).logouts, 1);
  checks.push("Pending applications are listed; Desconectar signs out and leaves the page");

  // 6. Phone layout.
  await page.goto(url());
  await page.getByTestId("personal-area").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  checks.push("No horizontal overflow on a 412px screen");

  assert.deepEqual(errors, []);
  console.log("PERSONAL_AREA_UI_PASS", checks.length);
} catch (error) { if (process.env.NVU_PERSONAL_SHOT) await page.screenshot({ path: process.env.NVU_PERSONAL_SHOT, fullPage: true }); throw error; } finally { await browser.close(); server.httpServer?.close(); await server.close(); }
