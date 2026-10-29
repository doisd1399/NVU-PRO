import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const compact=process.env.NVU_DOCK_502_UI==='true';
const root=process.cwd(),output=path.resolve(compact?'verification/dock-502':'verification/dock-497');
await fs.mkdir(output,{recursive:true});
let playwright;try{playwright=await import('playwright');}catch{playwright=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);}
const avatar='data:image/png;base64,'+(await fs.readFile('scripts/fixtures/central-management/avatar.png')).toString('base64');
const assets=await fs.readdir('dist/assets');
const css=(await Promise.all(assets.filter(name=>name.endsWith('.css')).sort((a,b)=>Number(!a.startsWith('index-'))-Number(!b.startsWith('index-'))).map(name=>fs.readFile('dist/assets/'+name,'utf8')))).join('\n');
assert(css.includes('.nvu-workspace-dock-region'),'Build current source first');
const fixtures=`
import React from 'react';import {useLocation} from 'react-router-dom';
const noop=()=>{},load=async()=>{},empty=[];
const avatar=${JSON.stringify(avatar)},company={id:'dc',companyName:'DC Transportes',ownerId:'driver',simulatorId:'gto',status:'active',logoUrl:avatar,companyLogoURL:avatar};
const user={id:'driver',name:'Motorista QA',profilePhotoURL:avatar,photoURL:avatar,isOnline:true,status:'active'};
const memberships=[{id:'member',companyId:'dc',userId:'driver',status:'active',roles:['admin','driver']}];
const trips=Array.from({length:12},(_,i)=>({id:'trip-'+i,companyId:'dc',driverId:'driver',jobId:'job-'+i,contractId:'bls',simulatorId:'gto',simulator:'GTO',status:'completed',recordStatus:'completed',serverValidatedAt:new Date(Date.UTC(2026,9,22-i*7,12)).toISOString(),completedAt:new Date(Date.UTC(2026,9,22-i*7,12)).toISOString(),valorCents:234100+i*1000,currency:'BRL',currencyStatus:'known'}));
export function useSessionStore(){const location=useLocation();return {currentUser:user,activeRole:location.pathname.startsWith('/driver')?'driver':location.state?.workspaceDockRole||'admin',switchRole:load,logOutApp:load,setSeniorCompanyId:noop};}
export function useCompanyStore(){return {companies:[company],allCompanies:[company],activeCompanyId:'dc',setActiveCompanyId:noop,memberships,allCompanyMembers:memberships};}
export function useOperationalStore(){return {simulators:[{id:'gto',name:'GTO'}],users:[user],jobs:empty,contracts:empty,vehicles:empty,trailers:empty};}
export function useActivityStore(){return {jobDemands:empty};}
export function useNotificationStore(){return {notifications:empty,markNotificationAsRead:load};}
export function useTripHistory(){return {historicoTrips:trips,loading:false,error:null,coverage:'complete',historyReady:true};}
export function useDriverTrips(){return {trips,loading:false,historyReady:true};}
export const OperationRecoveryContext=React.createContext(null);
export function useMissingOperationTrip(){return {};}
export function SimpleAutomationCompletionBridge(){return null;}
export const auth={currentUser:{uid:'driver',getIdToken:async()=>'fixture-token'}},db={},storage={},functions={};
export const preloadRoute=load,preloadFleetPanel=load,warmRegisteredRankingPhotos=load,waitForRankingWarmup=load,beginRankingWarmupSession=noop;
export function useProfileCover(){return {src:"",pending:false,failed:false,retry:()=>{}};}
export function usePersistentRankingImage(src){return {src,onLoad:noop,onError:noop};}
export function StableImage({src,alt,className}){return <img src={src||avatar} alt={alt||''} className={className}/>;}
export function CompactProfileEditorModal(){return null;}export function GlobalMenu(){return null;}export function NotificationCenter(){return null;}
export default function Secondary(){return null;}
`;
const adapters=new Set(['AppContext.tsx','CompanyContext.tsx','NotificationsContext.tsx','firebase.ts','routePreload.ts','rankingPhotoWarmup.ts','usePersistentRankingImage.ts','useProfileCover.ts','useTripHistory.ts','useDriverTrips.ts','useMissingOperationTrip.ts','SimpleAutomationCompletionBridge.tsx','CompactProfileEditorModal.tsx','GlobalMenu.tsx','NotificationCenter.tsx','StableImage.tsx']);
const bundle=await build({stdin:{resolveDir:root,sourcefile:'dock-ui-qa.tsx',loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route,useLocation,useNavigate} from 'react-router-dom';
import AdminLayout from './src/layouts/AdminLayout';import DriverLayout from './src/layouts/DriverLayout';import Reports from './src/pages/admin/Reports';import {WorkspaceDock} from './src/components/WorkspaceDock';import {WorkspaceScrollMemory} from './src/components/common/WorkspaceScrollMemory';import {WorkspaceSwipeNavigation} from './src/components/WorkspaceSwipeNavigation';
function Probe(){const location=useLocation(),navigate=useNavigate();window.__go=navigate;window.__route={pathname:location.pathname,state:location.state};return null;}
function ShortPage(){return <section data-testid='short-page' style={{padding:20}}><h1>Página curta</h1><button data-testid='last-action'>Última ação</button></section>;}
function RankingSurface(){return <div className='nvu-ranking-page'><section style={{padding:20}}><h1>Ranking — superfície de teste</h1>{Array.from({length:30},(_,i)=><article key={i} style={{padding:25,marginBottom:12,background:'var(--nvu-surface)'}}>Empresa {i+1}</article>)}<button data-testid='last-action'>Ver mais empresas</button></section><WorkspaceDock/></div>;}
createRoot(document.getElementById('root')).render(<BrowserRouter><Probe/><WorkspaceScrollMemory scope='dock-qa'/><WorkspaceSwipeNavigation/><Routes><Route path='/admin' element={<AdminLayout/>}><Route path='reports' element={<Reports/>}/><Route path='history' element={<ShortPage/>}/><Route path='fleet' element={<ShortPage/>}/><Route path='news' element={<ShortPage/>}/><Route path='senior' element={<ShortPage/>}/></Route><Route path='/driver' element={<DriverLayout/>}><Route path='reports' element={<Reports/>}/><Route path='history' element={<ShortPage/>}/><Route path='profile' element={<ShortPage/>}/><Route path='news' element={<ShortPage/>}/></Route><Route path='/ranking' element={<RankingSurface/>}/></Routes></BrowserRouter>);
`},bundle:true,write:false,outfile:path.join(output,'fixture.js'),format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"test"','import.meta.env.BASE_URL':'"/"','import.meta.env.PROD':'false'},plugins:[{name:'dock-remote-adapters',setup(plugin){
plugin.onResolve({filter:/^dock-fixtures$/},()=>({path:'fixtures',namespace:'dock-fixture'}));
plugin.onLoad({filter:/.*/,namespace:'dock-fixture'},()=>({contents:fixtures,resolveDir:root,loader:'tsx'}));
plugin.onLoad({filter:/src\/.*\.tsx?$/},args=>adapters.has(path.basename(args.path))?{contents:'export * from "dock-fixtures";export {default} from "dock-fixtures";',resolveDir:root,loader:'tsx'}:undefined);
}}]});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const html=`<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1,viewport-fit=cover'><style>${css}</style></head><body><div id='root'></div><script>${js.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
const server=http.createServer(async(req,res)=>{if(req.url.endsWith('.woff2')){try{res.setHeader('content-type','font/woff2');res.end(await fs.readFile(path.join(root,'public',new URL(req.url,'http://localhost').pathname)));}catch{res.statusCode=404;res.end();}return;}res.setHeader('content-type','text/html');res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await playwright.chromium.launch({headless:true,...(process.env.NVU_CHROMIUM_EXECUTABLE?{executablePath:process.env.NVU_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:390,height:867},deviceScaleFactor:1,isMobile:true,hasTouch:true,timezoneId:'America/Sao_Paulo'});
await context.addInitScript(()=>{const RealDate=Date,fixed=new RealDate('2026-10-22T12:00:00Z').getTime();window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};});
const page=await context.newPage(),results=[],errors=[],outbound=[];page.on('pageerror',error=>errors.push(String(error)));page.setDefaultTimeout(10000);
await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){outbound.push(route.request().url());return route.abort();}return route.continue();});
const tick=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS',name);};
async function assertBottomBand(){
 const band=await page.evaluate(()=>{
  const region=document.querySelector('.nvu-workspace-dock-region'),nav=region.querySelector('nav'),rect=region.getBoundingClientRect(),dock=nav.getBoundingClientRect();
  const xs=[rect.left+2,rect.left+rect.width*.25,rect.left+rect.width*.5,rect.right-2],ys=[rect.top+2,dock.top+2,(dock.bottom+innerHeight)/2,innerHeight-2];
  return {background:getComputedStyle(region).backgroundColor,page:getComputedStyle(document.body).backgroundColor,bottom:rect.bottom,height:rect.height,nav:{left:dock.left,right:dock.right,top:dock.top,bottom:dock.bottom,height:dock.height},spacer:document.querySelector('.nvu-workspace-dock-space').getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth+1,blocked:xs.every(x=>ys.every(y=>region.contains(document.elementFromPoint(x,y))))};
 });
 assert.equal(band.background,band.page,JSON.stringify(band));assert.equal(band.bottom,await page.evaluate(()=>innerHeight));assert(band.blocked,'Page content must not be painted or clickable in footer band: '+JSON.stringify(band));assert(!band.overflow);assert(band.spacer>=band.height-1);assert(band.nav.height>=(compact?44:50)&&band.nav.height<=(compact?48:54),JSON.stringify(band));assert.equal(await page.locator('.nvu-driver-dock button').count(),6);return band;
}
try{
 await page.goto(origin+'/admin/reports');await page.getByText('Semana atual',{exact:true}).waitFor();
 const fast=process.env.NVU_DOCK_QA_FAST==='1';
 for(const role of ['admin','driver'])for(const theme of fast?['dark']:['light','dark'])for(const width of fast?[390]:[320,360,390,412,768,1280]){
  await check('Relatórios reais e faixa opaca '+role+' '+theme+' '+width,async()=>{
   await page.setViewportSize({width,height:867});await page.evaluate(({role,theme})=>{window.dispatchEvent(new CustomEvent('nvu:theme-change',{detail:theme}));window.__go('/'+role+'/reports');document.documentElement.style.setProperty('--nvu-workspace-dock-safe-bottom','0px');},{role,theme});await tick();
   await page.getByText('Semana atual',{exact:true}).waitFor();
   await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight*.4));await tick();await assertBottomBand();
   if(width===390)await page.screenshot({path:path.join(output,'middle-'+role+'-'+theme+'.png')});
   await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await tick();const band=await assertBottomBand();
   const notice=await page.getByText('Os dados refletem o histórico oficial e excluem entregas rejeitadas, canceladas ou viagens ainda em andamento.').boundingBox();assert(notice.y+notice.height<=band.nav.top-7,JSON.stringify({notice,band}));
   const load=page.getByRole('button',{name:'Carregar mais registros',exact:true});assert(await load.isVisible());const before=await page.getByText(/Semana de /).count();await load.click();assert(await page.getByText(/Semana de /).count()>before);await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await tick();await assertBottomBand();
   // Reset the report's paging state without changing the shared layout.
   await page.getByRole('button',{name:'Mensal',exact:true}).click();await page.getByRole('button',{name:'Semanal',exact:true}).click();
  });
 }
 for(const role of ['admin','driver'])for(const safe of [24,34])await check('Área segura e último item '+role+' '+safe+'px',async()=>{
  await page.setViewportSize({width:390,height:867});await page.evaluate(({role,safe})=>{window.__go('/'+role+'/reports');document.documentElement.style.setProperty('--nvu-workspace-dock-safe-bottom',safe+'px');},{role,safe});await tick();await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await tick();const band=await assertBottomBand();assert(band.height>=(compact?62:82)+safe);assert.equal(Math.round(867-band.nav.bottom),10+safe);
 });
 await check('Página curta mantém a dock e não cria rolagem vazia',async()=>{await page.evaluate(()=>{document.documentElement.style.setProperty('--nvu-workspace-dock-safe-bottom','0px');window.__go('/admin/history');});await page.getByTestId('short-page').waitFor();await tick();assert(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1));await assertBottomBand();});
 await check('Área inferior não permite clique em conteúdo encoberto',async()=>{await page.evaluate(()=>{const button=document.createElement('button');button.id='under-footer';button.textContent='Não clicar através da dock';button.style.cssText='position:fixed;bottom:0;left:0;width:100%;height:100px;z-index:1;background:red';button.onclick=()=>window.__underClicked=true;document.querySelector('main').append(button);});await page.mouse.click(3,864);assert.equal(await page.evaluate(()=>Boolean(window.__underClicked)),false);await page.evaluate(()=>document.getElementById('under-footer').remove());});
 await check('Dock preserva destinos e estado selecionado dos seis botões',async()=>{
  for(const role of ['admin','driver']){
   await page.evaluate(role=>window.__go('/'+role+'/reports'),role);await tick();assert.equal(await page.getByRole('button',{name:'Resultados',exact:true}).getAttribute('aria-current'),'page');
   for(const [label,pathname] of (role==='admin'?[['Gestão','/admin/fleet'],['Atividade','/admin/history'],['Resultados','/admin/reports'],['NVU News','/admin/news'],['Ranking','/ranking'],['Empresa','/admin/fleet']]:[['Trabalho','/driver/profile'],['Atividade','/driver/profile'],['Resultados','/driver/profile'],['NVU News','/driver/news'],['Ranking','/ranking'],['Perfil','/driver/profile']])){
    await page.getByRole('navigation',{name:role==='admin'?'Navegação da empresa':'Navegação do motorista'}).getByRole('button',{name:label,exact:true}).click();await page.waitForFunction(pathname=>window.__route.pathname===pathname,pathname);await tick();
   }
  }
 });
 await check('Ranking recebe a mesma proteção inferior ao rolar',async()=>{await page.evaluate(()=>window.__go('/ranking',{state:{workspaceDockRole:'admin'}}));await page.getByRole('heading',{name:'Ranking — superfície de teste'}).waitFor();await page.evaluate(()=>scrollTo(0,innerHeight));await tick();await assertBottomBand();await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await tick();const band=await assertBottomBand();const last=await page.getByTestId('last-action').boundingBox();assert(last.y+last.height<=band.nav.top-7);});
 await check('Sobreposições de diálogo permanecem acima da dock',async()=>{await page.evaluate(()=>{const overlay=document.createElement('div');overlay.id='qa-overlay';overlay.setAttribute('role','dialog');overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:60';document.body.append(overlay);});assert(await page.evaluate(()=>document.elementFromPoint(innerWidth/2,innerHeight-20).id==='qa-overlay'));await page.evaluate(()=>document.getElementById('qa-overlay').remove());});
 assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);
 await fs.mkdir('reports',{recursive:true});await fs.writeFile(compact?'reports/dock-502-ui.json':'reports/dock-497-ui.json',JSON.stringify({pass:true,checks:results.length,results,pageErrors:errors,outboundRequests:outbound},null,2)+'\n');console.log('DOCK_497_UI_PASS',results.length,'checks');
}catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});console.error('PAGE_ERRORS',errors,'OUTBOUND',outbound);throw error;}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
