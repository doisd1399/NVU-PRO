import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { act } from "react";
const root = process.cwd(), output = path.join(root, "verification/fila-ativacao/preparation-fixture.mjs");
fs.mkdirSync(path.dirname(output), { recursive: true });
await build({ entryPoints: ["scripts/fixtures/operational-queues.tsx"], outfile: output,
  bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic",
  loader: { ".css": "empty" }, plugins: [{ name: "local-context", setup(build) {
    build.onResolve({ filter: /\/contexts\/AutomaticOperationsProvider$/ }, () =>
      ({ path: path.join(root, "scripts/fixtures/queue-context.tsx") }));
    build.onResolve({ filter: /\/context\/AppContext$/ }, () =>
      ({ path: path.join(root, "scripts/fixtures/queue-context.tsx") }));
  } }] });
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://127.0.0.1/", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "getComputedStyle"])
  Object.defineProperty(globalThis, key, { value: key === "getComputedStyle" ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key], configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const settle = async (fn = () => {}) => act(async () => { await fn(); await new Promise((resolve) => setTimeout(resolve, 10)); });
const button = (name) => [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === name || el.getAttribute("aria-label") === name);
async function click(name) { const el = button(name); assert.ok(el, `button ${name} exists`); assert.equal(el.disabled, false); await settle(() => el.click()); }
async function check(label) {
  const el = [...document.querySelectorAll("label")].find((el) => el.textContent.includes(label))?.querySelector("input");
  assert.ok(el, `input ${label} exists`); assert.equal(el.disabled, false); await settle(() => el.click());
}
const results = [];
async function test(name, fn) { await fn(); results.push({ name, result: "PASS" }); console.log(`PASS ${name}`); }
try {
  await settle(() => import(pathToFileURL(output).href));
  await test("blocked activation has no writes and retains the reordered draft", async () => {
    await settle(() => window.__queues.reset({ role: "manager", empty: true, scenario: "preparation-blocked" }));
    await click("Nova fila"); await click("Continuar"); await click("Continuar");
    await click("Descer Entrega no porto"); await click("Ativar fila");
    assert.equal(window.__queues.calls().length, 0);
    assert.match(document.body.textContent, /Etapa 3 de 3/);
    assert.ok(document.querySelector('section[aria-label="Conferência de trabalhos"]'));
    assert.equal(button("Corrigir 1 cadastro(s) compatível(is)").disabled, true);
    assert.equal(button("Manter selecionado e cancelar os demais").disabled, true);
  });
  await test("normalization requires explicit confirmation and never activates automatically", async () => {
    await check("Confirmo a atualização dos campos antigos");
    await click("Corrigir 1 cadastro(s) compatível(is)");
    assert.equal(window.__queues.calls().filter((call) => call.action === "normalizeLegacyJobs").length, 1);
    assert.equal(window.__queues.calls().filter((call) => call.action === "saveQueue").length, 0);
    assert.equal(button("Manter selecionado e cancelar os demais").disabled, true);
    assert.match(document.body.textContent, /Etapa 3 de 3/);
  });
  await test("conflict cancellation requires a chosen survivor and a separate confirmation", async () => {
    assert.equal(document.querySelectorAll('input[type="radio"]:checked').length, 0);
    await check("Manter Entrega no porto");
    assert.equal(button("Manter selecionado e cancelar os demais").disabled, true);
    await check("Confirmo o cancelamento dos");
    await click("Manter selecionado e cancelar os demais");
    const resolution = window.__queues.calls().find((call) => call.action === "resolveLegacyConflict");
    assert.equal(resolution.keepJobId, "old-1"); assert.equal(resolution.confirmed, true);
    assert.match(document.body.textContent, /A conferência somente de leitura está pronta/);
    const enableConfirmation = document.querySelector('input[aria-label="Confirmo habilitar os comandos operacionais desta empresa"]');
    assert.ok(enableConfirmation);
    assert.equal(enableConfirmation.checked, false);
    assert.equal(button("Ativar fila").disabled, true);
    assert.equal(window.__queues.calls().some((call) => call.action === "enableOperationalCommands"), false);
    assert.equal(window.__queues.calls().filter((call) => call.action === "saveQueue").length, 0);
  });
  await test("review completion rebases revision and saves the exact original chosen queue order", async () => {
    await check("Confirmo habilitar os comandos operacionais desta empresa");
    await click("Ativar fila");
    const actions = window.__queues.calls().map((call) => call.action);
    assert.ok(actions.indexOf("enableOperationalCommands") >= 0);
    assert.ok(actions.indexOf("enableOperationalCommands") < actions.indexOf("saveQueue"));
    const save = window.__queues.calls().find((call) => call.action === "saveQueue");
    assert.deepEqual(save.queue.orderIds, ["c2", "c1"]);
    assert.equal(save.expectedRevision, 3);
    assert.ok(button("Nova fila"));
    assert.equal(document.querySelector('section[aria-label="Conferência de trabalhos"]'), null);
  });
  await test("a normal ready company activates without the preparation repair UI", async () => {
    await settle(() => window.__queues.reset({ role: "manager", empty: true }));
    await click("Nova fila"); await click("Continuar"); await click("Continuar"); await click("Ativar fila");
    assert.equal(window.__queues.calls().filter((call) => call.action === "saveQueue").length, 1);
    assert.equal(window.__queues.calls().some((call) => call.action === "resolveLegacyConflict"), false);
  });
  console.log(`OPERATIONAL_PREPARATION_UI ${results.length}/${results.length} PASS`);
} finally {
  fs.writeFileSync(path.join(root, "verification/fila-ativacao/preparation-ui.json"), JSON.stringify({ environment: "jsdom; no real browser or Android", results }, null, 2));
  await settle(() => window.__queues?.unmount());
  dom.window.close();
}
