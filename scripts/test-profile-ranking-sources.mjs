import assert from "node:assert/strict";
import { build } from "esbuild";

// Exercise the actual query facade and Firebase adapter with controlled snapshots.
const fixtures = `
const records=new Map();const listeners=new Set();
export const remote=[];
export const auth={currentUser:{uid:"viewer"}};export const db={};
export function seed(values){records.clear();values.forEach(v=>records.set(v.canonicalTripId,v));}
const applyReadSnapshots=(values)=>{values.forEach(v=>records.set(v.canonicalTripId||v.id,v));listeners.forEach(fn=>fn([...records.values()]));};
export const canonicalTripRepository={list:()=>[...records.values()],listPending:()=>[],subscribe:(fn)=>{listeners.add(fn);fn([...records.values()]);return()=>listeners.delete(fn);},applyServerSnapshots:applyReadSnapshots,applyServerReadSnapshots:applyReadSnapshots};
export const canonicalTripRealtimeService={subscribe:()=>()=>{}};
export const collection=(_db,name)=>({name});export const where=(field,op,value)=>({field,op,value});
export const query=(source,...filters)=>({source,filters});
export function onSnapshot(query,options,next,error){const item={query,options,next,error,closed:false};remote.push(item);return()=>{item.closed=true;};}
export function snapshot(item,values,fromCache=false,hasPendingWrites=false){item.next({docs:values.map(v=>({id:v.canonicalTripId,data:()=>v})),metadata:{fromCache,hasPendingWrites}});}
`;
const result = await build({
  stdin: {
    contents: `export {CanonicalTripQueryService} from "./src/application/trip/CanonicalTripQueryService";export * from "profile-source-fixtures";`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [
    {
      name: "source-fixtures",
      setup(plugin) {
        plugin.onResolve(
          { filter: /^profile-source-fixtures$|^firebase\/firestore$/ },
          () => ({ path: "fixtures", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: fixtures,
          loader: "ts",
        }));
        plugin.onLoad(
          {
            filter:
              /src\/(lib\/firebase|repositories\/CanonicalTripRepository|application\/trip\/CanonicalTripRealtimeService)\.ts$/,
          },
          () => ({
            contents: 'export * from "profile-source-fixtures";',
            resolveDir: process.cwd(),
            loader: "ts",
          }),
        );
      },
    },
  ],
});
const api = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
const start = new Date("2026-10-01T03:00:00Z"),
  end = new Date("2026-11-01T02:59:59.999Z");
const dc = {
  canonicalTripId: "own",
  companyId: "dc",
  driverId: "viewer",
  completedAt: "2026-10-02T12:00:00Z",
};
const foreign = {
  canonicalTripId: "foreign",
  companyId: "matecom",
  driverId: "viewer",
  completedAt: "2026-10-02T12:00:00Z",
};
const old = {
  canonicalTripId: "old",
  companyId: "dc",
  driverId: "viewer",
  completedAt: "2026-09-02T12:00:00Z",
};
const legacy = {
  canonicalTripId: "legacy",
  empresaId: "dc",
  motoristaId: "viewer",
  completedAt: "2026-10-03T12:00:00Z",
};
api.seed([dc, foreign, old]);
let data = [],
  confirmations = 0,
  confirmed = false;
const stop = api.CanonicalTripQueryService.listenTripsByDateRange(
  start,
  end,
  (rows) => {
    data = rows;
  },
  undefined,
  { companyId: "dc" },
  (ready) => {
    confirmed = ready;
    if (ready) confirmations++;
  },
);
assert.deepEqual(
  data.map((row) => row.canonicalTripId),
  [],
  "o repositório global de comandos não fornece a geração atual da consulta",
);
assert.equal(
  api.remote.length,
  2,
  "os dois aliases autorizados devem ser observados",
);
assert.ok(
  api.remote.every((listener) => listener.options.includeMetadataChanges),
);
api.snapshot(api.remote[0], [dc], true);
assert.deepEqual(data.map(row => row.canonicalTripId), ["own"], "o cache da consulta atual respeita empresa e datas");
assert.equal(confirmations, 0, "cache do Firebase não confirma completude");
api.snapshot(api.remote[0], [dc]);
assert.equal(confirmations, 0, "um alias não representa toda a empresa");
api.snapshot(api.remote[1], [legacy]);
assert.equal(
  confirmations,
  1,
  "todos os aliases confirmados liberam o ranking",
);
assert.deepEqual(data.map((row) => row.canonicalTripId).sort(), [
  "legacy",
  "own",
]);
api.snapshot(api.remote[0], [dc], false, true);
assert.equal(
  confirmed,
  false,
  "escrita pendente invalida a comparação antes da projeção local",
);
api.snapshot(api.remote[0], [dc]);
assert.equal(confirmed, true, "a confirmação remota restaura a comparação");
stop();
assert.ok(api.remote.every((listener) => listener.closed));
console.log(
  "PASS consulta real filtra repositório local e aguarda os dois aliases do servidor",
);

let partialConfirmed = 0;
const first = api.remote.length;
const stopPartial = api.CanonicalTripQueryService.listenTripsByDateRange(
  start,
  end,
  () => {},
  () => {},
  { companyIds: ["dc", "matecom"] },
  (ready) => {
    if (ready) partialConfirmed++;
  },
);
const chunks = api.remote.slice(first);
assert.equal(chunks.length, 4);
chunks[0].error(new Error("fixture permission denied"));
chunks.forEach((listener) => api.snapshot(listener, []));
assert.equal(
  partialConfirmed,
  0,
  "falha em qualquer consulta impede confirmação parcial",
);
stopPartial();
console.log("PASS falha em uma fonte impede liberar um ranking parcial");

api.seed([
  dc,
  foreign,
  { ...dc, canonicalTripId: "someone-else", driverId: "someone-else" },
]);
let ownerRows = [];
const stopOwner = api.CanonicalTripQueryService.listenTripsByDateRange(
  start,
  end,
  (rows) => {
    ownerRows = rows;
  },
);
assert.deepEqual(ownerRows.map((row) => row.canonicalTripId).sort(), [
]);
const ownerListeners = api.remote.slice(-4);
assert.equal(ownerListeners.length, 4, "o histórico do motorista consulta todos os aliases permitidos pelas Rules");
ownerListeners.forEach(listener => api.snapshot(listener, listener.query.filters[0].field === "driverId" ? [dc, foreign] : []));
assert.deepEqual(ownerRows.map(row => row.canonicalTripId).sort(), ["foreign", "own"]);
stopOwner();
console.log(
  "PASS escopo padrão usa o motorista autenticado, sem misturar outros motoristas",
);
console.log("profile-ranking-sources: 3 scenarios passed");
