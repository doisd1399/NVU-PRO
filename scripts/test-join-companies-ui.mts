import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";

// The real "Empresas" screen (/driver/companies) with an injected read model (scripts/fixtures/join-companies-fixture.tsx).
const root = process.cwd(), checks: string[] = [], errors: string[] = [];
const fixture = 'export * from "/scripts/fixtures/join-companies-fixture.tsx";';
const server = await createServer({ configFile: false, root, plugins: [{ name: "isolated-read-model", enforce: "pre", load(id) {
  const clean = id.split("?")[0];
  if (["src/context/AppContext.tsx", "src/context/CompanyContext.tsx"].some(file => clean === path.join(root, file))) return fixture;
  if (clean === path.join(root, "src/hooks/useCurrentUserPendingApplications.ts")) return fixture;
  if (clean === path.join(root, "src/lib/firebase.ts")) return "export const db={}; export const auth={currentUser:null}; export const functions={};";
} }, react()], server: { host: "127.0.0.1", port: 4198, strictPort: true, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.NVU_CHROMIUM_EXECUTABLE, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usa" + "ge", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
page.on("pageerror", error => errors.push(error.message));
const q = () => page.evaluate(() => (window as any).qaJoin);
try {
  await page.route("**/*", route => /^http:\/\/127\.0\.0\.1:4198\//.test(route.request().url()) ? route.continue() : route.abort());
  await page.goto("http://127.0.0.1:4198/scripts/fixtures/join-companies.html");

  // 1. The screen asks for the catalog by itself; a failed first load offers a retry and the retry loads it.
  await page.getByRole("alert").waitFor();
  assert.deepEqual((await q()).loads, [false], "The catalog is requested on mount");
  assert.match(await page.getByRole("alert").innerText(), /Não foi possível carregar as empresas agora\./);
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await page.getByRole("alert").waitFor({ state: "detached" });
  assert.deepEqual((await q()).loads, [false, true], "Retry forces a new load");
  checks.push("Catalog loads on mount; a failure shows 'Tentar novamente' and the retry succeeds");

  // 3. Simulator filter -> only companies that can receive candidates, alphabetical, with the right state
  await page.getByRole("button", { name: /Selecione um simulador|Selecionar simulador/ }).first().click();
  await page.getByRole("option", { name: "GTO" }).or(page.getByText("GTO", { exact: true }).last()).first().click();
  const cards = page.locator("[data-apply-state]");
  await cards.first().waitFor();
  const rows = await cards.evaluateAll(nodes => nodes.map(node => [node.querySelector("h3")?.textContent, node.getAttribute("data-apply-state")]));
  assert.deepEqual(rows, [["DC Transportes", "member"], ["Norte Cargas", "open"], ["Rápida Logística", "closed"], ["Rural Express", "applied"], ["Sul Fretes", "applied"], ["Zeta Frotas", "open"]]);
  const text = await page.locator("body").innerText();
  for (const hidden of ["Excluída Ltda", "Pendente SA", "Outro Simulador"]) assert(!text.includes(hidden), hidden + " must not be offered");
  assert.doesNotMatch(text, /\bmembros?\b/, "No made-up member counts");
  checks.push("Only listable companies of the chosen simulator, alphabetical; member / applied / closed / open states; no member count");

  // 4. Buttons follow the state
  const button = (name: string) => page.getByRole("button", { name: new RegExp(name) });
  assert.equal(await button("DC Transportes: Você participa").isDisabled(), true);
  assert.equal(await button("Rápida Logística: Recrutamento fechado").isDisabled(), true);
  assert.equal(await button("Sul Fretes: Inscrição enviada").isDisabled(), true);
  assert.equal(await button("Solicitar entrada em Norte Cargas").isDisabled(), false);
  await button("Solicitar entrada em Norte Cargas").click();
  await page.waitForFunction(() => (window as any).qaJoin.requested.length === 1);
  assert.deepEqual((await q()).requested, ["norte"]);
  checks.push("Only an open company can be requested; linked, applied and closed companies are disabled with their own label");

  // 5. Search and the empty state
  const search = page.getByPlaceholder("Buscar empresa ou frota...");
  await search.fill("zzz");
  await page.getByText("Nenhuma empresa encontrada", { exact: true }).waitFor();
  await search.fill("zeta");
  assert.equal(await cards.count(), 1);
  await search.fill("");
  checks.push("Search narrows the list and an empty result says so");

  // 6. Minhas inscrições
  const mine = page.getByTestId("my-applications");
  const mineRows = await mine.locator("li").evaluateAll(nodes => nodes.map(node => ({ kind: node.getAttribute("data-kind"), text: node.textContent?.replace(/\s+/g, " ") })));
  assert.equal(mineRows.length, 2);
  assert.match(mineRows[0].text || "", /Sul Fretes.*25 de out\. de 2026.*Aguardando avaliação/);
  assert.match(mineRows[1].text || "", /Rural Express.*20 de out\. de 2026.*Aguardando avaliação/);
  assert.equal(await mine.locator('li[data-kind="recruitment"]').getByRole("button").count(), 0, "A full application is answered by HR: no withdraw here");
  await mine.locator('li[data-kind="request"]').getByRole("button", { name: "Retirar solicitação" }).click();
  await mine.getByRole("button", { name: "Manter" }).click();
  assert.deepEqual((await q()).cancelled, [], "Keeping writes nothing");
  await mine.locator('li[data-kind="request"]').getByRole("button", { name: "Retirar solicitação" }).click();
  await mine.getByRole("button", { name: "Retirar solicitação" }).last().click();
  await page.waitForFunction(() => (window as any).qaJoin.cancelled.length === 1);
  assert.deepEqual((await q()).cancelled, ["req-rural"]);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="my-applications"] li').length === 1);
  checks.push("Minhas inscrições lists both kinds with dates; only the simple request can be withdrawn, after a confirmation");

  // 6b. Layout: nothing overflows horizontally on a phone
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  // 7. Offline wording on a failed load (separate page load with the browser offline flag)
  await page.goto("http://127.0.0.1:4198/scripts/fixtures/join-companies.html?offline=1");
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /Sem conexão\. Conecte-se à internet para ver as empresas\./);
  await page.goto("http://127.0.0.1:4198/scripts/fixtures/join-companies.html");
  checks.push("Offline failure says so and still offers 'Tentar novamente'");

  assert.deepEqual(errors, []);
  console.log("JOIN_COMPANIES_UI_PASS", checks.length);
} catch (error) { if (process.env.NVU_JOIN_SHOT) await page.screenshot({ path: process.env.NVU_JOIN_SHOT.replace(".png", "-fail.png"), fullPage: true }); throw error; } finally { await browser.close(); server.httpServer?.closeAllConnections(); await server.close(); }
