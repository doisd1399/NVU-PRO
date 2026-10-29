import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
const root = process.cwd(), checks: string[] = [], errors: string[] = [];
const server = await createServer({ configFile: false, root, plugins: [{ name: "native-diagnostic-boundary", enforce: "pre", load(id) {
  const file = id.split("?")[0];
  if (file === path.join(root, "src/lib/printDiagnosticsNative.ts")) return `export const hasNativePrintDiagnostics=()=>true; export const PrintDiagnostics={
    getRuntimeInfo:async()=>({nativeVersion:'1.0.518'}),
    readReport:async()=>{window.qaPrint519.reads++;return{text:'old persisted report'}},
    saveReport:async(input)=>{window.qaPrint519.saved.push(input)}, shareReport:async()=>{}};`;
  if (file === path.join(root, "src/components/ProAttemptDiagnosticDetails.tsx")) return "export const copySafeDiagnosticToClipboard=async({text})=>{window.qaPrint519.copied=text};";
} }, react()], server: { host: "127.0.0.1", port: 4198, strictPort: true, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
const page = await browser.newPage();
page.on("pageerror", error => errors.push(error.message));
const panel = page.getByRole("region", { name: "Diagnóstico do último erro de envio" });
try {
  await page.route("**/*", route => /^http:\/\/127\.0\.0\.1:4198\//.test(route.request().url()) ? route.continue() : route.abort());
  await page.goto("http://127.0.0.1:4198/verification/release-519/print-diagnostic.html");
  await page.getByRole("button", { name: "Simular falha real de envio" }).waitFor();
  await page.waitForTimeout(80);
  assert.equal(await panel.count(), 0); assert.equal(await page.evaluate(() => (window as any).qaPrint519.reads), 0);
  checks.push("Opening a normal form never shows or restores the native historical error report");
  await page.getByRole("button", { name: "Simular falha real de envio" }).click(); await panel.waitFor();
  await panel.getByText("Ver diagnóstico", { exact: true }).click();
  const report = await page.getByRole("textbox", { name: "Texto do diagnóstico" }).inputValue();
  assert.equal(JSON.parse(report).phase, "journal-write");
  assert(!report.includes("private-test-secret")); assert(!report.includes("https://example.test/private"));
  await page.getByRole("button", { name: "Copiar diagnóstico" }).click();
  assert.equal(await page.evaluate(() => (window as any).qaPrint519.copied), report);
  assert.equal(await page.evaluate(() => (window as any).qaPrint519.saved.length), 1);
  checks.push("A new failure opens a sanitized, copyable diagnostic and preserves its native support copy");
  await page.getByRole("button", { name: "Iniciar nova tentativa" }).click(); assert.equal(await panel.count(), 0);
  assert.equal(await page.evaluate(() => (window as any).qaPrint519.saved.length), 1);
  checks.push("Starting a retry hides the old failure without deleting the saved support report");
  await page.getByRole("button", { name: "Simular falha real de envio" }).click(); await panel.waitFor();
  await page.getByRole("button", { name: "Concluir lançamento" }).click(); assert.equal(await panel.count(), 0);
  checks.push("A completed launch leaves no diagnostic panel visible");
  await page.getByRole("button", { name: "Simular falha real de envio" }).click(); await panel.waitFor();
  await page.getByRole("button", { name: "Trocar conta" }).click(); assert.equal(await panel.count(), 0);
  await page.getByRole("button", { name: "Reabrir formulário" }).click(); await page.waitForTimeout(80);
  assert.equal(await panel.count(), 0); assert.equal(await page.evaluate(() => (window as any).qaPrint519.reads), 0);
  checks.push("Changing account or reopening the screen cannot revive another attempt's diagnostic");
  assert.deepEqual(errors, []);
  fs.mkdirSync("reports/release-519", { recursive: true });
  fs.writeFileSync("reports/release-519/print-diagnostic-visibility.json", JSON.stringify({ checks, errors, method: "Actual diagnostic hook and panel in Chromium; native plugin and clipboard injected; no production calls." }, null, 2));
  console.log("PRINT_DIAGNOSTIC_UI_519_PASS", checks.length);
} finally { await browser.close(); server.httpServer?.closeAllConnections(); await server.close(); }
