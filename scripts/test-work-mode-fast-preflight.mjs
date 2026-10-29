import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import { build } from "esbuild";

const root=process.cwd(), key="nvu.work-mode-availability.v1";
const qa={calls:0,resolve:null};globalThis.__workModeQA=qa;
const values=new Map();
globalThis.window={localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)}};
Object.defineProperty(globalThis,"navigator",{configurable:true,value:{onLine:true}});
const source=`const qa=globalThis.__workModeQA;export const doc=()=>({});export const auth={currentUser:null},db={},functions={};
export const httpsCallable=()=>async()=>{throw Error("No production writes in this harness");};
export const getDocFromServer=async()=>{qa.calls++;return new Promise(resolve=>{qa.resolve=value=>resolve({data:()=>({workModeAvailability:value})});});};`;
const output=await build({entryPoints:["src/services/workModeAvailabilityService.ts"],bundle:true,write:false,platform:"node",format:"cjs",
  plugins:[{name:"isolated-work-mode-ports",setup(p){
    p.onResolve({filter:/^firebase\/(firestore|functions)$|lib\/firebase$/},a=>({path:a.path,namespace:"qa-work-mode"}));
    p.onLoad({filter:/.*/,namespace:"qa-work-mode"},()=>({contents:source,loader:"js"}));
  }}]});
function service(){const m=new Module(path.join(root,"scripts/.work-mode-qa.cjs"));m.filename=path.join(root,"scripts/.work-mode-qa.cjs");m.paths=Module._nodeModulePaths(root);m._compile(output.outputFiles[0].text,m.filename);return m.exports;}
const availability=(enabled=true)=>({version:7,print:{enabled,simulators:{gto:enabled}},pro:{enabled,simulators:{gto:enabled}},max:{enabled,simulators:{gto:enabled}}});
async function fast(task){let timer;try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("Cached preflight waited for the server")),100);})]);}finally{clearTimeout(timer);}}
values.set(key,JSON.stringify(availability()));
let s=service();let value=await fast(s.getWorkModeAvailability());assert.equal(value.version,7);assert.equal(qa.calls,1);
await Promise.all(Array.from({length:10},()=>fast(s.getWorkModeAvailability())));assert.equal(qa.calls,1,"Repeated entry shares one background request");
let legacySettled=false;
const legacy=s.assertServerNewOperationAllowed("gto").then(()=>{legacySettled=true;},error=>{legacySettled=true;throw error;});
await Promise.resolve();assert.equal(legacySettled,false,"legacy replay waits for a real server snapshot, not the UI cache");
qa.resolve(availability(false));await assert.rejects(legacy,/manutenção/);await new Promise(resolve=>setImmediate(resolve));
assert.throws(()=>s.assertCachedNewOperationAllowed("gto"),/manutenção/);
await assert.rejects(s.assertWorkModeEntryAllowed("pro","gto"),/manutenção/);
console.log("PASS cached entry responds immediately; late maintenance result replaces it; requests are shared");
s=service();navigator.onLine=false;value=await fast(s.getWorkModeAvailability());assert.equal(value.pro.enabled,false);
await assert.rejects(s.assertWorkModeEntryAllowed("pro","gto"),/manutenção/);
console.log("PASS known maintenance remains enforced offline");
values.clear();navigator.onLine=true;s=service();
const started=performance.now();value=await s.getWorkModeAvailability();
assert(performance.now()-started<2100,"Cold preflight is bounded even with a hung server");assert.equal(value.pro.enabled,true);
assert.equal(values.has(key),false,"Timeout fallback is never persisted as a server fact");
qa.resolve(availability(false));await new Promise(resolve=>setImmediate(resolve));
assert.throws(()=>s.assertCachedNewOperationAllowed("gto"),/manutenção/);
console.log("PASS uncached preflight is bounded; timeout fallback is not a confirmed maintenance snapshot");
console.log("WORK_MODE_FAST_PREFLIGHT_PASS (3 scenarios)");
