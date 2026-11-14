import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=process.cwd(), output=path.resolve('verification/senior-496');
await fs.mkdir(output,{recursive:true});
let playwright;try{playwright=await import('playwright');}catch{playwright=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);}
const avatar='data:image/png;base64,'+(await fs.readFile('scripts/fixtures/central-management/avatar.png')).toString('base64');
const assets=await fs.readdir('dist/assets');
const css=(await Promise.all(assets.filter(name=>/^(vendor|index|SeniorPanel)-.*\.css$/.test(name)).map(name=>fs.readFile('dist/assets/'+name,'utf8')))).join('\n');
assert(css.includes('.nvu-senior-review'));
const fixtures=`
import React from 'react';
const noop=()=>{},load=async()=>{},empty=[];
const avatar=${JSON.stringify(avatar)};
const simulators=[{id:'gto',name:'GTO'},{id:'wtds',name:'WTDS'},{id:'wbds',name:'WBDS'},{id:'toe3',name:'TOE 3'}];
const companies=[{id:'cocal',companyName:'COCAL TRANSPORTE',simulatorId:'wtds'},{id:'dc',companyName:'DC Transportes',simulatorId:'toe3'},{id:'matecom',companyName:'MATECOM',simulatorId:'gto'}].map(c=>({...c,status:'active',ownerId:c.id+'-owner',userId:c.id+'-owner',ownerName:'Responsável QA',logoUrl:avatar,logoURL:avatar,companyLogoURL:avatar,cnpj:'00.000.000/0001-00',email:c.id+'@example.test'}));
const users=companies.map(c=>({id:c.ownerId,name:'Responsável QA',email:c.email,status:'active',photoURL:avatar,profilePhotoURL:avatar}));
const members=companies.map(c=>({id:c.id+'-member',userId:c.ownerId,companyId:c.id,name:'Responsável QA',roles:['admin','driver'],status:'active'}));
const registrations=[{id:'reg1',companyName:'Doce Coroa Transportes',ownerName:'Gabriel Moreira',simulatorId:'gto',simulatorName:'GTO',createdAt:'2026-10-21T23:48:00Z'},{id:'reg2',companyName:'Tr império',ownerName:'Guilherme Espedito',simulatorId:'wtds',simulatorName:'WTDS',createdAt:{seconds:1792615980}},{id:'reg3',companyName:'Super Útil',ownerName:'Luís Carlos Costa',simulatorId:'wbds',simulatorName:'WBDS',createdAt:'2026-10-12T18:29:54Z'},{id:'reg4',companyName:'Weslley Fabiano',ownerName:'Weslley Fabiano',simulatorId:'gto',simulatorName:'GTO',createdAt:'2026-10-11T18:00:00Z'}].map(r=>({...r,status:'pending',type:'company_registration',companyLogoURL:avatar,ownerPhotoUrl:avatar,email:'qa@example.test',whatsapp:'00000000000',cnpj:'00.000.000/0001-00'}));
const currentUser={id:'senior-qa',name:'Senior QA',photoURL:avatar,profilePhotoURL:avatar,companyId:'own'};
window.__metricsCalls=Number(sessionStorage.getItem('__metricsCalls')||0);window.__tripCount=Number(sessionStorage.getItem('__tripCount')||228);window.__primed=[];window.__roles=[];
export function useSessionStore(){return {currentUser,setIsSeniorAuthenticated:noop,switchRole:async(...args)=>window.__roles.push(args),setSeniorCompanyId:id=>window.__seniorCompanyId=id,activeRole:'admin',logOutApp:load};}
export function useCompanyStore(){return {companies,allCompanies:companies,memberships:[],activeCompanyId:'own',setActiveCompanyId:id=>window.__companyId=id,primeCompanyProfile:company=>window.__primed.push(company.id),removeDriverFromFleet:load};}
export function useOperationalStore(){return {simulators,users,contracts:empty,jobs:empty,vehicles:empty,trailers:empty};}
export function useActivityStore(){return {jobDemands:empty};}
export function useNotificationStore(){return {notifications:empty,markNotificationAsRead:load};}
export const auth={currentUser:{uid:'senior-qa',getIdTokenResult:async()=>({claims:{senior:true}}),getIdToken:async()=>'fixture-token'}},db={},functions={},storage={};
export function httpsCallable(_functions,name){return async()=>{
 if(name==='getSeniorMonthlyMetrics'){
 window.__metricsCalls++;sessionStorage.setItem('__metricsCalls',String(window.__metricsCalls));
 if(window.__metricsFail)throw Error('Fixture network unavailable');
 if(window.__metricsHold)await new Promise(resolve=>window.__metricsRelease=resolve);
 return {data:{success:true,periodKey:'mes_2026-10',periodTimeZone:'America/Sao_Paulo',periodPolicy:'SAO_PAULO_CALENDAR',companies:companies.map(c=>({companyId:c.id,tripCount:c.id==='matecom'?window.__tripCount:c.id==='cocal'?1:0,earnings:c.id==='matecom'?5442683:0}))}};
 }return {data:{activeCompanies:13,success:true}};
};}
export function collection(_db,name){return {name};}export function doc(_db,name,id){return {name,id};}export function query(ref,...constraints){return {...ref,constraints};}
export const where=(...args)=>args,orderBy=(...args)=>args,limit=(...args)=>args,startAfter=(...args)=>args,documentId=()=>'id';
const snapshot=values=>({metadata:{fromCache:!navigator.onLine},docs:values.map(value=>({id:value.id,data:()=>value,exists:()=>true}))});
export async function getDocs(ref){if(ref.name==='frotas'&&window.__catalogEmptyCache)return {metadata:{fromCache:true},docs:[]};return snapshot(ref.name==='frotas'?companies:ref.name==='companyMembers'?members:ref.name==='users'?users:[]);}
export async function getDoc(ref){return {id:ref.id,exists:()=>false,data:()=>null};}export const getDocFromServer=getDoc;
export async function getCountFromServer(){return {data:()=>({count:13})};}
export function onSnapshot(ref,...args){const next=typeof args[0]==='function'?args[0]:args[1];let active=true;queueMicrotask(()=>{if(active)next(ref.name==='recruitment_applications'?snapshot(registrations):{exists:()=>true,data:()=>({})});});return()=>active=false;}
export const updateDoc=load,deleteDoc=load,setDoc=load,serverTimestamp=noop,deleteField=noop;
export const writeBatch=()=>({set:noop,update:noop,delete:noop,commit:load}),runTransaction=load;
export class Timestamp{static fromDate(d){return {toDate:()=>d,seconds:d.getTime()/1000};}}
export const syncSingleSimulatorMember=load,removeSimulatorMember=load,createNotification=load,authenticateSeniorAccess=load,listSeniorSuspendedMembers=async()=>[];
export const preloadRoute=load,preloadFleetPanel=load,warmRegisteredRankingPhotos=load,waitForRankingWarmup=load,beginRankingWarmupSession=noop;
export function useProfileCover(){return {src:"",pending:false,failed:false,retry:()=>{}};}
export function usePersistentRankingImage(src){return {src,onLoad:noop,onError:noop};}
export function onCanonicalTripUpdated(handler){const listener=event=>handler(event.detail);window.addEventListener('nvu:canonical-trip-updated',listener);return()=>window.removeEventListener('nvu:canonical-trip-updated',listener);}
export function StableImage({src,alt,...props}){return <img src={src||avatar} alt={alt||''} className={props.className}/>;}
export function CompactProfileEditorModal(){return null;}export function GlobalMenu(){return null;}export function NotificationCenter(){return null;}
export function SimulatorManagerModal(){return null;}export function SimpleCityManagerModal(){return null;}export function CreateNewsModal(){return null;}export function SeniorMemberActions(){return null;}export function SuspendedMembersModal(){return null;}export function WorkModeAvailabilityModal(){return null;}
export default function Secondary(){return null;}
`;
const adapters=new Set(['AppContext.tsx','CompanyContext.tsx','NotificationsContext.tsx','firebase.ts','syncSimulatorMembers.ts','notificationService.ts','seniorAccessService.ts','seniorAccountAdministrationService.ts','SimulatorManagerModal.tsx','SimpleCityManagerModal.tsx','CreateNewsModal.tsx','SeniorMemberActions.tsx','SuspendedMembersModal.tsx','WorkModeAvailabilityModal.tsx','CompactProfileEditorModal.tsx','GlobalMenu.tsx','NotificationCenter.tsx','StableImage.tsx','routePreload.ts','rankingPhotoWarmup.ts','usePersistentRankingImage.ts','useProfileCover.ts','CanonicalTripUpdateEvent.ts']);
const bundle=await build({stdin:{resolveDir:root,sourcefile:'senior-ui-qa.tsx',loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route,useLocation,useNavigate} from 'react-router-dom';
import AdminLayout from './src/layouts/AdminLayout';import SeniorPanel from './src/pages/admin/SeniorPanel';import {handleSafeAppBack} from './src/lib/safeBackNavigation';import {beginAuthTeardown} from './src/lib/authLifecycle';
if(!history.state?.usr)history.replaceState({idx:0,usr:{activeTab:'requests'}},'','/admin/senior');
function Probe(){const location=useLocation(),navigate=useNavigate();window.__route={pathname:location.pathname,state:location.state};window.__go=navigate;window.__nativeBack=()=>handleSafeAppBack({exitApp:()=>window.__exited=true});window.__authTeardown=beginAuthTeardown;return null;}
createRoot(document.getElementById('root')).render(<BrowserRouter><Probe/><Routes><Route path='/admin' element={<AdminLayout/>}><Route path='senior' element={<SeniorPanel/>}/><Route path='fleet' element={<div data-testid='central-destination'>Central de gestão</div>}/></Route></Routes></BrowserRouter>);
`},bundle:true,write:false,outfile:path.join(output,'fixture.js'),format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"test"','import.meta.env.BASE_URL':'"/"','import.meta.env.PROD':'false'},plugins:[{name:'senior-remote-adapters',setup(plugin){
plugin.onResolve({filter:/^senior-fixtures$/},()=>({path:'fixtures',namespace:'senior-fixture'}));
plugin.onLoad({filter:/.*/,namespace:'senior-fixture'},()=>({contents:fixtures,resolveDir:root,loader:'tsx'}));
plugin.onResolve({filter:/^firebase\/(firestore|functions)$/},()=>({path:'fixtures',namespace:'senior-fixture'}));
plugin.onLoad({filter:/src\/.*\.tsx?$/},args=>adapters.has(path.basename(args.path))?{contents:'export * from "senior-fixtures";export {default} from "senior-fixtures";',resolveDir:root,loader:'tsx'}:undefined);
}}]});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const html=`<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><style>${css}</style></head><body><div id='root'></div><script>${js.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
const server=http.createServer(async(req,res)=>{if(req.url.endsWith('.woff2')){try{res.setHeader('content-type','font/woff2');res.end(await fs.readFile(path.join(root,'public',new URL(req.url,'http://localhost').pathname)));}catch{res.statusCode=404;res.end();}return;}res.setHeader('content-type','text/html');res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port+'/admin/senior';
const browser=await playwright.chromium.launch({headless:true,...(process.env.NVU_CHROMIUM_EXECUTABLE?{executablePath:process.env.NVU_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:390,height:867},deviceScaleFactor:1,isMobile:true,hasTouch:true,timezoneId:'America/Sao_Paulo'});
const errors=[],outbound=[],results=[];
await context.addInitScript(()=>{
 const RealDate=Date;window.__now=new RealDate('2026-10-22T00:00:00Z').getTime();
 window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[window.__now]));}static now(){return window.__now;}};
 Object.defineProperty(navigator,'onLine',{get:()=>sessionStorage.getItem('__offline')!=='true',configurable:true});
});
await context.route('**/*',route=>{if(new URL(route.request().url()).hostname!=='127.0.0.1'){outbound.push(route.request().url());return route.abort();}return route.continue();});
const page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));
const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS',name);};
const requests=()=>page.getByRole('button',{name:/Pendentes/});
const approved=()=>page.getByRole('button',{name:/Empresas ativas/});
const openFirst=()=>page.getByRole('button',{name:'Analisar cadastro de Doce Coroa Transportes'}).click();
const review=()=>page.getByRole('dialog',{name:'Análise de cadastro'});
const matecom=()=>page.locator('article').filter({has:page.getByText('MATECOM',{exact:true})});
const waitForCount=async count=>{await page.waitForFunction(n=>{const row=[...document.querySelectorAll('article')].find(row=>row.textContent.includes('MATECOM'));return row?.textContent.includes(String(n));},count);};
try{
 await page.goto(url);await page.getByRole('heading',{name:'Cadastros recebidos'}).waitFor();
 const fast=process.env.NVU_SENIOR_QA_FAST==='1';
 for(const theme of fast?['dark']:['light','dark'])for(const width of fast?[390]:[320,360,390,412,768,1280]){
  await check('Lista, indicadores conectados e formulário seguro '+width+' '+theme,async()=>{
   await page.setViewportSize({width,height:867});await page.evaluate(theme=>{document.documentElement.classList.toggle('dark',theme==='dark');document.documentElement.style.setProperty('--nvu-safe-top','24px');},theme);
   assert.equal(await page.locator('.nvu-senior-summary').count(),1);assert.equal(await page.locator('.nvu-senior-summary > button').count(),2);
   assert.equal(await page.locator('.nvu-senior-registration-row').count(),4);
   assert.match(await page.locator('.nvu-senior-submission').first().textContent(),/21\/10\/2026 • 20:48/);
   assert.match(await page.locator('.nvu-senior-submission').nth(2).textContent(),/12\/10\/2026 • 15:29/);
   const metrics=await page.locator('.nvu-senior-registration-row').evaluateAll(rows=>rows.map(row=>({height:row.getBoundingClientRect().height,width:row.scrollWidth,client:row.clientWidth})));
   assert(metrics.every(row=>row.height<145&&row.width<=row.client+1),JSON.stringify(metrics));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await openFirst();await review().waitFor();
   const geometry=await review().evaluate(root=>({parent:root.parentElement.tagName,focus:document.activeElement===root,header:root.querySelector('header').getBoundingClientRect().top,headerBottom:root.querySelector('header').getBoundingClientRect().bottom,intro:root.querySelector('.nvu-senior-review-intro').getBoundingClientRect().top,scroll:root.scrollWidth,client:root.clientWidth}));
   assert.equal(geometry.parent,'BODY');assert(geometry.focus);assert(geometry.header>=23.5);assert(geometry.intro>=geometry.headerBottom+15);assert(geometry.scroll<=geometry.client+1);
   if(width===390)await page.screenshot({path:path.join(output,'review-'+theme+'.png')});
   await page.getByRole('button',{name:'Voltar ao Painel Sênior'}).click();await review().waitFor({state:'detached'});
   if(width===390)await page.screenshot({path:path.join(output,'list-'+theme+'.png'),fullPage:true});
  });
 }
 await page.setViewportSize({width:390,height:867});
 await check('Busca e filtro funcionam nos cadastros',async()=>{const search=page.getByRole('textbox',{name:'Buscar empresas'});await search.fill('Doce');assert.equal(await page.locator('.nvu-senior-registration-row').count(),1);await search.fill('');await page.getByRole('button',{name:'Selecionar simulador'}).click();await page.locator('.nvu-senior-simulator-menu').getByRole('button',{name:'WBDS',exact:true}).click();assert.equal(await page.locator('.nvu-senior-registration-row').count(),1);await page.getByRole('button',{name:'Selecionar simulador'}).click();await page.locator('.nvu-senior-simulator-menu').getByRole('button',{name:'Todos os simuladores'}).click();});
 await check('Voltar do navegador fecha análise e restaura a lista',async()=>{await openFirst();await review().waitFor();await page.goBack();await review().waitFor({state:'detached'});assert.equal(await page.locator('.nvu-senior-registration-row').count(),4);});
 await check('Voltar do navegador encerra também a confirmação aninhada',async()=>{await openFirst();await page.getByRole('button',{name:'Aprovar e Ativar'}).click();await page.getByRole('heading',{name:'Aprovar Empresa',exact:true}).waitFor();await page.goBack();await review().waitFor({state:'detached'});await page.getByRole('heading',{name:'Aprovar Empresa',exact:true}).waitFor({state:'detached'});assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');});
 await check('Voltar Android fecha confirmação antes da análise',async()=>{await openFirst();await page.getByRole('button',{name:'Aprovar e Ativar'}).click();await page.getByRole('heading',{name:'Aprovar Empresa',exact:true}).waitFor();await page.evaluate(()=>window.__nativeBack());await page.getByRole('heading',{name:'Aprovar Empresa',exact:true}).waitFor({state:'detached'});assert(await review().isVisible());await page.evaluate(()=>window.__nativeBack());await review().waitFor({state:'detached'});assert.equal(await page.evaluate(()=>Boolean(window.__exited)),false);assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');});
 await check('Acessar empresa prepara o escopo e abre a Central de Gestão',async()=>{await approved().click();await waitForCount(228);await matecom().getByRole('button',{name:/Acessar/}).click();await page.getByTestId('central-destination').waitFor();const state=await page.evaluate(()=>({route:window.__route,primed:window.__primed,company:window.__companyId}));assert.equal(state.route.pathname,'/admin/fleet');assert.equal(state.route.state.activeTab,'operations');assert.equal(state.company,'matecom');assert(state.primed.includes('matecom'));});
 await check('Retorno ao painel preserva 228 sem nova consulta mensal',async()=>{const before=await page.evaluate(()=>window.__metricsCalls);await page.goBack();await waitForCount(228);assert.equal(await page.evaluate(()=>window.__metricsCalls),before);});
 await check('Resposta vazia do cache Firestore preserva o catálogo confirmado',async()=>{await page.evaluate(()=>window.__catalogEmptyCache=true);await page.evaluate(()=>window.__go('/admin/fleet',{state:{activeTab:'operations'}}));await page.getByTestId('central-destination').waitFor();await page.goBack();await waitForCount(228);assert.equal(await page.locator('article').count(),3);await page.evaluate(()=>window.__catalogEmptyCache=false);});
 await check('Reabertura offline restaura catálogo e totais persistidos',async()=>{const before=await page.evaluate(()=>window.__metricsCalls);await page.evaluate(()=>sessionStorage.setItem('__offline','true'));await page.reload();await waitForCount(228);assert.equal(await page.evaluate(()=>window.__metricsCalls),before);});
 await check('Falha na atualização de fundo mantém a última consulta',async()=>{await page.evaluate(()=>{sessionStorage.removeItem('__offline');window.__metricsFail=true;window.__now+=360000;window.dispatchEvent(new Event('online'));});await page.waitForFunction(()=>window.__metricsCalls>=2);assert.match(await matecom().textContent(),/228/);});
 await check('Nova viagem atualiza sem apagar os dados atuais',async()=>{const before=await page.evaluate(()=>window.__metricsCalls);await page.evaluate(()=>{window.__metricsFail=false;window.__metricsHold=true;window.__tripCount=229;sessionStorage.setItem('__tripCount','229');window.dispatchEvent(new CustomEvent('nvu:canonical-trip-updated',{detail:{companyId:'matecom'}}));});await page.waitForFunction(before=>window.__metricsCalls>before,before);assert.match(await matecom().textContent(),/228/);await page.evaluate(()=>{window.__metricsHold=false;window.__metricsRelease?.();});await waitForCount(229);assert(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('nvu-senior-monthly-v1:')&&JSON.parse(localStorage.getItem(key)).companies.matecom.tripCount===229)));});
 await check('Logout remove ambos os caches persistentes',async()=>{await page.evaluate(()=>window.__authTeardown());assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('nvu-senior-monthly-v1:')||key.startsWith('nvu-senior-catalog-v1:'))),false);});
 assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);
 await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/senior-panel-496-ui.json',JSON.stringify({pass:true,checks:results.length,results,pageErrors:errors,outboundRequests:outbound},null,2)+'\n');
 console.log('SENIOR_PANEL_496_UI_PASS',results.length,'checks');
}catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});console.error('PAGE_ERRORS',errors,'OUTBOUND',outbound);throw error;}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
