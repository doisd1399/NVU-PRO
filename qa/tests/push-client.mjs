import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import Module from 'node:module';
import {createHash} from 'node:crypto';
import {setImmediate as turn} from 'node:timers/promises';import {build} from 'esbuild';import {JSDOM} from 'jsdom';
const root=path.resolve(import.meta.dirname,'../..'),checks=[];
const hash=s=>createHash('sha256').update(s).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const stubs={
 firebase:'export const functions={};export const auth={get currentUser(){return globalThis.__pushTest.authUser;}};',
 lifecycle:'export const isAuthTeardownActive=()=>globalThis.__pushTest.teardown;',
 core:'export const Capacitor={isNativePlatform:()=>true,getPlatform:()=>"android"};',
 functions:'export const httpsCallable=(_,name)=>async input=>globalThis.__pushTest.rpc(name,input);',
 app:'export const App={addListener:async(_,callback)=>{globalThis.__pushTest.resume=callback;return{remove:async()=>{}};}};',
 native:`const H=()=>globalThis.__pushTest;export const PushNotifications={
  removeAllListeners:async()=>H().listeners.clear(),addListener:async(name,callback)=>{H().listenerAdds++;H().listeners.set(name,callback);return{remove:async()=>{}};},
  createChannel:async v=>H().channels.push(v),checkPermissions:async()=>{H().checks++;return H().checkHook?H().checkHook():{receive:H().permission};},
  requestPermissions:async()=>{H().prompts++;return{receive:H().permission};},
  register:async()=>{H().registrations++;if(H().failNative)throw Error('synthetic failure');H().listeners.get('registration')?.({value:H().token});},unregister:async()=>{H().unregisters++;},removeAllDeliveredNotifications:async()=>{H().clears++;}};`,
};
const built=await build({entryPoints:[path.join(root,'src/lib/capacitorPushService.ts')],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'push-transports',setup(b){
 b.onResolve({filter:/.*/},a=>{const p=a.path,n=/\/firebase$/.test(p)?'firebase':/\/authLifecycle$/.test(p)?'lifecycle':p==='firebase/functions'?'functions':p==='@capacitor/core'?'core':p==='@capacitor/app'?'app':p==='@capacitor/push-notifications'?'native':null;if(n)return{path:n,namespace:'push-test'};});
 b.onLoad({filter:/.*/,namespace:'push-test'},a=>({contents:stubs[a.path],loader:'js'}));
 if(process.env.NVU_PUSH_BASELINE_SOURCE)b.onLoad({filter:/capacitorPushService\.ts$/},()=>({contents:fs.readFileSync(process.env.NVU_PUSH_BASELINE_SOURCE,'utf8'),loader:'ts',resolveDir:path.join(root,'src/lib')}));
}}]});
const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;let H,api,dom;
async function start(){
 dom=new JSDOM('<!doctype html>',{url:'http://localhost',pretendToBeVisual:true});
 for(const k of ['window','document','localStorage','CustomEvent'])Object.defineProperty(globalThis,k,{value:k==='window'?dom.window:dom.window[k],configurable:true});
 H={authUser:{uid:'push-a'},teardown:false,token:'synthetic-token',permission:'granted',listeners:new Map(),timers:new Map(),calls:[],channels:[],listenerAdds:0,checks:0,prompts:0,registrations:0,failNative:false,unregisters:0,clears:0};
 H.rpc=async(name,input)=>{H.calls.push({name,input,uid:H.authUser?.uid});if(H.rpcHook)return H.rpcHook(name,input);return{data:{success:true,tokenHash:input.token?hash(input.token):undefined}};};globalThis.__pushTest=H;
 globalThis.setTimeout=(callback,delay)=>{const timer={unref(){}};H.timers.set(timer,{callback,delay});return timer;};globalThis.clearTimeout=t=>H.timers.delete(t);
 const mod=new Module(path.join(root,'qa/tests/push-subject.cjs'));mod.filename=path.join(root,'qa/tests/push-subject.cjs');mod.paths=Module._nodeModulePaths(root);mod._compile(built.outputFiles[0].text,mod.filename);api=mod.exports;
}
const context=(extra={})=>({userId:H.authUser.uid,companyId:'push-company',activeProfile:'driver',...extra});const settle=async()=>{await turn();await turn();};
async function test(name,run){await start();try{await run();checks.push({name,status:'PASS'});}finally{await api.clearPushRegistrationContext();globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;dom.window.close();}}
try{
 await test('Native failure does not pin a completed registration promise',async()=>{H.failNative=true;await api.registerDeviceForPush(context());H.failNative=false;await api.registerDeviceForPush(context());await settle();assert.equal(H.registrations,2);assert.equal(H.calls.length,1);});
 await test('Permission is rechecked after settings change without repeatedly prompting a denial',async()=>{H.permission='denied';await api.registerDeviceForPush(context());assert.equal(H.registrations,0);assert.equal(H.prompts,0);H.permission='granted';await api.registerDeviceForPush(context());await settle();assert.equal(H.registrations,1);assert.equal(H.listenerAdds,4);assert.equal(H.channels[0].id,'nvu_notifications');});
 await test('Concurrent callers share setup and native registration',async()=>{const gate=deferred();H.checkHook=()=>gate.promise;const calls=Array.from({length:8},()=>api.registerDeviceForPush(context()));await settle();gate.resolve({receive:'granted'});await Promise.all(calls);await settle();assert.equal(H.registrations,1);assert.equal(H.listenerAdds,4);});
 await test('Identical callbacks and context do not rewrite the backend association',async()=>{await api.registerDeviceForPush(context());await settle();H.listeners.get('registration')({value:H.token});await settle();await api.registerDeviceForPush(context());await settle();assert.equal(H.calls.length,1);});
 await test('Latest company wins over an older pending permission check',async()=>{const gate=deferred();H.checkHook=()=>gate.promise;const old=api.registerDeviceForPush(context());await settle();const latest=api.registerDeviceForPush(context({companyId:'new-company'}));gate.resolve({receive:'granted'});await Promise.all([old,latest]);await settle();assert(H.calls.every(c=>c.input.companyId==='new-company'));assert.equal(H.registrations,1);});
 await test('Transient backend failure retries the cached token',async()=>{let fail=true;H.rpcHook=async()=>{if(fail)throw Error('synthetic offline');return{data:{success:true}};};await api.registerDeviceForPush(context());await settle();fail=false;await api.registerDeviceForPush(context());await settle();assert(H.calls.length>=2);const before=H.calls.length;await api.registerDeviceForPush(context());await settle();assert.equal(H.calls.length,before);});
 await test('Retries are bounded and foreground permits recovery',async()=>{H.failNative=true;await api.registerDeviceForPush(context());for(let i=0;i<3;i++){const entry=[...H.timers.entries()].find(([,v])=>v.delay<10000);assert(entry);H.timers.delete(entry[0]);entry[1].callback();await settle();}assert.equal(H.registrations,4);assert.equal(H.timers.size,0);H.failNative=false;H.resume({isActive:true});await settle();assert.equal(H.registrations,5);});
 await test('Logout revokes its captured account and a late acknowledgement preserves a new login',async()=>{
  await api.registerDeviceForPush(context());await settle();const prior=H.calls.find(c=>c.name==='registerPushDevice');const gate=deferred();
  H.rpcHook=async(name,input)=>name==='revokePushDevice'?gate.promise:{data:{success:true,tokenHash:hash(input.token)}};
  H.teardown=true;const logout=api.clearPushRegistrationContext();await settle();const revoke=H.calls.find(c=>c.name==='revokePushDevice');assert(revoke);assert.equal(revoke.uid,'push-a');assert(revoke.input.revision>prior.input.revision);
  H.authUser={uid:'push-b'};H.teardown=false;await api.registerDeviceForPush(context());await settle();gate.resolve({data:{success:true}});await logout;
  assert.equal(JSON.parse(localStorage.getItem('nvu.push.device.v1')).userId,'push-b');assert.equal(H.unregisters,1);assert.equal(H.clears,1);
 });
 await test('An offline revocation stays queued and does not block a fresh registration',async()=>{
  await api.registerDeviceForPush(context());await settle();H.rpcHook=async(name,input)=>{if(name==='revokePushDevice')throw Error('synthetic offline');return{data:{success:true,tokenHash:hash(input.token)}};};
  await api.clearPushRegistrationContext();assert.equal(JSON.parse(localStorage.getItem('nvu.push.pending-revocations.v1')).length,1);
  await api.registerDeviceForPush(context());await settle();assert.equal(JSON.parse(localStorage.getItem('nvu.push.device.v1')).userId,'push-a');
  H.rpcHook=null;H.resume({isActive:true});await settle();assert.equal(JSON.parse(localStorage.getItem('nvu.push.pending-revocations.v1')).length,0);
 });
 fs.mkdirSync('qa/results/push-client',{recursive:true});fs.writeFileSync('qa/results/push-client/result.json',JSON.stringify({checks,productionAccess:false,realNativePlugin:false,method:'Actual client push service; controlled Capacitor/callable transports and retry clock.'},null,2)+'\n');console.log('PUSH_CLIENT_PASS',checks.length);
}finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;delete globalThis.__pushTest;}
