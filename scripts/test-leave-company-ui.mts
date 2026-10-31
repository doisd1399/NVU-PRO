import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";

// The real "Sair da empresa" card and dialog, with the service replaced by a scripted one.
const root = process.cwd(), checks: string[] = [], errors: string[] = [];
const fixture = 'export * from "/scripts/fixtures/leave-company-fixture.tsx";';
const server = await createServer({ configFile: false, root, plugins: [{ name: "scripted-leave-service", enforce: "pre", load(id) {
  const clean = id.split("?")[0];
  if (clean === path.join(root, "src/services/leaveCompanyService.ts")) return fixture;
  if (clean === path.join(root, "src/lib/firebase.ts")) return "export const db={}; export const auth={currentUser:null}; export const functions={};";
} }, react()], server: { host: "127.0.0.1", port: 4197, strictPort: true, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.NVU_CHROMIUM_EXECUTABLE, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
const url = (query = "") => `http://127.0.0.1:4197/scripts/fixtures/leave-company.html${query}`;
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
page.on("pageerror", error => errors.push(error.message));
const q = () => page.evaluate(() => (window as any).qaLeave);
const open = async () => { await page.getByRole("button", { name: "Sair da empresa" }).click(); };
const dialog = () => page.getByRole("dialog");
try {
  await page.route("**/*", route => /^http:\/\/127\.0\.0\.1:4197\//.test(route.request().url()) ? route.continue() : route.abort());

  // 1. The option is hidden when the server does not know the command yet, and for the owner.
  await page.goto(url("?unsupported=1"));
  await page.waitForFunction(() => (window as any).qaLeave.previews.length > 0);
  assert.equal(await page.getByRole("button", { name: "Sair da empresa" }).count(), 0, "unsupported server: hidden");
  await page.goto(url("?owner=1"));
  await page.waitForFunction(() => (window as any).qaLeave.previews.length > 0);
  assert.equal(await page.getByRole("button", { name: "Sair da empresa" }).count(), 0, "owner: hidden");
  checks.push("Hidden before the Functions are published and for the owner");

  // 2. Opening and keeping: the approved text, and nothing is written.
  await page.goto(url());
  await page.getByRole("button", { name: "Sair da empresa" }).waitFor();
  await open();
  await dialog().getByRole("button", { name: "Confirmar saída" }).waitFor();
  assert.equal(await dialog().getAttribute("aria-modal"), "true");
  const text = await dialog().innerText();
  assert.match(text, /Sair da DC Transportes\?/);
  assert.match(text, /Você deixará de receber trabalhos desta empresa e perderá o acesso à área dela\./);
  assert.match(text, /1 trabalho em andamento será cancelado\. As viagens já registradas serão mantidas\./);
  assert.match(text, /Sua conta e seu histórico pessoal continuam com você\. Para voltar, será preciso uma nova inscrição aprovada\./);
  assert.equal(await dialog().locator("strong").innerText(), "1 trabalho em andamento será cancelado.");
  assert.deepEqual((await q()).previews.slice(-1), [true], "the dialog asks for a fresh preview");
  await dialog().getByRole("button", { name: "Continuar na empresa" }).click();
  await dialog().waitFor({ state: "detached" });
  assert.deepEqual((await q()).leaves, [], "Keeping writes nothing");
  await open();
  await dialog().getByRole("button", { name: "Confirmar saída" }).waitFor();
  await page.keyboard.press("Escape");
  await dialog().waitFor({ state: "detached" });
  assert.deepEqual((await q()).leaves, [], "Escape writes nothing");
  checks.push("Approved wording; 'Continuar na empresa' and Escape close without any write");

  // 3. Blocked by the server (operation waiting for completion): explained, no way to confirm, nothing sent.
  await page.evaluate(() => { (window as any).qaLeave.preview = { success: true, preview: true, companyId: "dc", companyName: "DC Transportes", canLeave: false, blocker: "LEAVE_AWAITING_COMPLETION", jobsToCancel: 0, awaitingCompletion: 1 }; });
  await open();
  await dialog().getByRole("alert").waitFor();
  assert.match(await dialog().innerText(), /Finalize a operação que aguarda conclusão antes de sair da empresa\./);
  assert.equal(await dialog().getByRole("button", { name: "Confirmar saída" }).count(), 0);
  await dialog().getByRole("button", { name: "Entendi" }).click();
  await dialog().waitFor({ state: "detached" });
  checks.push("A job waiting for completion blocks with an explanation and no confirm button");

  // 4. Work that exists only on the device, and no connection.
  await page.evaluate(() => { const s = (window as any).qaLeave; s.preview = { ...s.preview, canLeave: true, blocker: null, jobsToCancel: 2, awaitingCompletion: 0 }; s.local_result = { ok: false, reason: "pending-work", count: 3 }; });
  await open();
  await dialog().getByRole("alert").waitFor();
  assert.match(await dialog().innerText(), /Você tem 3 viagens ou envios ainda não enviados neste aparelho\./);
  assert.equal(await dialog().getByRole("button", { name: "Confirmar saída" }).count(), 0);
  await dialog().getByRole("button", { name: "Entendi" }).click();
  await page.evaluate(() => { (window as any).qaLeave.local_result = { ok: false, reason: "offline", count: 0 }; });
  await open();
  await dialog().getByRole("alert").waitFor();
  assert.match(await dialog().innerText(), /Conecte-se à internet para sair da empresa\./);
  await dialog().getByRole("button", { name: "Entendi" }).click();
  assert.deepEqual((await q()).leaves, []);
  checks.push("Unsent trips on the device and a missing connection both stop the exit before any command");

  // 5. Plural wording for several jobs.
  await page.evaluate(() => { (window as any).qaLeave.local_result = { ok: true }; });
  await open();
  await dialog().getByRole("button", { name: "Confirmar saída" }).waitFor();
  assert.match(await dialog().innerText(), /2 trabalhos em andamento serão cancelados\. As viagens já registradas serão mantidas\./);
  await page.keyboard.press("Escape");

  // 6. A lost answer: the message offers a retry, the retry replays the SAME command identifier, and a double click sends once.
  await page.evaluate(() => { const s = (window as any).qaLeave; s.leaveDelay = 250; s.leaveFailures = [Object.assign(new Error("x"), { code: "functions/unavailable", details: { diagnosticId: "leave-ref-1" } })]; });
  await open();
  const confirm = dialog().getByRole("button", { name: "Confirmar saída" });
  await confirm.waitFor();
  await confirm.dblclick();
  await dialog().getByRole("alert").waitFor();
  assert.equal((await q()).leaves.length, 1, "a double click sends one command");
  assert.match(await dialog().innerText(), /Não foi possível confirmar a saída\. Nada foi perdido: tente novamente\. Referência: leave-ref-1\./);
  assert.equal(await page.getByTestId("selector").count(), 0, "failure never navigates away");
  const first = (await q()).leaves[0];
  await dialog().getByRole("button", { name: "Tentar novamente" }).click();
  // While the command runs the dialog cannot be dismissed.
  await page.keyboard.press("Escape");
  assert.equal(await dialog().count(), 1, "busy dialog ignores Escape");
  assert.equal(await dialog().getByRole("button", { name: "Continuar na empresa" }).isDisabled(), true);
  await page.getByTestId("selector").waitFor();
  const sent = (await q()).leaves;
  assert.equal(sent.length, 2); assert.equal(sent[1], first, "the retry reuses the same command identifier");
  assert.match(sent[0], /^leave-/);
  checks.push("Single send on double click; retry replays the same command id; success only after the server answers, then the selector opens");

  // 7. Layout on a phone.
  await page.goto(url());
  await page.getByRole("button", { name: "Sair da empresa" }).waitFor();
  await open();
  await dialog().getByRole("button", { name: "Confirmar saída" }).waitFor();
  const box = await dialog().boundingBox();
  assert(box && box.x >= 0 && box.x + box.width <= 412 && box.y >= 0 && box.y + box.height <= 915, "dialog fits the phone screen");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  checks.push("Dialog fits a 412x915 screen");

  assert.deepEqual(errors, []);
  console.log("LEAVE_COMPANY_UI_PASS", checks.length);
} catch (error) { if (process.env.NVU_LEAVE_SHOT) await page.screenshot({ path: process.env.NVU_LEAVE_SHOT, fullPage: true }); throw error; } finally { await browser.close(); server.httpServer?.close(); await server.close(); }
