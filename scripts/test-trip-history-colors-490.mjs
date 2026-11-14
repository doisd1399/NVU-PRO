import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
let playwright;try{playwright=await import('playwright');}catch{playwright=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);}
const root=process.cwd();
const ports=`
import React from 'react';
const empty=[];const user={id:'driver',name:'David Canto',roles:['admin','driver']};const companies=[{id:'company',companyName:'DC Transportes',ownerId:'driver',simulatorId:'gto',simulatorName:'GTO'}];const simulators=[{id:'gto',name:'GTO'}];
const trips=Array.from({length:75},(_,i)=>({id:'trip-'+i,tripId:'trip-'+i,physicalDocumentId:'trip-'+i,driverId:'driver',companyId:'company',empresaNome:'DC Transportes',motoristaNome:'David Canto',simulatorId:'gto',status:'completed',recordStatus:'completed',completedAt:'2026-10-20T12:00:00Z',serverValidatedAt:'2026-10-20T12:00:00Z',valorCents:100000,currency:'BRL',currencyStatus:'known',origem:'Origem '+i,destino:'Destino '+i,veiculoNome:'Veículo',reboqueNome:'Reboque',contratoNome:'BLS',contratoNumero:'BLS',syncStatus:'SERVER_CONFIRMED'}));
export function useSessionStore(){return {currentUser:user,activeRole:'admin',isSeniorAuthenticated:false};}
export function useCompanyStore(){return {activeCompanyId:'company',companies,allCompanyMembers:empty};}
export function useOperationalStore(){return {users:[user],simulators,contracts:empty,jobs:empty,vehicles:empty,trailers:empty};}
export function useTripHistory(){return {historicoTrips:trips,loading:false,historyReady:true,coverage:'complete',readCoverage:null};}
export const removeTripHistoryOptimistically=()=>{},updateTripHistoryOptimistically=()=>{};
export const db={};export const doc=()=>({});
export const canonicalTripMigrationService={runBackfill:async()=>{throw Error('Unexpected backfill');}},canonicalTripCommandService={},canonicalTripOperationService={},SyncManager={};
export const applyDriverSuspension=async()=>{},deleteTripWithModeration=async()=>{};
export const isSimpleAutomationNativeAvailable=()=>true;export const SimpleAutomation={getReadOnlyProQueueDiagnostics:async()=>({ownerAuthenticated:true,pendingProTrips:[]})};
export function StableImage({fallback}){return <>{fallback||null}</>;}
export const ProPendingAuthButton=()=>null,ProPendingRetryButton=()=>null,ProAttemptDiagnosticDetails=()=>null,FailedHistoryRegistrationRecovery=()=>null,OperationResultModal=()=>null;
export const copySafeDiagnosticToClipboard=async()=>{};
`;
const names=new Set(['AppContext.tsx','CompanyContext.tsx','useTripHistory.ts','firebase.ts','simpleAutomationNative.ts','CanonicalTripMigrationService.ts','CanonicalTripCommandService.ts','CanonicalTripOperationService.ts','syncManager.ts','tripModerationService.ts','StableImage.tsx','ProPendingAuthButton.tsx','ProPendingRetryButton.tsx','ProAttemptDiagnosticDetails.tsx','FailedHistoryRegistrationRecovery.tsx','OperationResultModal.tsx']);
const bundle=await build({stdin:{resolveDir:root,loader:'tsx',sourcefile:'history-ui.tsx',contents:`
import React,{Activity,useState} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import TripHistory from './src/pages/driver/TripHistory';
function App(){const [visible,setVisible]=useState(true);window.__show=setVisible;return <div className='nvu-workspace-shell nvu-workspace-theme'><Activity mode={visible?'visible':'hidden'}><TripHistory mode='company' isInsideAdminTab hideFloatingSummary/></Activity></div>;}
createRoot(document.getElementById('root')).render(<MemoryRouter><App/></MemoryRouter>);
`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false','import.meta.env.PROD':'false'},plugins:[{name:'remote-adapters',setup(b){b.onResolve({filter:/^history-ports$|^firebase\/firestore$/},()=>({path:'ports',namespace:'history'}));b.onLoad({filter:/.*/,namespace:'history'},()=>({contents:ports,loader:'tsx',resolveDir:root}));b.onLoad({filter:/src\/.*\.tsx?$/},args=>names.has(path.basename(args.path))?{contents:'export * from "history-ports";',loader:'tsx',resolveDir:root}:undefined);}}]});
const cssNames=(await fs.readdir('dist/assets')).filter(name=>name.startsWith('index-')&&name.endsWith('.css'));const css=await fs.readFile(path.join('dist/assets',cssNames[0]),'utf8');
const html=`<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'><style>${css}</style></head><body><div id='root'></div><script>${bundle.outputFiles.find(f=>f.path.endsWith('.js'))?.text?.replace(/<\/script/gi,'<\\/script')||bundle.outputFiles[0].text}</script></body></html>`;
const browser=await playwright.chromium.launch({headless:true,...(process.env.NVU_CHROMIUM_EXECUTABLE?{executablePath:process.env.NVU_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{
  const D=Date;window.Date=class extends D{constructor(...args){super(...(args.length?args:['2026-10-20T18:00:00Z']));}static now(){return new D('2026-10-20T18:00:00Z').getTime();}};
  window.IntersectionObserver=class{constructor(callback){this.callback=callback;}observe(){window.__more=()=>this.callback([{isIntersecting:true}]);}disconnect(){}};
 });await page.route('**/*',route=>route.fulfill({body:html,contentType:'text/html'}));await page.goto('http://127.0.0.1:43851');await page.getByRole('button',{name:'Expandir detalhes da viagem',exact:true}).first().waitFor();
 assert.equal(await page.getByRole('button',{name:'Expandir detalhes da viagem',exact:true}).count(),30);
 await page.evaluate(()=>window.__more());await page.waitForFunction(()=>document.querySelectorAll('[aria-label="Expandir detalhes da viagem"]').length===60);
 await page.getByRole('button',{name:'Expandir detalhes da viagem',exact:true}).first().click();assert.equal(await page.getByRole('button',{name:'Recolher detalhes da viagem',exact:true}).count(),1);
 for(let n=0;n<5;n++){await page.evaluate(()=>window.__show(false));await page.getByRole('button',{name:'Recolher detalhes da viagem',exact:true}).waitFor({state:'hidden'});await page.evaluate(()=>window.__show(true));await page.getByRole('button',{name:'Recolher detalhes da viagem',exact:true}).waitFor({state:'visible'});}
 assert.equal(await page.getByRole('button',{name:'Expandir detalhes da viagem',exact:true}).count(),59);assert.equal(await page.getByRole('button',{name:'Recolher detalhes da viagem',exact:true}).count(),1);assert.deepEqual(errors,[]);
 async function contrast(selector){return page.locator(selector).evaluateAll(nodes=>{
 const context=document.createElement('canvas').getContext('2d',{willReadFrequently:true});const rgba=s=>{if(!s.startsWith('rgb')){context.clearRect(0,0,1,1);context.fillStyle=s;context.fillRect(0,0,1,1);const c=[...context.getImageData(0,0,1,1).data];return [c[0],c[1],c[2],c[3]/255];}const n=s.match(/[\d.]+/g)?.map(Number)||[];return [n[0]||0,n[1]||0,n[2]||0,n.length>3?n[3]:1]};const over=(a,b)=>[0,1,2].map(i=>a[i]*a[3]+b[i]*(1-a[3])).concat(1);
 const lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((v,c,i)=>v+c*[.2126,.7152,.0722][i],0);
 const bg=n=>{const p=n.parentElement?bg(n.parentElement):[16,26,32,1];return over(rgba(getComputedStyle(n).backgroundColor),p)};
 const all=[];for(const root of nodes){const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);while(walk.nextNode()){const t=walk.currentNode;if(!t.textContent.trim())continue;const el=t.parentElement,st=getComputedStyle(el),r=el.getBoundingClientRect();if(!r.width||!r.height||st.visibility==='hidden'||el.closest('[disabled],[aria-hidden="true"],.nvu-podium-rank,.nvu-podium-participant'))continue;const a=lum(over(rgba(st.color),bg(el))),b=lum(bg(el));all.push({text:t.textContent.trim().slice(0,90),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),color:st.color,bg:getComputedStyle(el).backgroundColor,computedBackground:bg(el),computedForeground:rgba(st.color)});}}return all;
 });}

 await page.addStyleTag({content:'*,*::before,*::after{transition-duration:0s!important;animation:none!important}.nvu-content-auto{content-visibility:visible!important}'});
 const colors=[];
 for(const width of [360,412,768]){
  await page.setViewportSize({width,height:950});await page.evaluate(()=>document.documentElement.classList.add('dark'));
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const ratios=await contrast('#root');assert.deepEqual(ratios.filter(x=>x.ratio<4.49),[],`History text contrast at ${width}`);
  for(const action of ['Visualizar Detalhes','Editar origem e destino','Excluir Viagem']){
   const icon=page.getByTitle(action,{exact:true}).first();if(!await icon.count())continue;
   const c=await icon.evaluate(n=>({color:getComputedStyle(n).color,bg:getComputedStyle(n).backgroundColor}));
   const l=s=>s.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
   const a=l(c.color),b=l(c.bg);assert((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=3,action+' icon contrast');
  }
  colors.push({width,textChecks:ratios.length,minContrast:Math.min(...ratios.map(x=>x.ratio))});
  if(width===412){await fs.mkdir('verification/dark-theme-490',{recursive:true});await page.screenshot({path:'verification/dark-theme-490/history-dark.png',fullPage:true});}
 }
 await fs.writeFile('reports/history-colors-490-ui.json',JSON.stringify({result:'PASS',actualComponent:'TripHistory',productionCSS:true,physicalDeviceTested:false,colors},null,2));
 console.log('HISTORY_DARK_490_PASS',colors.length,'widths; receipt text and semantic action icons');
 await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/trip-history-retention-490-ui.json',JSON.stringify({result:'PASS',checks:['actual TripHistory renders first 30 trips','pagination grows to 60','expanded receipt retained','five Activity returns preserve all 60 rows and expanded receipt'],productionAccess:false,physicalDeviceTested:false},null,2));console.log('TRIP_HISTORY_RETENTION_489_UI_PASS 4 checks on actual TripHistory');
}finally{await browser.close();}
