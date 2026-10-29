import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import Module from "node:module";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url), cwd = process.cwd();
const fixture = path.join(cwd, "scripts/fixtures/workspace-475-ports.ts");
const result = await build({ entryPoints: ["scripts/fixtures/workspace-475-tests.tsx"], bundle: true, write: false,
  platform: "node", format: "cjs", packages: "external", loader: { ".css": "empty" },
  plugins: [{ name: "offline-test-ports", setup(b) { b.onResolve({ filter: /\/(?:context\/AppContext|contexts\/AutomaticOperationsProvider|lib\/(?:navigationTransition|routePreload))$/ }, () => ({ path: fixture })); } }] });
const dom = new JSDOM('<!doctype html><html lang="pt-BR"><body><div id="root"></div></body></html>', { url: "http://localhost" });
const w = dom.window;
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "CustomEvent", "Event", "getComputedStyle"])
  Object.defineProperty(globalThis, key, { value: key === "window" ? w : w[key], configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const compiled = new Module(path.join(cwd, "scripts/.workspace-475-tests.cjs"));
compiled.filename = path.join(cwd, "scripts/.workspace-475-tests.cjs"); compiled.paths = Module._nodeModulePaths(path.join(cwd, "scripts"));
compiled._compile(result.outputFiles[0].text, compiled.filename);
const T = compiled.exports, cases = [];
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
async function click(s) { const e = typeof s === "string" ? $(s) : s; assert(e, `Control missing: ${s}`); await T.act(async () => { e.click(); }); }
const button = text => $$('button').find(b => (b.getAttribute("aria-label") || b.textContent.trim()) === text);
async function test(name, fn) { await fn(); cases.push({ name, result: "PASS" }); console.log(`PASS ${name}`); }
const errors = [], oldError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(" ")); oldError(...args); };
try {
  await test("Rotas e estados da dock respeitam motorista, empresa e seleção inválida", async () => {
    assert.equal(T.workspaceDockActive("/driver/profile", { profileTab: "ranking" }, "driver"), "dashboard");
    assert.equal(T.workspaceDockActive("/driver/profile", { profileTab: "operations" }, "driver"), "activity");
    assert.equal(T.workspaceDockActive("/driver/trip", {}, "driver"), null);
    assert.equal(T.workspaceDockActive("/admin/senior", {}, "admin"), null);
    assert.equal(T.workspaceDockRole("/driver/news", { workspaceDockRole: "admin" }, "admin"), "driver");
    assert.equal(T.workspaceDockTarget("driver", "invalid"), null);
    assert.deepEqual(T.workspaceDockTarget("admin", "profile"), { pathname: "/admin/fleet", state: { activeTab: "company" } });
  });
  await test("Dock permanece no News e ranking e retorna às seis áreas do motorista", async () => {
    for (const entry of ["/driver/news", "/ranking"]) {
      for (const label of ["Trabalho", "Atividade", "Resultados", "NVU News", "Ranking", "Perfil"]) {
        await T.resetDock("driver", entry);
        assert.equal($$('nav button').length, 6);
        await click(button(label));
        const route = JSON.parse($('#route-state').textContent);
        const id = ["Trabalho", "Atividade", "Resultados", "NVU News", "Ranking", "Perfil"].indexOf(label);
        assert.equal(route.pathname, id === 3 ? "/driver/news" : id === 4 ? "/ranking" : "/driver/profile");
        if (id < 3 || id === 5) assert.equal(route.state.profileTab, ["dashboard", "activity", "results", "news", "ranking", "profile"][id]);
        if (entry === "/ranking" && id !== 4) assert(!route.state?.backgroundLocation, "Overlay state must be cleared on exit");
        assert.equal($$('nav [aria-current="page"]').length, 1);
      }
    }
  });
  await test("Dock da empresa abre Gestão, Atividade, Resultados, News, Ranking e Empresa", async () => {
    const expected = { "Gestão": ["/admin/fleet", "operations"], "Atividade": ["/admin/history"], "Resultados": ["/admin/reports"],
      "NVU News": ["/admin/news"], "Ranking": ["/ranking"], "Empresa": ["/admin/fleet", "company"] };
    for (const [label, [pathname, activeTab]] of Object.entries(expected)) {
      await T.resetDock("admin", "/ranking", { workspaceDockRole: "admin" });
      assert.equal($('nav').getAttribute('aria-label'), "Navegação da empresa");
      await click(button(label)); const route = JSON.parse($('#route-state').textContent);
      assert.equal(route.pathname, pathname); if (activeTab) assert.equal(route.state.activeTab, activeTab);
    }
    await T.resetDock("admin", "/admin/fleet", { activeTab: "company" });
    assert.equal($('nav [aria-current="page"]').getAttribute("aria-label"), "Empresa");
  });
  await test("Ranking preserva nomes completos das empresas e todas as métricas", async () => {
    await T.showRanking();
    assert.deepEqual($$('.nvu-gamer-row-name').map(n => n.childNodes[0].textContent), T.rankingNames);
    assert.equal($$('.nvu-gamer-money').length, T.rankingNames.length);
    assert.equal($$('.nvu-gamer-trips').length, T.rankingNames.length);
  });
  await test("Próxima operação fica antes de uma fila de 20 itens e abre seleção do veículo", async () => {
    const calls = []; await T.showQueue(T.queueView(), async (...args) => { calls.push(args); });
    assert.equal($$('details').length, 4);
    assert(!$$('details').some(e => e.textContent.includes("BLS - 10")));
    await click(button("Ver fila completa"));
    assert.equal($$('details').length, 20);
    assert($('.nvu-queue-next-action').compareDocumentPosition($('details')) & w.Node.DOCUMENT_POSITION_FOLLOWING);
    await click(button("Iniciar trabalho"));
    assert.equal($('[role="dialog"]').getAttribute('aria-label'), "Escolher veículo");
    assert.equal($$('input[type="radio"]').length, 2);
    assert.equal($('input:checked').value, "v1");
    await click(button("Confirmar e iniciar"));
    assert.equal(calls.length, 1); assert.equal(calls[0][0].contractId, "c14"); assert.equal(calls[0][1], "v1");
    assert.equal($('[role="dialog"]'), null); assert.equal(T.refreshes(), 1);
  });
  await test("Próxima permanece disponível com histórico recolhido e duplo toque envia um único comando", async () => {
    let resolve, calls = 0;
    await T.showQueue(T.queueView(), async () => { calls++; await new Promise(r => { resolve = r; }); });
    await click($('.nvu-queue-heading button'));
    assert($('.nvu-queue-entries').hidden);
    await click(button("Iniciar trabalho"));
    const confirm = button("Confirmar e iniciar");
    await T.act(async () => { confirm.click(); confirm.click(); });
    assert.equal(calls, 1); assert(confirm.disabled);
    await T.act(async () => { resolve(); });
  });
  await test("Finalização atualiza de Em andamento para a próxima operação sem remontar a fila", async () => {
    const running = T.queueView(); running.reason = "running"; running.next = null; running.currentJob = { id: "job13", contractId: "c13", status: "active" };
    await T.showQueue(running, async () => {}); await click($('.nvu-queue-heading button'));
    assert(!button("Iniciar trabalho"));
    await T.updateQueue(T.queueView());
    assert(button("Iniciar trabalho"));
    await click(button("Iniciar trabalho")); assert($('[role="dialog"]').textContent.includes("BLS - 140"));
  });
  await test("Offline, resposta antiga, operação ativa e mudança de token impedem início", async () => {
    let calls = 0;
    for (const flags of [{ offline: true }, { fresh: false }, { loading: true }]) {
      await T.showQueue(T.queueView(), async () => { calls++; }, flags); await click($('.nvu-queue-heading button'));
      assert(button("Iniciar trabalho").disabled); await click(button("Iniciar trabalho")); assert(!$('[role="dialog"]'));
    }
    await T.showQueue(T.queueView(), async () => { calls++; }); await click($('.nvu-queue-heading button')); await click(button("Iniciar trabalho"));
    const changed = T.queueView(); changed.next.previewToken = "changed"; await T.updateQueue(changed);
    assert(button("Confirmar e iniciar").disabled); await click(button("Confirmar e iniciar")); assert.equal(calls, 0);
  });
  await test("Falha de início mantém a confirmação disponível e solicita nova leitura", async () => {
    await T.showQueue(T.queueView(), async () => { throw new Error("Não foi possível confirmar"); });
    await click($('.nvu-queue-heading button')); await click(button("Iniciar trabalho")); await click(button("Confirmar e iniciar"));
    assert($('[role="dialog"]')); assert(!button("Confirmar e iniciar").disabled); assert.equal(T.refreshes(), 1);
  });
  await T.cleanup(); assert.deepEqual(errors, []);
} finally {
  console.error = oldError; dom.window.close();
  const report = { cases, productionAccess: false, browserLayoutVerified: false, method: "React DOM + jsdom com portas isoladas; sem Firebase, simulador ou dispositivo físico.",
    sourceBase: "1.0.477", presentationRevision: "Fila integrada e dock acessível sem legendas" };
  fs.mkdirSync("reports", { recursive: true }); fs.writeFileSync("reports/workspace-475-regressions.json", JSON.stringify(report, null, 2) + "\n");
}
console.log(`WORKSPACE_475 ${cases.length}/${cases.length} PASS`);
