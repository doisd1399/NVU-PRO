import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// The offline finish and the receipts waiting for the network, with the real components and the built stylesheet:
//  - "Finalização salva" always says why it waits and can be retried or cancelled (nobody is locked behind it);
//  - the amber card is not shown for a receipt that is only waiting for the network; it appears when the driver must act.
let playwright;
try { playwright = await import("playwright"); }
catch { playwright = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright/index.mjs")).href); }
const root = process.cwd(), errors = [], results = [];
const assets = await fs.readdir("dist/assets");
const css = (await Promise.all(assets.filter(n => n.endsWith(".css")).map(n => fs.readFile(path.join("dist/assets", n), "utf8")))).join("\n");
const stubs = {
  outbox: `window.__calls=[];window.__cancelOk=true;
    export const operationOutbox={retryNow:id=>window.__calls.push(["retryNow",id]),retry:id=>window.__calls.push(["retry",id]),
      synchronize:async kind=>{window.__calls.push(["sync",kind])},cancelFinish:id=>{window.__calls.push(["cancel",id]);return window.__cancelOk}};
    export const reconcileOperationOutboxNativeState=async()=>{window.__calls.push(["reconcile"])};`,
  native: `export const isSimpleAutomationNativeAvailable=()=>true;
    export const SimpleAutomation={getReadOnlyProQueueDiagnostics:async()=>({ownerAuthenticated:true,pendingProTrips:window.__queue||[]})};`,
  recovery: `export const useOperationRecovery=()=>window.__recovery||null;`,
  auth: `import React from "react";export function ProPendingAuthButton({driverId,attemptIds}){return <button data-testid="auth-button" data-attempts={(attemptIds||[]).join(",")}>Autenticar</button>}`,
};
const bundle = await build({
  stdin: { resolveDir: root, sourcefile: "offline-flow.tsx", loader: "tsx", contents: `
import React,{useState} from "react";import {createRoot} from "react-dom/client";
import {OperationSyncNotice} from "./src/components/OperationSyncNotice";
import {PendingProOperationNotice} from "./src/components/PendingProOperationNotice";
import {Toaster} from "sonner";
window.__queue=[];
function App(){const [job,setJob]=useState({id:"job-1",operationSyncState:"pending_finish",operationSyncError:"Aguardando o servidor confirmar as viagens salvas neste aparelho."});
const [confirmed,setConfirmed]=useState(10);window.__setJob=setJob;window.__setConfirmed=setConfirmed;
return <main className="dark" style={{padding:12,maxWidth:420}}>
<Toaster/><OperationSyncNotice job={job}/>
<div data-testid="attention-slot"><PendingProOperationNotice jobId="job-1" driverId="driver" companyId="company" confirmed={confirmed} total={10} serverProgress={confirmed}/></div></main>;}
createRoot(document.getElementById("root")).render(<App/>);` },
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", loader: { ".css": "empty" }, logLevel: "error",
  define: { "process.env.NODE_ENV": '"test"', "import.meta.env.DEV": "false" },
  plugins: [{ name: "stubs", setup(b) {
    const map = [[/services\/operationOutbox$/, stubs.outbox], [/lib\/simpleAutomationNative$/, stubs.native], [/hooks\/useMissingOperationTrip$/, stubs.recovery], [/\/ProPendingAuthButton$/, stubs.auth]];
    for (const [filter, contents] of map) {
      b.onResolve({ filter }, args => ({ path: args.path, namespace: "stub", pluginData: contents }));
    }
    b.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ contents: args.pluginData, loader: "tsx", resolveDir: root }));
  } }],
});
const html = `<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="bg-slate-900"><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.NVU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NVU_CHROMIUM_EXECUTABLE } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const check = async (name, run) => { await run(); results.push(name); console.log("PASS " + name); };
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.fulfill({ contentType: "text/html", body: html }) : route.abort());
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:43841/");
  const notice = page.getByTestId("operation-sync-notice");
  const calls = () => page.evaluate(() => window.__calls);
  await check("A saved finish says why it waits", async () => {
    await notice.waitFor();
    assert.match(await notice.getByTestId("operation-sync-message").innerText(), /Finalização salva neste aparelho\. Aguardando o servidor confirmar as viagens salvas neste aparelho\./);
  });
  await check("Offline the notice says the finish waits for the network", async () => {
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.getByText("Sem conexão: será confirmada assim que a rede voltar.").waitFor();
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.getByText("Aguardando o servidor confirmar as viagens salvas neste aparelho.").waitFor();
  });
  await check("Tentar agora releases the backoff and synchronizes the start and the finish", async () => {
    await notice.getByRole("button", { name: "Tentar agora" }).click();
    await page.waitForFunction(() => window.__calls.filter(c => c[0] === "sync").length === 2);
    assert.deepEqual(await calls(), [["retryNow", "job-1"], ["sync", "start"], ["sync", "finish"]]);
  });
  await check("Cancelar finalização asks first, then frees the driver (and repairs the native pause)", async () => {
    await page.evaluate(() => { window.__calls.length = 0; });
    await notice.getByRole("button", { name: "Cancelar finalização" }).click();
    assert.match(await notice.innerText(), /Suas viagens continuam salvas/);
    assert.deepEqual(await calls(), [], "nothing happens before the confirmation");
    await notice.getByRole("button", { name: "Voltar" }).click();
    assert.deepEqual(await calls(), []);
    await notice.getByRole("button", { name: "Cancelar finalização" }).click();
    await notice.getByRole("button", { name: "Sim, cancelar" }).click();
    await page.waitForFunction(() => window.__calls.some(c => c[0] === "reconcile"));
    assert.deepEqual(await calls(), [["cancel", "job-1"], ["reconcile"]]);
  });
  await check("A finish being sent right now is not cancelled and the driver is told", async () => {
    await page.evaluate(() => { window.__calls.length = 0; window.__cancelOk = false; });
    await notice.getByRole("button", { name: "Cancelar finalização" }).click();
    await notice.getByRole("button", { name: "Sim, cancelar" }).click();
    await page.waitForFunction(() => window.__calls.some(c => c[0] === "cancel"));
    assert.deepEqual(await calls(), [["cancel", "job-1"]], "no native reconcile when nothing was cancelled");
    await page.getByText("A finalização está sendo enviada agora").waitFor();
    await page.evaluate(() => { window.__cancelOk = true; });
  });
  await check("A rejected finish keeps the readable message, Tentar sincronizar and Cancelar finalização", async () => {
    await page.evaluate(() => window.__setJob({ id: "job-1", operationSyncState: "finish_rejected", operationSyncError: "O servidor encontrou mais viagens do que o previsto nesta operação." }));
    const text = await notice.innerText();
    assert.match(text, /mais viagens do que o previsto/); assert.doesNotMatch(text, /OPERATION_/);
    await notice.getByRole("button", { name: "Tentar sincronizar" }).waitFor(); await notice.getByRole("button", { name: "Cancelar finalização" }).waitFor();
  });

  // The amber card.
  const attention = page.getByTestId("pro-attention-notice");
  const setQueue = rows => page.evaluate(rows => { window.__queue = rows; window.dispatchEvent(new Event("nvu-completed-operation-queue-cleaned")); }, rows);
  const row = (queueStatus, extra = {}) => ({ attemptId: "attempt-1", jobId: "job-1", companyId: "company", driverId: "driver", queueStatus, ...extra });
  const settle = () => page.waitForTimeout(400);
  await check("A receipt only waiting for the network does NOT show the amber card (it is a row of the operation history)", async () => {
    await page.evaluate(() => window.__setConfirmed(9));
    for (const status of ["WAITING", "SENDING", "QUEUED"]) { await setQueue([row(status)]); await settle(); assert.equal(await attention.count(), 0, status); }
  });
  await check("When the server already confirmed every delivery, leftover attempts ask nothing of the driver", async () => {
    await setQueue([row("WAITING"), row("AUTH_REQUIRED", { attemptId: "attempt-2" }), row("FAILED", { attemptId: "attempt-3" })]);
    await page.evaluate(() => window.__setConfirmed(10)); await settle();
    assert.equal(await attention.count(), 0);
  });
  await check("It appears only when the driver must act: confirm the Google account (with the attempt to replay)", async () => {
    await page.evaluate(() => window.__setConfirmed(9)); await setQueue([row("AUTH_REQUIRED")]);
    await attention.waitFor({ timeout: 8000 });
    assert.match(await attention.innerText(), /Operação atual: 9\/10 confirmadas/);
    assert.match(await attention.innerText(), /Confirme a conta Google do motorista/);
    assert.equal(await attention.getByTestId("auth-button").getAttribute("data-attempts"), "attempt-1");
    assert.doesNotMatch(await attention.innerText(), /tentativa salva neste aparelho|serão descartadas/);
  });
  await check("It also appears for a receipt that needs review, and for a server inconsistency", async () => {
    await setQueue([row("FAILED")]); await attention.waitFor({ timeout: 8000 });
    assert.match(await attention.innerText(), /1 viagem salva exige revisão/);
    await setQueue([]); await attention.waitFor({ state: "detached", timeout: 8000 });
    await page.evaluate(() => { window.__recovery = { jobId: "job-1", status: "conflict", serverProgress: 10, confirmedCount: 9, reason: "X", retry: () => {} }; window.__setConfirmed(8); window.__setConfirmed(9); });
    await attention.waitFor({ timeout: 8000 });
    assert.match(await attention.innerText(), /reconciliação/);
  });
  assert.deepEqual(errors, [], "no page errors");
  await fs.mkdir("reports", { recursive: true });
  await fs.writeFile("reports/offline-flow-ui.json", JSON.stringify({ result: "PASS", results }, null, 2));
  console.log(`OFFLINE_FLOW_UI_PASS (${results.length} checks)`);
} finally { await browser.close(); }
