/** R3 offline-safe regression suite. No Firebase connection and no writes to production. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { resolveVehiclePhotoOperationSimulatorId as resolve, resolveVehiclePhotoOperationSimulatorEvidence as evidence } from '../functions/scripts/generated/photo-domain.mjs';
import { auditRankingPhotoCoverage } from '../functions/scripts/photo-coverage-core.mjs';
import { collectPhotoCandidates } from '../functions/scripts/photo-audit-core.mjs';

// Exercise actual TypeScript source, not just the prebuilt audit bundle.
const tsCompiler = createRequire(import.meta.url)('typescript');
const compiledModule = (relativePath, imports = {}) => {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const output = tsCompiler.transpileModule(source, {compilerOptions:{module:tsCompiler.ModuleKind.CommonJS,target:tsCompiler.ScriptTarget.ES2022}});
  assert.equal(output.diagnostics?.length || 0, 0);
  const m = {exports:{}};
  new Function('module','exports','require',output.outputText)(m,m.exports,id=>{
    if (!(id in imports)) throw new Error(`Unexpected dependency: ${id}`);
    return imports[id];
  });
  return m.exports;
};
const simulatorModule = compiledModule('../src/lib/resolveSimulator.ts');
const actualIdentity = compiledModule('../src/lib/vehiclePhotoIdentity.ts', {'./resolveSimulator':simulatorModule});
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log(`PASS R3 ${name}`); };
await check('application resolver and audit resolver agree across representative conflicts', () => {
  const cases = [
    [{vehicleId:'truck'},null,'gto'],
    [{vehicleId:'truck',simulatorId:'gto'},null,'gto'],
    [{simulatorId:'gto',simuladorId:'ets2'}, {simulatorId:'gto'}, 'gto'],
    [{simulatorId:'global-truck-online'},null,'gto'],
    [null,{simulatorId:'ets2'},'gto'],
    [{vehicleId:'truck'},null,'gto',[],[],[{simuladorId:'gto'}]],
    [{simulatorId:'ets2'},null,'all'],
  ];
  for (const args of cases) {
    assert.equal(actualIdentity.resolveVehiclePhotoOperationSimulatorId(...args),resolve(...args));
    assert.deepEqual(actualIdentity.resolveVehiclePhotoOperationSimulatorEvidence(...args),evidence(...args));
  }
});
await check('legacy metadata requires canonical simulator evidence', () => {
  const repo = compiledModule('../src/services/vehiclePhotoRepository.ts',{
    'firebase/firestore': {}, '../lib/vehiclePhotoIdentity':actualIdentity,
  });
  const identity = {userId:'owner',simulatorId:'gto',vehicleId:'truck'};
  const data = {vehiclePhotos:{truck:{vehicleId:'truck',url:'https://example.test/a.webp'}}};
  assert.equal(repo.findRemoteVehiclePhoto(data,identity),null);
  data.vehiclePhotos.truck.simulatorId='Global Truck Online';
  assert.equal(repo.findRemoteVehiclePhoto(data,identity),'https://example.test/a.webp');
  data.vehiclePhotos.truck.simuladorId='ets2';
  assert.equal(repo.findRemoteVehiclePhoto(data,identity),null);
  data.vehiclePhotos.truck.simulatorId='ets2';
  assert.equal(repo.findRemoteVehiclePhoto(data,identity),null);
});
await check('ambiguous filtered operation never adopts filter as evidence', () => {
  assert.equal(resolve({vehicleId:'truck'}, {name:'Empresa'}, 'gto'), '');
  assert.equal(resolve({vehicleId:'truck'}, null, 'gto', [], [], [{name:'Scania',simulatorId:'gto'}]), 'gto');
  assert.equal(resolve({simulatorId:'ets2'}, null, 'gto'), '');
});
await check('contradictory fields inside one operation are rejected', () => {
  const value = {vehicleId:'truck',simulatorId:'gto',simuladorId:'ets2'};
  assert.equal(resolve(value, {simulatorId:'gto'}, 'gto'), '');
  assert.equal(evidence(value, {simulatorId:'gto'}, 'gto').conflict, true);
  assert.equal(resolve({simulatorId:'gto',simuladorId:'global-truck-online'}, null, ''), 'gto');
});
await check('coverage classifies internal conflicts separately from missing metadata', async () => {
  const report = await auditRankingPhotoCoverage({
    users:[{id:'u'}], companies:[{id:'c',simulatorId:'gto'}],
    jobs:[{id:'j',driverId:'u',companyId:'c',vehicleId:'v',status:'completed',simulatorId:'gto',simuladorId:'ets2'}],
  });
  assert.equal(report.counts.CONFLICT_SIMULATOR_CONTEXT,1);
  assert.equal(report.expectedIdentities,0);
});
await check('migration rejects conflicting original fields despite matching company', () => {
  const result=collectPhotoCandidates('u', {vehiclePhotosV2:{v:{vehicleId:'v',simulatorId:'gto',simuladorId:'ets2',url:'https://example.test/image.webp'}}},
    {companies:[{id:'c',simulatorId:'gto'}],vehicles:[{id:'v',companyId:'c'}]});
  assert.equal(result[0].status, 'REJECTED_CONFLICT_SIMULATOR_FIELDS');
});

// Tiny IndexedDB model: primary contains a previously synced photo. Its next
// write fails, forcing the browser's localStorage recovery to preserve a newer
// pending photo. Read and queue enumeration must prefer the durable fallback.
const primary = new Map();
let failWrites = false;
const local = new Map();
const localStorage = {
  get length() { return local.size; }, key: i => [...local.keys()][i] || null,
  getItem: k => local.get(k) ?? null, setItem: (k,v) => { local.set(k,String(v)); },
  removeItem: k => { local.delete(k); },
};
const makeReadRequest = (get, transaction) => {
  const request = {result:undefined, onsuccess:null};
  setTimeout(() => {
    request.result = get();
    request.onsuccess?.({target:request});
    setTimeout(() => transaction.oncomplete?.(),0);
  },0);
  return request;
};
const db = {
  createObjectStore() { return {createIndex(){}}; }, close(){},
  transaction(name, mode) {
    const tx = {oncomplete:null,onabort:null,onerror:null,error:null};
    tx.objectStore = () => ({
      get: key => makeReadRequest(() => primary.get(key), tx),
      put: value => {
        if (failWrites) setTimeout(() => { tx.error = new Error('QuotaExceededError'); tx.onabort?.(); },0);
        else { primary.set(value.key,value); setTimeout(() => tx.oncomplete?.(),0); }
      },
      index: () => ({getAll: id => makeReadRequest(() => [...primary.values()].filter(x => x.userId === id),tx)}),
    });
    return tx;
  },
};
const indexedDB = {open(){const r={result:db,onupgradeneeded:null,onsuccess:null};setTimeout(()=>{r.onupgradeneeded?.();r.onsuccess?.();},0);return r;}};
const keyOf = ({userId,simulatorId,vehicleId}) => `nvu-vehicle-photo:v2:${[userId,simulatorId,vehicleId].map(encodeURIComponent).join(':')}`;
const ts = tsCompiler;
const content = fs.readFileSync(new URL('../src/services/vehiclePhotoStore.ts',import.meta.url),'utf8');
const compiled = ts.transpileModule(content, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const storeModule={exports:{}};
const fakeRequire = name => {
  if (name.includes('vehiclePhotoIdentity')) return {vehiclePhotoKey:keyOf, belongsToVehiclePhoto:(record,id)=>Boolean(record && record.userId===id.userId && record.simulatorId===id.simulatorId && record.vehicleId===id.vehicleId)};
  throw new Error('Unexpected import '+name);
};
new Function('module','exports','require','indexedDB','localStorage','navigator','window','CustomEvent',compiled)(
  storeModule,storeModule.exports,fakeRequire,indexedDB,localStorage,{storage:{persist:async()=>true}},undefined,undefined,
);
const store=storeModule.exports;
const photo=(revision,status)=>({userId:'u',simulatorId:'gto',vehicleId:'v',key:keyOf({userId:'u',simulatorId:'gto',vehicleId:'v'}),
  companyId:'c',revision,updatedAt:Date.now(),imageDataUrl:'data:image/webp;base64,YQ==',posterDataUrl:'data:image/jpeg;base64,Yg==',contentType:'image/webp',status});
await check('IndexedDB stale synced version cannot mask newer pending fallback', async()=>{
  const old=photo('old','synced');primary.set(old.key,old);
  failWrites=true;
  const next=photo('new','pending');
  assert.equal(await store.putVehiclePhotoRecord(next),true);
  assert.equal((await store.getVehiclePhotoRecord(next))?.revision,'new');
  const pending=await store.listPendingVehiclePhotos('u');
  assert.equal(pending.length,1);assert.equal(pending[0].revision,'new');
});
await check('publication retries update fallback despite different IndexedDB revision', async()=>{
  failWrites=false;
  const next=photo('new','pending');
  const updated=await store.updateVehiclePhotoRecord(next,{remoteUrl:'https://example.test/new.webp',needsPublication:true});
  assert.equal(updated?.revision,'new');
  assert.equal((await store.getVehiclePhotoRecord(next))?.needsPublication,true);
  assert.equal((await store.listPendingVehiclePhotos('u')).length,1);
  assert.equal(primary.get(next.key).revision,'old');
});
await check('ranking recovers simulator from linked vehicle without guesswork', async () => {
  const vehicles = new Map([['explicit',{id:'explicit',name:'Volvo',simulatorId:'gto'}], ['unknown',{id:'unknown',name:'Scania'}]]);
  let job = {id:'job',driverId:'participant',companyId:'firm',vehicleId:'explicit',status:'completed',completedAt:1000};
  const firestore = {
    collection: (_,name) => name,
    where: (field,op,value) => ({field,value}),
    limit: value => ({limit:value}),
    startAfter: value => ({after:value}),
    query: (source,...constraints) => ({source,constraints}),
    doc: (_,collection,id) => ({collection,id}),
    getDocs: async spec => {
      const eq = spec.constraints.find(c=>c.field)?.field;
      const match = eq && job[eq] === 'participant' ? [job] : [];
      return {docs:match.map(v=>({id:v.id,data:()=>v})),metadata:{fromCache:false}};
    },
    getDoc: async spec => ({id:spec.id,exists:()=>vehicles.has(spec.id),data:()=>vehicles.get(spec.id)}),
  };
  const ranking = compiledModule('../src/hooks/useRankingParticipantVehicle.ts', {
    react:{}, 'firebase/firestore':firestore, '../lib/firebase':{db:{}},
    '../lib/currentOperation':{selectCurrentOperationJob:()=>null,operationAssignmentTimestamp:j=>j.completedAt || 0,operationSelectionDriverId:j=>j.driverId},
    '../lib/vehiclePhotoIdentity':actualIdentity,'../services/vehiclePhotoIdentitySnapshot':{},
  });
  const ctx = simulatorId => ({simulatorId,viewerId:'viewer',companies:[{id:'firm',name:'Empresa'}],simulators:[]});
  const query = ranking.__rankingParticipantVehicleTestOnly.loadParticipantVehicle;
  assert.equal((await query('participant','firm',ctx('gto'))).operation?.vehicleId,'explicit');
  assert.equal((await query('participant','firm',ctx('ets2'))).operation,null);
  job={...job,id:'job2',vehicleId:'unknown'};
  const ambiguous=await query('participant','firm',ctx('gto'));
  assert.equal(ambiguous.operation,null);
  assert.equal(ambiguous.authoritative,false);
  job={...job,id:'job3',vehicleId:'explicit',simulatorId:'gto',simuladorId:'ets2'};
  const conflict=await query('participant','firm',ctx('gto'));
  assert.equal(conflict.operation,null);
  assert.equal(conflict.authoritative,false);
});
console.log(JSON.stringify({passed,failed:0,backendWrites:0}));
