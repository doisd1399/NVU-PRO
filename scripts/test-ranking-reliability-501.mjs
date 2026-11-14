import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
const root = process.cwd(), output = path.join(root, 'qa-ranking-reliability-501');
await fs.mkdir(output,{recursive:true});
const dom = new JSDOM('<html><body></body></html>',{url:'https://fixture.invalid'});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.localStorage=dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const originals={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,now:Date.now};
let clock=Date.now(), counter=0, timers=new Map();
globalThis.setTimeout=(fn,delay=0)=>{const id=++counter;timers.set(id,{fn,at:clock+delay});return id;};
globalThis.clearTimeout=id=>timers.delete(id);Date.now=()=>clock;
const tick=async ms=>{const until=clock+ms;for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at).find(([,v])=>v.at<=until);if(!next)break;timers.delete(next[0]);clock=next[1].at;await act(async()=>next[1].fn());}clock=until;await act(async()=>{});};
const stubs={
 repo:`export const readCachedRankingAggregate=(...a)=>globalThis.__repo.readCached(...a);export const invalidateRankingAggregateCaches=()=>{};export const ensureRankingAggregate=(...a)=>globalThis.__repo.ensure(...a);export const readRankingAggregateFromServer=(...a)=>globalThis.__repo.readServer(...a);export const listenRankingAggregate=(...a)=>globalThis.__repo.listen(...a);`,
 events:'export const onCanonicalTripUpdated=()=>()=>{};',firebase:'export const db={};export const functions={};',
 firestore:'export const collection=(...a)=>a;export const documentId=()=>"__name__";export const query=(...a)=>a;export const where=(...a)=>a;export const getDocsFromServer=(...a)=>globalThis.__metadataRead(...a);export const doc=(...a)=>a;export const onSnapshot=()=>()=>{};export const getDoc=()=>Promise.resolve({exists:()=>false});export const getDocFromServer=()=>Promise.resolve({exists:()=>false});',
 functions:'export const httpsCallable=()=>()=>Promise.resolve({data:{status:"in_progress"}});',
 lifecycle:'export const isAuthTeardownActive=()=>false;export const onAuthTeardown=()=>()=>{};',
};
const plugin={name:'fixture-transports',setup(b){
 b.onResolve({filter:/RankingAggregateRepository$/},()=>({path:'repo',namespace:'fixture'}));
 b.onResolve({filter:/CanonicalTripUpdateEvent$/},()=>({path:'events',namespace:'fixture'}));
 b.onResolve({filter:/lib\/firebase$/},()=>({path:'firebase',namespace:'fixture'}));
 b.onResolve({filter:/^firebase\/firestore$/},()=>({path:'firestore',namespace:'fixture'}));
 b.onResolve({filter:/^firebase\/functions$/},()=>({path:'functions',namespace:'fixture'}));
 b.onResolve({filter:/authLifecycle$/},()=>({path:'lifecycle',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],loader:'js'}));
}};
for(const [name,entry] of [['aggregate','src/hooks/useRankingAggregate.ts'],['companies','src/hooks/useRankingCompaniesByIds.ts'],['repository','src/repositories/RankingAggregateRepository.ts']])
 await build({entryPoints:[path.join(root,entry)],outfile:path.join(output,`${name}.mjs`),bundle:true,format:'esm',platform:'node',packages:'external',plugins:[plugin],logLevel:'silent'});
const {useRankingAggregate}=await import(pathToFileURL(path.join(output,'aggregate.mjs')));
const {useRankingCompaniesByIds}=await import(pathToFileURL(path.join(output,'companies.mjs')));
const repository=await import(pathToFileURL(path.join(output,'repository.mjs')));
const aggregate=()=>({schemaVersion:5,simulatorId:'gto',periodType:'mes',periodKey:'2026-10',periodTimeZone:'America/Sao_Paulo',periodPolicy:'SAO_PAULO_CALENDAR',complete:true,sourceTripCount:1,lastReconciledAt:new Date(clock-1000).toISOString(),companies:{company:{trips:1,val:100}},drivers:{driver:{trips:1,val:100,companyId:'company'}}});
const options={enabled:true,simulatorId:'gto',periodType:'mes',periodKey:'2026-10'};
const checks=[];
const check=async(name,run)=>{await run();checks.push(name);console.log('PASS',name);};
const reset=()=>{timers.clear();globalThis.__repo={readCached:()=>null,listen:()=>()=>{},ensure:()=>new Promise(()=>{}),readServer:()=>Promise.resolve(null)};};
async function mount(hook){const node=document.createElement('div');document.body.append(node);const root=createRoot(node);let state;function Probe(){state=hook();return null;}await act(async()=>root.render(React.createElement(Probe)));return{get state(){return state;},rerender:()=>act(async()=>root.render(React.createElement(Probe))),unmount:async()=>{await act(async()=>root.unmount());node.remove();}};}
try {
 await check('Listener silencioso encerra carregamento aos 12 segundos',async()=>{reset();const p=await mount(()=>useRankingAggregate(options));await tick(12_001);assert.equal(p.state.status,'unavailable');assert.ok(p.state.error);await p.unmount();});
 await check('Ausência confirmada também termina em erro recuperável',async()=>{reset();__repo.listen=(_s,_t,_k,next)=>{next(null);return()=>{};};const p=await mount(()=>useRankingAggregate(options));await tick(12_001);assert.equal(p.state.status,'unavailable');await p.unmount();});
 await check('Cache do período aberto permanece visível quando atualização falha',async()=>{reset();const saved=aggregate();__repo.readCached=()=>saved;__repo.ensure=()=>Promise.reject(new Error('offline'));const p=await mount(()=>useRankingAggregate({...options,refreshOnRead:true}));assert.equal(p.state.status,'ready');assert.equal(p.state.aggregate,saved);assert.equal(p.state.stale,true);assert.equal(p.state.error,null);await p.unmount();});
 await check('in_progress é acompanhado sem apagar cache e sem repetição infinita',async()=>{reset();let calls=0;__repo.readCached=()=>aggregate();__repo.ensure=()=>{calls++;return Promise.resolve({status:'in_progress'});};const p=await mount(()=>useRankingAggregate({...options,refreshOnRead:true}));await tick(7_001);assert.ok(calls>=2);await tick(6_000);const stopped=calls;await tick(60_000);assert.equal(calls,stopped);assert.equal(p.state.status,'ready');assert.equal(p.state.stale,true);assert.equal(p.state.refreshing,false);await p.unmount();});
 await check('Callback tardio completo recupera a tela após o prazo',async()=>{reset();let send;__repo.listen=(_s,_t,_k,next)=>{send=next;return()=>{};};const p=await mount(()=>useRankingAggregate(options));await tick(12_001);assert.equal(p.state.status,'unavailable');await act(async()=>send({...aggregate(),lastReconciledAt:new Date(clock).toISOString()}));assert.equal(p.state.status,'ready');await p.unmount();});
 await check('Consulta de empresas sem resposta tem timeout de 10 segundos',async()=>{reset();globalThis.__metadataRead=()=>new Promise(()=>{});const p=await mount(()=>useRankingCompaniesByIds(['hang_company_501'],true));await tick(10_001);assert.equal(p.state.loading,false);assert.equal(p.state.complete,false);assert.ok(p.state.error);await p.unmount();});
 await check('Identidade pública ausente não produz ranking parcial confirmado',async()=>{reset();globalThis.__metadataRead=()=>Promise.resolve({docs:[]});const p=await mount(()=>useRankingCompaniesByIds(['missing_company_501'],true));assert.equal(p.state.complete,false);assert.equal(p.state.loading,false);assert.ok(p.state.error);await p.unmount();});
 await check('Cache de empresas incompleto é recusado na inicialização offline',async()=>{reset();localStorage.setItem('nvu.ranking.companies.v501.incomplete_a|incomplete_b',JSON.stringify({ids:['incomplete_a','incomplete_b'],companies:[{id:'incomplete_a',companyName:'Parcial'}]}));globalThis.__metadataRead=()=>Promise.reject(new Error('offline'));const p=await mount(()=>useRankingCompaniesByIds(['incomplete_a','incomplete_b'],true));assert.equal(p.state.complete,false);assert.equal(p.state.serverConfirmed,false);await p.unmount();});
 await check('Um lote incompleto nunca é marcado como universo confirmado',async()=>{reset();let calls=0;globalThis.__metadataRead=()=>++calls===1?Promise.resolve({docs:[{id:'partial',data:()=>({companyName:'Parcial'})}]}):Promise.reject(new Error('offline'));const ids=Array.from({length:31},(_,i)=>`partial_${i}`);const p=await mount(()=>useRankingCompaniesByIds(ids,true));assert.equal(p.state.complete,false);assert.equal(p.state.serverConfirmed,false);assert.equal(p.state.loading,false);assert.ok(p.state.error);await p.unmount();});
 await check('Snapshot completo das empresas é reutilizado offline após descarte da memória',async()=>{reset();globalThis.__metadataRead=()=>Promise.resolve({docs:[{id:'cached_company_501',data:()=>({companyName:'Salva',status:'active'})}]});let p=await mount(()=>useRankingCompaniesByIds(['cached_company_501'],true));assert.equal(p.state.complete,true);await p.unmount();await tick(120_001);globalThis.__metadataRead=()=>Promise.reject(new Error('offline'));p=await mount(()=>useRankingCompaniesByIds(['cached_company_501'],true));assert.equal(p.state.complete,true);assert.equal(p.state.serverConfirmed,true);assert.equal(p.state.companies[0].companyName,'Salva');assert.equal(p.state.stale,true);assert.equal(p.state.loading,false);await p.unmount();});
 await check('Resposta antiga de outro filtro não substitui a seleção atual',async()=>{reset();let finish,ids=['scope_old_501'];globalThis.__metadataRead=()=>ids[0]==='scope_old_501'?new Promise(r=>{finish=r;}):Promise.resolve({docs:[{id:'scope_new_501',data:()=>({companyName:'Nova'})}]});const p=await mount(()=>useRankingCompaniesByIds(ids,true));ids=['scope_new_501'];await p.rerender();await act(async()=>finish({docs:[{id:'scope_old_501',data:()=>({companyName:'Antiga'})}]}));assert.equal(p.state.companies[0].companyName,'Nova');await p.unmount();});
 await check('Agregado completo persistido sobrevive a uma inicialização sem memória',async()=>{const key='nvu.ranking.aggregate.v501.v5__gto__2026-10';localStorage.setItem(key,JSON.stringify({aggregate:aggregate(),cachedAt:clock}));assert.equal(repository.readCachedRankingAggregate('gto','2026-10').sourceTripCount,1);});
 await check('Cache de outro simulador ou agregado parcial é recusado',async()=>{localStorage.setItem('nvu.ranking.aggregate.v501.v5__wrong__period',JSON.stringify({aggregate:aggregate(),cachedAt:clock}));assert.equal(repository.readCachedRankingAggregate('wrong','period'),null);localStorage.setItem('nvu.ranking.aggregate.v501.v5__gto__partial',JSON.stringify({aggregate:{...aggregate(),periodKey:'partial',complete:false},cachedAt:clock}));assert.equal(repository.readCachedRankingAggregate('gto','partial'),null);});
 await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/ranking-reliability-501-tests.json',JSON.stringify({actualHooks:true,transportOnlyFixtures:true,virtualTime:true,passed:checks.length,checks},null,2)+'\n');console.log(`RANKING_RELIABILITY_501_PASS ${checks.length}`);
} finally {globalThis.setTimeout=originals.setTimeout;globalThis.clearTimeout=originals.clearTimeout;Date.now=originals.now;dom.window.close();}
