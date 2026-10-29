import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import Module from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(), fixture=path.resolve('scripts/fixtures/navigation-489-ports.ts');
const bundle=await build({stdin:{resolveDir:root,sourcefile:'navigation-audit.tsx',loader:'tsx',contents:`
import React,{Activity} from 'react';import {createRoot} from 'react-dom/client';export {act} from 'react';
import {useTripHistory} from './src/hooks/useTripHistory';import {useDriverTrips} from './src/hooks/useDriverTrips';import {useOperationalGoal} from './src/hooks/useOperationalGoal';
export {beginAuthTeardown,endAuthTeardown} from './src/lib/authLifecycle';export * from './scripts/fixtures/navigation-489-ports';
export let state={},renders=0;let root;
function Company({id,owners}){const value=useTripHistory(id,{userId:'viewer',diagnosticOwnerDriverIds:owners});state[id]=value;renders++;return <output>{id+':'+value.historicoTrips.length+':'+value.loading}</output>;}
function Driver(){const value=useDriverTrips('viewer');state.driver=value;return <output>driver:{value.trips.length}:{String(value.loading)}</output>;}
function Goal(){const scope={viewerId:'viewer',companyId:'company',simulatorId:'gto',periodId:'company__gto__20261001_20261031'};state.goal=useOperationalGoal(scope,scope.periodId,true);return <output>{state.goal.target}:{state.goal.error}</output>;}
export function render({visible=true,second=false,id='company',goal=false,driver=false}={}){root??=createRoot(document.getElementById('root'));root.render(goal?<Goal/>:driver?<Activity mode={visible?'visible':'hidden'}><Driver/></Activity>:<><Activity mode={visible?'visible':'hidden'}><Company id={id} owners={[]}/></Activity>{second&&<Company id={id} owners={['viewer','alias']}/>}</>);}
export function clear(){root.render(null);}
`},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'remote-adapters',setup(b){b.onResolve({filter:/CanonicalTripQueryService$|CanonicalTripUpdateEvent$|operationalGoalAccess$|\/lib\/firebase$|^firebase\/(auth|firestore)$/},()=>({path:fixture}));}}]});
const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'http://127.0.0.1',pretendToBeVisual:true});
for(const key of ['window','document','navigator','localStorage','HTMLElement','Element','Node','CustomEvent','Event'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
Object.defineProperty(navigator,'onLine',{value:true,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const module=new Module(path.join(root,'scripts/.audit489.cjs'));module.filename=path.join(root,'scripts/.audit489.cjs');module.paths=Module._nodeModulePaths(path.join(root,'scripts'));module._compile(bundle.outputFiles[0].text,module.filename);const T=module.exports;
const cases=[], releases=[];const realTimer=globalThis.setTimeout;
globalThis.setTimeout=(callback,ms,...args)=>ms===120000?(releases.push(()=>callback(...args)),realTimer(()=>{},0)):realTimer(callback,ms,...args);
const act=fn=>T.act(async()=>{await fn();await Promise.resolve();});
const complete={status:'complete',projectionMode:'scoped-history',failedSources:0};
const partial={...complete,status:'partial'};
const trip=id=>({id,tripId:id,canonicalTripId:id,companyId:'company',driverId:'viewer',status:'completed',completedAt:'2026-10-20T10:00:00Z',valorCents:10000,currency:'BRL'});
const latest=()=>T.reads.filter(x=>x.active).at(-1);
async function check(name,fn){await fn();cases.push(name);console.log('PASS '+name);}
try{
 await check('One company query survives aliases, a second consumer and 20 Activity returns',async()=>{
  await act(()=>T.render());assert.equal(T.reads.length,1);const read=latest();
  await act(()=>{read.data([trip('one'),trip('two')]);read.coverage(complete);});
  await act(()=>T.render({second:true}));assert.equal(T.reads.length,1);assert.deepEqual(read.owners,['alias','viewer']);
  for(let n=0;n<20;n++){await act(()=>T.render({visible:false}));await act(()=>T.render());}
  assert.equal(T.reads.length,1);assert.equal(T.state.company.loading,false);assert.equal(T.state.company.historicoTrips.length,2);
 });
 await check('A partial alias never shrinks the existing history; a complete response updates it without loading',async()=>{
  const read=latest();await act(()=>{read.coverage(partial);read.data([trip('one')]);});
  assert.equal(T.state.company.historicoTrips.length,2);
  await act(()=>{read.coverage(partial);read.data([trip('one'),trip('two'),trip('three')]);read.coverage(complete);});
  assert.equal(T.state.company.historicoTrips.length,3);assert.equal(T.state.company.loading,false);assert.match(document.querySelector("output").textContent,/company:3:false/);
 });
 await check('Idle release stops remote work and retains data; a confirmed empty scope returns without loading',async()=>{
  await act(()=>T.clear());await act(()=>releases.splice(0).forEach(f=>f()));assert.equal(latest(),undefined);
  await act(()=>T.render());assert.equal(T.state.company.historicoTrips.length,3);assert.equal(T.state.company.loading,false);
  await act(()=>{latest().data([]);latest().coverage(complete);});assert.equal(T.state.company.historicoTrips.length,0);
  await act(()=>T.clear());await act(()=>releases.splice(0).forEach(f=>f()));await act(()=>T.render());assert.equal(T.state.company.loading,false);assert.equal(T.state.company.historicoTrips.length,0);
 });
 await check('Company changes cannot expose the previous scope; a real read failure remains visible',async()=>{
  await act(()=>T.render({id:'other'}));assert.equal(T.state.other.historicoTrips.length,0);assert.equal(T.state.other.loading,true);
  await act(()=>latest().error({code:'unavailable'}));assert.equal(T.state.other.error.code,'unavailable');
  await act(()=>T.clear());
 });
 await check('Driver aliases assemble in the background and retain a full snapshot',async()=>{
  await act(()=>T.render({driver:true}));const read=latest();await act(()=>{read.data([trip('a'),trip('b')]);read.coverage(complete);});
  await act(()=>{read.coverage(partial);read.data([trip('a')]);});assert.equal(T.state.driver.trips.length,2);
  await act(()=>{read.data([]);read.coverage(complete);});assert.equal(T.state.driver.loading,false);
  await act(()=>T.clear());await act(()=>releases.splice(0).forEach(f=>f()));await act(()=>T.render({driver:true}));assert.equal(T.state.driver.loading,false);
  await act(()=>T.clear());
 });
 await check('Denied legacy goal access recovers via canonical server authority and a real save ACK',async()=>{
  T.goalState.directDenied=true;await act(()=>T.render({goal:true}));assert.equal(T.state.goal.error,'');assert.equal(T.state.goal.target,100000);assert.equal(T.goalState.calls.length,1);
  await act(()=>T.state.goal.save(250000.5,'range:2026-10-01:2026-10-31'));assert.equal(T.state.goal.pending,false);assert.equal(T.goalState.amount,250000.5);assert.equal(T.goalState.writes,1);
  const count=T.goalState.calls.length;for(let n=0;n<8;n++){await act(()=>T.clear());await act(()=>T.render({goal:true}));}
  assert.equal(T.goalState.calls.length,count,'Reopening does not requery the goal');
 });
 await check('Missing deployment, denied membership and offline edits stay truthful without retry loops',async()=>{
  T.goalState.managedError='functions/not-found';await act(()=>T.state.goal.retry());assert.match(T.state.goal.error,/atualizado no servidor/);
  const count=T.goalState.calls.length;await act(()=>{window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));});assert.equal(T.goalState.calls.length,count);
  T.goalState.managedError='functions/permission-denied';await act(()=>T.state.goal.retry());assert.match(T.state.goal.error,/vínculo/);
  Object.defineProperty(navigator,'onLine',{value:false,configurable:true});await act(()=>T.state.goal.save(300000,'range:2026-10-01:2026-10-31'));assert.equal(T.state.goal.pending,true);
  T.goalState.managedError='';Object.defineProperty(navigator,'onLine',{value:true,configurable:true});await act(()=>T.state.goal.retry());assert.equal(T.state.goal.pending,false);assert.equal(T.goalState.amount,300000);
 });
 await check('Logout blocks a delayed response from the preceding account',async()=>{
  let resolve;T.goalState.delay=new Promise(r=>resolve=r);await act(()=>{void T.state.goal.retry();});
  await act(()=>{T.beginAuthTeardown();T.auth.currentUser=null;resolve();});await act(()=>T.clear());T.endAuthTeardown();
 });
 await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/navigation-audit-489.json',JSON.stringify({result:'PASS',checks:cases,productionAccess:false},null,2));
 console.log(`NAVIGATION_AUDIT_489_PASS ${cases.length} scenarios`);
}finally{await act(()=>T.clear());globalThis.setTimeout=realTimer;dom.window.close();}
