import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {spawn} from 'node:child_process';
const require=createRequire(import.meta.url);
let chromium;
try { ({chromium}=require('playwright')); }
catch { ({chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'', 'playwright'))); }
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {}),args:['--no-sandbox']});
const server=spawn(process.execPath,["node_modules/vite/bin/vite.js","--host","127.0.0.1","--port","4175"],{stdio:"ignore"});
const context=await browser.newContext();
await context.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:4175/')?route.continue():route.abort());
const page=await context.newPage();
const load=async()=>page.evaluate(async()=>{
 const [db,sync,repo,registration,receipt]=await Promise.all([
  import('/src/services/offline/OfflineDatabase.ts'),import('/src/services/sync/SyncEngine.ts'),
  import('/src/repositories/CanonicalTripRepository.ts'),import('/src/application/trip/TripRegistrationService.ts'),import('/src/lib/offlineReceiptStore.ts')]);
 window.__test505={...db,...sync,...repo,...registration,...receipt};
});
const checks=[];
try {
 for(let n=0;n<100;n++){try{const r=await fetch('http://127.0.0.1:4175/');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 await page.goto('http://127.0.0.1:4175/',{waitUntil:'domcontentloaded'});await load();
 const saved=await page.evaluate(async()=>{
  const m=window.__test505;
  const receiptKey=await m.persistOfflineReceipt(new File(['browser-receipt-evidence'],'receipt.png',{type:'image/png'}),{imageHash:'browser505',userId:'browser-driver505',companyId:'browser-company505'});
  const database=new m.OfflineDatabase();
  const engine=new m.SyncEngine({offlineDatabase:database,getCurrentUser:()=>({uid:'browser-driver505'}),operationStartPending:()=>false,adapter:{push:async()=>{throw new Error('NETWORK_MUST_NOT_RUN')}}});
  const repo=new m.CanonicalTripRepository({database,queue:engine});
  await repo.saveLocal(m.TripRegistrationService.register({tripId:'browser-trip505',idempotencyKey:'browser-trip505',driverId:'browser-driver505',companyId:'browser-company505',jobId:'browser-job505',contractId:'browser-contract505',valor:123.45,valorCents:12345,imageHash:'browser505',offlineReceiptKey:receiptKey,source:'PRINT_PRO_REGISTRATION'}));
  await m.removeOfflineReceipt(receiptKey);
  if (!await m.getOfflineReceipt(receiptKey)) throw new Error("PENDING_RECEIPT_WAS_DELETED");
  const bytes=JSON.parse(localStorage.getItem(m.OfflineDatabase.storageKey));
  return {record:!!bytes.records['browser-trip505'],command:bytes.outbox['browser-trip505'].state,receiptKey};
 });
 assert.equal(saved.record,true);assert.equal(saved.command,'PENDING_SYNC');checks.push('Chromium real localStorage commits registration with outbox; real IndexedDB stores receipt bytes');
 await page.reload({waitUntil:'domcontentloaded'});await load();
 const recovered=await page.evaluate(async({receiptKey})=>{
  const m=window.__test505,key=m.OfflineDatabase.storageKey;
  const data=JSON.parse(localStorage.getItem(key));delete data.outbox['browser-trip505'];localStorage.setItem(key,JSON.stringify(data));
  const image=await m.getOfflineReceipt(receiptKey);const evidence=await image.blob.text();let calls=0;
  const engine=new m.SyncEngine({getCurrentUser:()=>({uid:'browser-driver505'}),operationStartPending:()=>false,adapter:{push:async trip=>{calls++;return {confirmed:true,tripId:trip.tripId,data:{...trip,serverValidatedAt:'2026-10-23T16:00:00Z'}}}}});
  await engine.synchronize();await engine.synchronize();
  return {evidence,calls,state:engine.getResult('browser-trip505').state,locksAvailable:!!navigator.locks};
 },saved);
 assert.equal(recovered.evidence,'browser-receipt-evidence');assert.equal(recovered.calls,1);assert.equal(recovered.state,'SERVER_CONFIRMED');assert.equal(recovered.locksAvailable,true);
 checks.push('Page reload preserves the receipt and trip; real Web Locks recover the orphan and send once');
 fs.mkdirSync('reports/release-505',{recursive:true});fs.writeFileSync('reports/release-505/browser.json',JSON.stringify({productionAccess:false,browser:'Chromium headless',network:'loopback only, controlled registration boundary',checks:checks.length,passed:checks},null,2));
 console.log('BROWSER_505_PASS',checks.length);
}finally{await browser.close();server.kill();}
