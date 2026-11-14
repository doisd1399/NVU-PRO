import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const root=path.resolve(process.env.NVU_AUDIT_SOURCE||'.'),reportRoot=path.resolve('reports/release-506');
const oldTest=await fs.readFile(path.join(root,'scripts/test-trip-history-retention-489-ui.mjs'),'utf8');
let ports=oldTest.split('const ports=`')[1].split('`;\nconst names')[0];
ports=ports.replace("import React from 'react';","import React,{useSyncExternalStore} from 'react';\nlet revision=0;const listeners=new Set();export const state={embedded:true,role:'driver',failure:false};export function useFixture(){useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>revision);};window.__scenario=patch=>{Object.assign(state,patch);revision++;listeners.forEach(fn=>fn())};window.__calls=[];")
 .replace("activeRole:'admin'","activeRole:state.role")
 .replace("export function useSessionStore(){return", "export function useSessionStore(){useFixture();return")
 .replace("length:75","length:1")
 .replace("completedAt:'2026-10-20T12:00:00Z'", "jobId:'job',contractId:'bls',completedAt:'2026-10-23T12:00:00Z'")
 .replace('canonicalTripCommandService={}',"canonicalTripCommandService={deleteTrip:async id=>{window.__calls.push(['delete',id]);if(state.failure)throw Error('Injected network failure');},markTripDeleted:async()=>{},update:async id=>{window.__calls.push(['edit',id]);return {editPending:false}}}")
 .replace('canonicalTripOperationService={}', 'canonicalTripOperationService={syncJobProgress:async()=>{}}');
ports+='\nexport const fixtureTrips=trips;export const fixtureJob={id:"job",driverId:"driver",companyId:"company",contractId:"bls",status:"active",totalDeliveries:10};\n';
const names=new Set(['AppContext.tsx','CompanyContext.tsx','useTripHistory.ts','firebase.ts','simpleAutomationNative.ts','CanonicalTripMigrationService.ts','CanonicalTripCommandService.ts','CanonicalTripOperationService.ts','syncManager.ts','tripModerationService.ts','StableImage.tsx','ProPendingAuthButton.tsx','ProPendingRetryButton.tsx','ProAttemptDiagnosticDetails.tsx','FailedHistoryRegistrationRecovery.tsx','OperationResultModal.tsx']);
const bundle=await build({stdin:{resolveDir:root,sourcefile:'dialog-regression.tsx',loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';
import TripHistory from './src/pages/driver/TripHistory';import {DiscreetDisclosure} from './src/components/common/DiscreetDisclosure';import {DriverDock} from './src/components/driver/DriverDock';import {History} from 'lucide-react';
import {state,useFixture,fixtureTrips,fixtureJob} from 'dialog-ports';import {dismissTopOptionModal} from './src/lib/optionModalStack';
window.__back=dismissTopOptionModal;function App(){useFixture();const history=<TripHistory key={state.embedded+'-'+state.role} mode={state.role==='admin'?'company':'driver'} embeddedJob={state.embedded?fixtureJob:undefined} hideHeader hideHeaderActions hideFloatingSummary historicoTripsOverride={fixtureTrips} canonicalOperationTripsOverride={state.embedded?fixtureTrips:undefined}/>;return <div className='nvu-workspace-shell nvu-driver-workspace' style={{minHeight:1700}}><div style={{height:320}}/><div className={state.embedded?'nvu-driver-surface':''}>{state.embedded?<DiscreetDisclosure title='Viagens da operação' icon={History}>{history}</DiscreetDisclosure>:history}</div><div className='nvu-workspace-dock-region'><DriverDock active='work' onIntent={()=>{}} onSelect={()=>window.__calls.push(['dock'])}/></div></div>;}createRoot(document.getElementById('root')).render(<MemoryRouter><App/></MemoryRouter>);
`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false','import.meta.env.PROD':'false'},plugins:[{name:'remote-ports',setup(b){b.onResolve({filter:/^dialog-ports$|^history-ports$|^firebase\/firestore$/},()=>({path:'ports',namespace:'dialog'}));b.onLoad({filter:/.*/,namespace:'dialog'},()=>({contents:ports,loader:'tsx',resolveDir:root}));b.onLoad({filter:/src\/.*\.tsx?$/},args=>names.has(path.basename(args.path))?{contents:'export * from "dialog-ports";',loader:'tsx',resolveDir:root}:undefined);}}]});
const css=(await Promise.all((await fs.readdir(path.join(root,'dist/assets'))).filter(n=>n.endsWith('.css')).map(n=>fs.readFile(path.join(root,'dist/assets',n),'utf8')))).join('\n')+'\n'+await fs.readFile('src/components/ui/ModalPortal.css','utf8');
const html=`<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1,viewport-fit=cover'><style>${css}</style></head><body><div id='root'></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.NVU_CHROMIUM_EXECUTABLE||process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext(),page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
await page.addInitScript(()=>{const D=Date;window.Date=class extends D{constructor(...args){super(...(args.length?args:['2026-10-23T18:00:00Z']));}static now(){return new D('2026-10-23T18:00:00Z').getTime();}};});
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS',name)};
const scenario=async data=>{await page.evaluate(data=>window.__scenario(data),data);if(data.embedded){const toggle=page.getByRole('button',{name:'Viagens da operação'});if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();}};
const deleteTrigger=()=>page.getByRole('button',{name:'Excluir Viagem',exact:true}).first();
const deleteButton=()=>page.getByRole('button',{name:'Excluir viagem',exact:true});
const reachable=async button=>{await button.waitFor();const g=await button.evaluate(node=>{const b=node.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2,top=document.elementFromPoint(x,y);return {x,y,width:innerWidth,height:innerHeight,top:top?.outerHTML?.slice(0,180),hit:top===node||node.contains(top)}});assert(g.x>0&&g.x<g.width&&g.y>0&&g.y<g.height&&g.hit,JSON.stringify(g));};
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 for(const theme of ['light','dark'])for(const viewport of [{width:320,height:568},{width:390,height:867},{width:412,height:915},{width:844,height:390}])for(const embedded of [true,false]){
  await page.setViewportSize(viewport);await page.evaluate(t=>document.documentElement.className=t==='dark'?'dark':'',theme);await scenario({embedded,role:'driver',failure:false});
  await deleteTrigger().click();await check(`Cancel/delete stay above dock: ${embedded?'operation':'history'} ${viewport.width}x${viewport.height} ${theme}`,async()=>{await reachable(deleteButton());await reachable(page.getByRole('button',{name:'Cancelar',exact:true}));});
  if(!process.env.NVU_AUDIT_SOURCE){assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');}
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
 }
 await page.setViewportSize({width:390,height:667});await scenario({embedded:true,role:'driver',failure:true});
 await check('Cancel does not invoke a delete; Android Back closes and restores focus/scroll',async()=>{assert.deepEqual(await page.evaluate(()=>window.__calls),[]);await deleteTrigger().click();assert.equal(await page.evaluate(()=>window.__back()),true);await deleteButton().waitFor({state:'hidden'});assert.equal(await deleteTrigger().evaluate(node=>node===document.activeElement),true);assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');});
 await check('Failed delete is shown again in history and can be retried',async()=>{await deleteTrigger().click();await deleteButton().click();await deleteTrigger().waitFor();assert.equal(await page.evaluate(()=>window.__calls.filter(x=>x[0]==='delete').length),1);});
 await check('Edit and details use the same viewport layer',async()=>{await page.getByRole('button',{name:'Editar origem e destino',exact:true}).first().click();await reachable(page.getByRole('button',{name:'Salvar',exact:true}));await page.keyboard.press('Escape');await page.getByRole('button',{name:'Visualizar Detalhes',exact:true}).first().click();await reachable(page.getByRole('button',{name:'Fechar Detalhes',exact:true}));await page.keyboard.press('Escape');});
 await scenario({embedded:true,role:'admin'});await page.setViewportSize({width:320,height:360});
 await check('Long moderation body scrolls while both footer buttons remain visible',async()=>{await deleteTrigger().click();await reachable(deleteButton());const toggle=page.getByRole('button',{name:/Suspender também/});await toggle.scrollIntoViewIfNeeded();await toggle.click();await reachable(deleteButton());await reachable(page.getByRole('button',{name:'Cancelar',exact:true}));await page.keyboard.press('Escape');});
 assert.deepEqual(errors,[]);await fs.mkdir(reportRoot,{recursive:true});await fs.writeFile(path.join(reportRoot,'dialogs-ui.json'),JSON.stringify({productionAccess:false,method:'Real TripHistory + disclosure + driver surface + DriverDock + built CSS in Chromium; persistence boundary injected',checks:checks.length,passed:checks},null,2));console.log('DIALOGS_506_UI_PASS',checks.length);
}catch(error){await fs.mkdir(reportRoot,{recursive:true});await fs.writeFile(path.join(reportRoot,process.env.NVU_AUDIT_SOURCE?'baseline-505-dialog-failure.json':'dialogs-ui-failure.json'),JSON.stringify({expectedBaseline:!!process.env.NVU_AUDIT_SOURCE,checks:checks.length,error:String(error),browserErrors:errors},null,2));throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
