import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const cwd = process.cwd(), fixture = path.join(cwd, "scripts/fixtures/fluency-476-ports.ts");
const result = await build({ entryPoints: ["scripts/fixtures/fluency-476-tests.tsx"], bundle: true, write: false,
  platform: "node", format: "cjs", packages: "external", loader: { ".css": "empty" },
  plugins: [{ name: "isolated-ports", setup(b) {
    b.onResolve({ filter: /^(firebase\/(?:firestore|functions))$|\/(?:lib\/(?:firebase|operationalQueueCache)|context\/(?:AppContext|CompanyContext)|FirebaseTripSyncAdapter|TripReconciliationService)$/ }, () => ({ path: fixture }));
  } }] });
const dom = new JSDOM('<html class="light"><head><meta name="theme-color" content="transparent"></head><body><div id="root"></div></body></html>',
  { url: "http://localhost", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "localStorage", "HTMLElement", "Element", "Node", "MutationObserver", "CustomEvent", "StorageEvent", "Event", "getComputedStyle"])
  Object.defineProperty(globalThis, key, { value: key === "window" ? dom.window : dom.window[key], configurable: true });
Object.defineProperty(navigator, "onLine", { value: true, configurable: true, writable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const compiled = new Module(path.join(cwd, "scripts/.fluency-476.cjs"));
compiled.filename = path.join(cwd, "scripts/.fluency-476.cjs"); compiled.paths = Module._nodeModulePaths(path.join(cwd, "scripts"));
compiled._compile(result.outputFiles[0].text, compiled.filename);
const T = compiled.exports, cases = [];
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const tick = ms => T.act(async () => { await delay(ms); });
async function within(promise, ms = 800) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Response remained blocked")), ms); })]); } finally { clearTimeout(timer); } }
async function until(fn) { for (let n = 0; n < 40 && !fn(); n++) await delay(2); assert(fn(), "Expected asynchronous state"); }
async function test(name, fn) { await fn(); cases.push({ name, result: "PASS" }); console.log(`PASS ${name}`); }
const $ = selector => document.querySelector(selector);
const settings = (revision = 0) => ({ companyId: T.state.companyId, schemaVersion: 1, revision, queues: [], vehicleIds: null, driverVehicles: [] });
const view = (token = "one", companyId = T.state.companyId) => ({ companyId, driverId: T.state.uid, simulatorId: "gto", configRevision: 1,
  viewToken: token, historyToken: token, generatedAt: new Date().toISOString(), queues: [], items: [], vehicles: [], next: null,
  currentJob: null, manualPendingIds: [], reason: "no_queues" });
const page = (input, v = view()) => ({ success: true, version: 1, kind: "driver", companyId: input.companyId, viewToken: v.viewToken,
  totalItems: 0, offset: 0, nextOffset: null, view: v, items: [] });
const storage = () => { const map = new Map(); return { getItem: k => map.get(k) || null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) }; };
const makeTrip = (id, uid = "driver-476", value = 100) => T.TripRegistrationService.register({ tripId: id, canonicalTripId: id, idempotencyKey: id,
  driverId: uid, companyId: "company-476", contractId: "contract-476", jobId: `job-${id}`, origem: "A", destino: "B", valor: value,
  source: "PRINT_PRO_REGISTRATION", imageHash: `hash-${id}` });
const ack = trip => ({ confirmed: true, tripId: trip.tripId, data: { ...trip, serverValidatedAt: new Date().toISOString() } });
const engine = (adapter, getCurrentUser = () => ({ uid: "driver-476" })) => {
  const dbStorage = storage(); return new T.SyncEngine({ adapter, getCurrentUser, storage: dbStorage, offlineDatabase: new T.OfflineDatabase({ storage: dbStorage }) });
};
const reactErrors = [], oldError = console.error;
console.error = (...args) => { reactErrors.push(args.map(String).join(" ")); oldError(...args); };
try {
  await test("Tema tem uma única autoridade; montar páginas não regrava o tema nem pisca classes", async () => {
    localStorage.setItem("frotalog-theme", "light");
    let mutations = 0, writes = 0;
    const observer = new MutationObserver(records => { mutations += records.length; });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const prototype = Object.getPrototypeOf(localStorage), original = prototype.setItem;
    prototype.setItem = function(k, v) { if (k === "frotalog-theme") writes++; return original.call(this, k, v); };
    try {
      await T.themes(2); await T.themes(3); await T.themes(2);
      assert.equal(mutations, 0); assert.equal(writes, 0);
      await T.act(async () => $('#theme-0').click());
      assert.equal(writes, 1); assert.equal($('#theme-1').textContent, "dark");
      const afterToggle = mutations;
      await T.themes(4); await T.themes(1);
      assert.equal(mutations, afterToggle); assert.equal(writes, 1);
      await T.act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "frotalog-theme", newValue: "light" })));
      assert.equal($('#theme-0').textContent, "light"); assert.equal(writes, 1);
    } finally { observer.disconnect(); prototype.setItem = original; await T.clear(); }
  });
  await test("Rolagem atualiza CSS do cabeçalho sem renderizar o painel a cada movimento", async () => {
    await T.chrome(); const initial = T.chromeRenders;
    for (let n = 0; n < 8; n++) { T.setHeroBottom(165 - n * 5); window.dispatchEvent(new Event("scroll")); await tick(20); }
    assert.equal(T.chromeRenders, initial); assert.equal($('header').dataset.nvuHeroChrome, "active");
    T.setHeroBottom(20); window.dispatchEvent(new Event("scroll")); await tick(20);
    assert.equal(T.chromeRenders, initial + 1); assert.equal($('header').dataset.nvuHeroChrome, "settled");
    assert.equal($('header').style.getPropertyValue("--nvu-chrome-progress"), "1"); await T.clear();
  });
  await test("Cache lento não mantém fila em loading após uma leitura completa do servidor", async () => {
    const cache = defer(); let writes = 0;
    T.setCacheWriter(() => { writes++; return cache.promise; });
    T.setTransport(async (_name, input) => page(input)); await T.queue(); await tick(70);
    assert(T.api.fresh); assert.equal(T.api.loading, false); assert.equal(T.api.view.viewToken, "one"); assert(writes > 0);
    await T.act(async () => cache.resolve(true)); await T.clear();
  });
  await test("Revisões repetidas do sinal não disparam novas leituras da fila", async () => {
    let reads = 0; T.setCacheWriter(async () => true);
    T.setTransport(async (_name, input) => { reads++; return page(input); });
    await T.queue(); await tick(65);
    await T.act(async () => { T.emitSignal(7); T.emitSignal(7); }); await tick(65);
    const once = reads;
    await T.act(async () => { T.emitSignal(7); T.emitSignal(7); }); await tick(65);
    assert.equal(reads, once);
    await T.act(async () => T.emitSignal(8)); await tick(65); assert.equal(reads, once + 1); await T.clear();
    assert.equal(T.signalListeners(), 0);
  });
  await test("Conclusão muda a fila e uma resposta tardia não vaza para outra empresa", async () => {
    const late = defer(); let mode = "running";
    T.setTransport(async (_name, input) => mode === "late" ? late.promise : page(input, { ...view(mode), currentJob: mode === "running" ? { id: "job-476", contractId: "contract-476", status: "active" } : null }));
    await T.queue(); await tick(65); assert.equal(T.api.view.currentJob.id, "job-476");
    mode = "finished";
    await T.act(async () => T.changeState({ jobs: [{ id: "job-476", companyId: "company-476", driverId: "driver-476", status: "completed" }] }));
    await tick(5); assert.equal(T.api.view.viewToken, "finished"); assert.equal(T.api.view.currentJob, null);
    mode = "late"; let request;
    await T.act(async () => { request = T.api.refresh(); });
    mode = "other";
    await T.act(async () => T.changeState({ companyId: "company-other" }));
    assert.equal(T.api.view, null); assert.equal(T.api.fresh, false);
    await T.act(async () => { late.resolve(page({ companyId: "company-476" }, view("foreign", "company-476"))); await request; });
    assert.notEqual(T.api.view?.viewToken, "foreign"); await tick(65);
    assert.equal(T.api.view.companyId, "company-other"); await T.clear();
    T.changeState({ companyId: "company-476", jobs: [] });
  });
  await test("Atualizações concorrentes compartilham a leitura; sinal novo invalida uma única vez", async () => {
    let reads=0, hold=false; const gate=defer(); T.setCacheWriter(async()=>true);
    T.setTransport(async(_name,input)=>{reads++;if(hold)await gate.promise;return page(input,view("coalesced"));});
    await T.queue();await tick(65);const initial=reads;hold=true;
    let one,two;
    await T.act(async()=>{one=T.api.refresh();two=T.api.refresh();});
    assert.equal(reads,initial+1,"duplicate callers do not add a second read");
    await T.act(async()=>T.emitSignal(999));
    await T.act(async()=>{hold=false;gate.resolve();await Promise.all([one,two]);});
    await tick(65);assert.equal(reads,initial+2,"one actual new signal schedules one follow-up read");await T.clear();
  });
  await test("Salvar configuração retorna no ACK sem esperar a consulta secundária", async () => {
    T.changeState({ role: "admin" }); const reread = defer(); let block = false;
    T.setTransport(async (name, input) => name === "configureOperationalQueues"
      ? { success: true, version: 1, companyId: T.state.companyId, requestId: input.requestId, action: input.action, settings: settings(2) }
      : block ? reread.promise : { settings: settings(1) });
    await T.queue(); await tick(65); block = true;
    let result; await T.act(async () => { result = await within(T.api.save({ action: "saveVehicles", expectedRevision: 1, vehicleIds: [] })); });
    assert.equal(result.settings.revision, 2); assert.equal(T.api.settings.revision, 2);
    await T.act(async () => reread.resolve({ settings: settings(2) })); await T.clear(); T.changeState({ role: "driver" });
  });
  await test("Sincronização drena comandos novos sem aguardar o temporizador de retry", async () => {
    const gate = defer(), sent = [];
    const e = engine({ push: async trip => { sent.push(trip.tripId); if (sent.length === 1) await gate.promise; return ack(trip); } });
    await e.enqueue(makeTrip("drain-first")); const running = e.synchronize();
    await until(() => sent.length === 1); await e.enqueue(makeTrip("drain-second"));
    gate.resolve(); const result = await within(running);
    assert.equal(result.synchronized, 2); assert.equal(e.getResult("drain-second").state, "SERVER_CONFIRMED");
    assert.deepEqual(sent, ["drain-first", "drain-second"]);
  });
  await test("Recibo de operação local aguarda início confirmado sem tentativas ocupadas", async () => {
    const dbStorage=storage(), sent=[];let pending=true;
    const e=new T.SyncEngine({adapter:{push:async trip=>{sent.push(trip.tripId);return ack(trip);}},
      getCurrentUser:()=>({uid:"driver-476"}),storage:dbStorage,offlineDatabase:new T.OfflineDatabase({storage:dbStorage}),
      operationStartPending:(uid,jobId)=>pending && uid==="driver-476" && jobId==="job-start-dependency"});
    await e.enqueue({...makeTrip("start-dependency"),jobId:"job-start-dependency"});
    await e.synchronize();assert.deepEqual(sent,[]);assert.equal(e.getResult("start-dependency").state,"PENDING_SYNC");
    assert.equal(e.retryTimer,null,"operation supervisor owns the wake-up, no 750ms idle loop");
    pending=false;await e.synchronize();assert.deepEqual(sent,["start-dependency"]);
    assert.equal(e.getResult("start-dependency").state,"SERVER_CONFIRMED");
  });
  await test("ACK não espera reconciliação lenta e erros de painel não revertem confirmação", async () => {
    const gate = defer(); const e = engine({ push: async trip => ack(trip) });
    e.reconciliation = { reconcileConfirmedTrip: () => gate.promise };
    await e.enqueue(makeTrip("slow-reconciliation")); const result = await within(e.synchronize(), 150);
    assert.equal(result.synchronized, 1); assert.equal(e.getResult("slow-reconciliation").state, "SERVER_CONFIRMED"); gate.resolve();
  });
  await test("Edição de outra viagem persiste mesmo durante uma sincronização em andamento", async () => {
    const gate = defer(), editGate = defer(), sent = []; let editStarted = false;
    const e = engine({ push: async trip => { sent.push(trip.tripId); await gate.promise; return ack(trip); },
      update: async (trip, patch, _base, editId) => { editStarted = true; await editGate.promise; return { ...ack(trip), data: { ...ack(trip).data, ...patch, lastEditId: editId } }; } });
    await e.enqueue(makeTrip("unrelated-upload")); const running = e.synchronize(); await until(() => sent.length === 1);
    const trip = makeTrip("independent-edit");
    const edit = await within(e.enqueueUpdate(trip, { origem: "C" }, "driver-476", 1, trip), 150);
    assert(edit.editId); await until(() => editStarted); assert.equal(e.getResult(trip.tripId).state, "SYNCING");
    editGate.resolve(); await until(() => e.getResult(trip.tripId).state === "SERVER_CONFIRMED");
    assert.equal(sent.length, 1); gate.resolve(); await within(running);
  });
  await test("Uma nova edição consulta seu próprio recibo, sem reutilizar uma confirmação antiga", async () => {
    const trip = makeTrip("edit-receipt-scope"), secondGate = defer(); let reject = true;
    const e = engine({ push: async value => ack(value), update: async (value, patch, _base, editId) => {
      if (reject) throw Object.assign(Error("Old edit rejected"), { code: "functions/permission-denied" });
      await secondGate.promise; return { ...ack(value), data: { ...ack(value).data, ...patch, lastEditId: editId } };
    } });
    const first = await e.enqueueUpdate(trip, { origem: "C" }, "driver-476", 1, trip); await e.synchronize();
    assert.equal(e.getResult(trip.tripId, first.editId).state, "FAILED"); reject = false;
    const second = await e.enqueueUpdate(trip, { origem: "D" }, "driver-476", 1, trip);
    assert.notEqual(first.editId, second.editId); const secondSync = e.synchronize();
    await until(() => e.getResult(trip.tripId, second.editId).state === "SYNCING");
    secondGate.resolve(); await secondSync; assert.equal(e.getResult(trip.tripId, second.editId).state, "SERVER_CONFIRMED");
    assert.equal(e.getResult(trip.tripId, first.editId).state, "FAILED");
  });
  await test("Um lote não envia a versão antiga de um comando alterado durante outra requisição", async () => {
    const gate = defer(), sent = [];
    const e = engine({ push: async trip => { sent.push(trip); if (sent.length === 1) await gate.promise; return ack(trip); } });
    await e.enqueue(makeTrip("claim-first")); await e.enqueue({ ...makeTrip("claim-second", undefined, 10), jobId: "job-claim-first" });
    const running = e.synchronize(); await until(() => sent.length === 1);
    await e.enqueue({ ...makeTrip("claim-second", undefined, 20), jobId: "job-claim-first", syncVersion: 2 }); gate.resolve(); await within(running);
    assert.equal(sent[1].valor, 20); assert.equal(e.getResult("claim-second").trip.valor, 20);
  });
  await test("Mudança de conta impede o envio das próximas viagens do lote antigo", async () => {
    const gate = defer(), sent = []; let uid = "driver-476";
    const e = engine({ push: async trip => { sent.push(trip.tripId); await gate.promise; return ack(trip); } }, () => ({ uid }));
    await e.enqueue(makeTrip("owner-first")); await e.enqueue({ ...makeTrip("owner-second"), jobId: "job-owner-first" });
    const running = e.synchronize(); await until(() => sent.length === 1); uid = "another-user"; gate.resolve(); await within(running);
    assert.deepEqual(sent, ["owner-first"]); assert.equal(e.getResult("owner-second").state, "PENDING_SYNC");
  });
  await test("Edição e registro lentos liberam a tela como pendentes, sem inventar ACK", async () => {
    const gate = defer(), trip = { ...makeTrip("pending-ui"), editPending: true };
    const service = new T.CanonicalTripCommandService({ save: async () => trip, editFields: async () => trip },
      { getCurrentUser: () => ({ uid: "driver-476" }), isOffline: () => false, sync: { synchronize: () => gate.promise, getResult: () => undefined } });
    const edited = await within(service.update(trip.tripId, { origem: "C" })); assert.equal(edited.editPending, true);
    const registered = await within(service.addTripWithinOperationLimit(makeTrip("pending-registration")));
    assert.equal(registered.offline, true); assert(registered.localId); gate.resolve({ synchronized: 0, results: [], validated: false });
  });
  await test("Respostas rápidas só são confirmadas após ACK; rejeições continuam visíveis", async () => {
    const trip = makeTrip("fast-ack"), gate = defer(); let saved;
    const service = new T.CanonicalTripCommandService({ save: async () => trip, editFields: async () => ({ ...trip, editPending: true }) },
      { getCurrentUser: () => ({ uid: "driver-476" }), isOffline: () => false, sync: { synchronize: () => gate.promise, getResult: () => saved } });
    const command = service.update(trip.tripId, { origem: "C" });
    saved = { state: "SERVER_CONFIRMED", operation: "UPDATE", trip: { ...trip, editPending: false } }; gate.resolve({});
    assert.equal((await command).editPending, false);
    saved = { state: "FAILED", lastError: "PERMISSION_DENIED" };
    await assert.rejects(() => service.update(trip.tripId, { origem: "C" }), /PERMISSION_DENIED/);
  });
  assert.deepEqual(reactErrors, [], "React warnings/errors");
  fs.mkdirSync("reports", { recursive: true });
  fs.writeFileSync("reports/fluency-476-tests.json", JSON.stringify({ result: "PASS", cases,
    scope: "React DOM/jsdom + actual client classes, deterministic local ports; no production network or physical-device latency claim" }, null, 2));
  console.log(`FLUENCY_476_PASS ${cases.length} scenarios; no production requests`);
} finally { await T.unmount(); console.error = oldError; dom.window.close(); }
