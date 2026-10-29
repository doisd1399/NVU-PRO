import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const approved499=process.env.NVU_PROFILE_499_UI==='true';
const approved502=process.env.NVU_PROFILE_502_UI==='true';
const approved500=process.env.NVU_PROFILE_500_UI==='true'||approved502;
const approvedProfile=approved499||approved500;
const root=process.cwd(),output=path.resolve(approved502?'verification/approved-profile-502':approved500?'verification/approved-profile-500':approved499?'verification/approved-profile-499':'verification/profile-cover-498');
await fs.mkdir(output,{recursive:true});
let playwright;try{playwright=await import('playwright');}catch{playwright=await import(pathToFileURL(path.join((process.env.NVU_QA_NODE_MODULES || process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES),'playwright/index.mjs')).href);}
const avatar='data:image/png;base64,'+(await fs.readFile('scripts/fixtures/central-management/avatar.png')).toString('base64');
const vehicle=await fs.readFile('scripts/fixtures/central-management/vehicle.jpg');
const vehicleData='data:image/jpeg;base64,'+vehicle.toString('base64');
const css=(await Promise.all((await fs.readdir('dist/assets')).filter(name=>name.endsWith('.css')).sort((a,b)=>Number(!a.startsWith('index-'))-Number(!b.startsWith('index-'))).map(name=>fs.readFile('dist/assets/'+name,'utf8')))).join('\n');
const fixtures=`
import React,{useSyncExternalStore} from 'react';import {useLocation} from 'react-router-dom';
const noop=()=>{},load=async()=>{},empty=[];let version=0;const listeners=new Set();
const avatar=${JSON.stringify(avatar)},company={id:'dc',companyName:'DC Transportes',ownerId:'driver',userId:'driver',simulatorId:'gto',simulatorName:'GTO',status:'active',logoUrl:avatar,companyLogoURL:avatar};
const user={id:'driver',name:'David Canto',email:'driver@example.test',profilePhotoURL:avatar,photoURL:avatar,isOnline:true,status:'active',role:'driver',roles:['driver','admin']};
const companies=[company,{...company,id:'second',companyName:'Outra Empresa',simulatorName:'WBDS',simulatorId:'wbds'}];
const loadCatalog=async()=>companies,loadById=async id=>companies.find(c=>c.id===id);
const memberships=companies.map(c=>({id:'driver_'+c.id,companyId:c.id,userId:'driver',status:'active',roles:['admin','driver']}));
const state={activeCompanyId:'dc',empty:false,rankingUnavailable:false,manager:true};window.__scenario=next=>{if('manager' in next){state.manager=next.manager;company.ownerId=next.manager?'driver':'owner';company.userId=next.manager?'driver':'owner';memberships.forEach(m=>m.roles=next.manager?['admin','driver']:['driver']);}if(next.name)user.name=next.name;if(next.companyName)company.companyName=next.companyName;if(next.activeCompanyId)state.activeCompanyId=next.activeCompanyId;if('empty' in next)state.empty=next.empty;if('rankingUnavailable' in next)state.rankingUnavailable=next.rankingUnavailable;if('jobState' in next)operational.jobs=next.jobState==='none'?[]:[{...currentJob,vehicleId:next.jobState==='other'?'scania':'iveco',vehicleName:next.jobState==='other'?'Scania G':'Iveco S Way'}];version++;listeners.forEach(fn=>fn());};
function useFixture(){useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>version);}
export function useSessionStore(){useFixture();const location=useLocation();return {currentUser:user,authInitialized:true,sessionUiReady:true,setCurrentUser:noop,activeRole:location.pathname.startsWith('/driver')?'driver':'admin',switchRole:load,logOutApp:load,setSeniorCompanyId:noop};}
export function useCompanyStore(){useFixture();return {companies,allCompanies:companies,activeCompanyId:state.activeCompanyId,setActiveCompanyId:id=>window.__scenario({activeCompanyId:id}),memberships,allCompanyMembers:memberships,driverRequests:empty,requestJoinCompany:load,cancelRequestJoinCompany:load,allCompanyMembersReady:true,companiesLoading:false,companyCatalogLoaded:true,companyCatalogAttempted:true,loadCompanyCatalog:loadCatalog,loadCompanyById:loadById,updateCompany:load,createCompany:load,deleteCompany:load,recruitmentApplications:empty};}
const currentJob={id:'job-current',driverId:'driver',companyId:'dc',contractId:'bls',vehicleId:'iveco',status:'active',requiredTrips:10,totalTrips:10,startedAt:'2026-10-22T10:00:00Z'};
const profileTrips=Array.from({length:31},(_,i)=>({id:'summary-trip-'+i,companyId:'dc',driverId:'driver',jobId:i>=27?'job-current':'past-job',contractId:'bls',simulatorId:'gto',simulator:'GTO',status:'completed',recordStatus:'completed',serverValidatedAt:'2026-10-22T12:00:00Z',completedAt:i<26?'2026-10-10T12:00:00Z':'2026-10-22T12:00:00Z',valorCents:i===30?7302600:2000000,currency:'BRL',currencyStatus:'known'}));profileTrips.push({...profileTrips[0],id:'previous-month',completedAt:'2026-09-30T12:00:00Z'},{...profileTrips[0],id:'cancelled',status:'cancelled',cancelado:true},{...profileTrips[0],id:'another-driver',driverId:'another-driver'},{...profileTrips[0],id:'another-company',companyId:'second',simulatorId:'wbds',simulator:'WBDS'});
const operational={simulators:[{id:'gto',name:'GTO'},{id:'wbds',name:'WBDS'}],users:[user],jobs:${approved500?'[currentJob]':'empty'},contracts:${approved500?"[{id:'bls',name:'BLS - 140',companyId:'dc',simulatorId:'gto',totalDeliveries:10,status:'active',deliveries:[]}]":'empty'},vehicles:${approved500?"[{id:'iveco',name:'Iveco S Way',companyId:'dc'},{id:'scania',name:'Scania G',companyId:'dc'}]":'empty'},trailers:empty,sequences:empty,jobsReady:true,contractsReady:true,updateUserOnlineStatus:load,requestNewJobDemand:load};
export function useAutomaticOperations(){return null;}export function useOperationRecovery(){return {};}export function useOptionalAutomaticOperations(){return null;}export function useLocalOperationPending(){return 0;}
export function useOperationalStore(){return operational;}export function useActivityStore(){return {jobDemands:empty};}export function useRankingFilterStore(){return {setGlobalPeriodPreset:noop};}
export function useNotificationStore(){return {notifications:empty,markNotificationAsRead:load};}
export function useTripHistory(){useFixture();return {historicoTrips:${approved502?'state.empty?empty:profileTrips':'empty'},loading:false,error:null,coverage:'complete',historyReady:true};}export const removeTripHistoryOptimistically=noop,updateTripHistoryOptimistically=noop;
export function useDriverTrips(){useFixture();return {trips:${approved500?'state.empty?empty:profileTrips':'empty'},loading:false,historyReady:true,coverage:'complete'};}export const publishDriverTripOptimistically=noop,removeDriverTripOptimistically=noop;
export const OperationRecoveryContext=React.createContext(null);export function useMissingOperationTrip(){return {};}export function SimpleAutomationCompletionBridge(){return null;}
export const authPersistenceReady=Promise.resolve();
export const auth={currentUser:{uid:location.pathname==='/view-driver'?'viewer':'driver',getIdToken:async()=>'fixture-token'},authStateReady:load},db={},storage={},functions={};
window.__systemBars=[];export const SystemBarsStyle={Dark:'DARK',Light:'LIGHT'},SystemBarType={StatusBar:'StatusBar',NavigationBar:'NavigationBar'};export const SystemBars={setStyle:async value=>{window.__systemBars.push(value);}};export const isNativeAndroid=()=>true;
export function onAuthStateChanged(auth,next){queueMicrotask(()=>next(auth.currentUser));return noop;}
export const preloadRoute=load,preloadFleetPanel=load,preloadRoleRoutes=load,warmRegisteredRankingPhotos=load,waitForRankingWarmup=load,beginRankingWarmupSession=noop;
export function usePersistentRankingImage(src){return {src,onLoad:noop,onError:noop};}
export function CompactProfileEditorModal(){return null;}export function ProfileModal({isOpen,onClose}){return isOpen?<section role='dialog' aria-label='Editar perfil'><button onClick={onClose}>Fechar perfil</button></section>:null;}export function GlobalMenu(){return null;}export function NotificationCenter(){return null;}
export function useVehiclePhoto(identity){return {src:${approved500?JSON.stringify(vehicleData):"''"}&&identity?${approved500?JSON.stringify(vehicleData):"''"}:null,pending:false,onImageLoad:noop,onImageError:noop};}
export function useTripsRealtime(){return {trips:empty,loading:false,serverConfirmed:true,refreshing:false,error:null};}
export const getCachedSimpleAutomationCities=()=>[],loadSimpleAutomationCities=async()=>[],prefetchWorkModeAvailability=noop,assertWorkModeEntryAllowed=load,assertServerNewOperationAllowed=load,ensureOperationIntegrity=load;
export function DriverResults(){return <section><h2>Resultados do motorista</h2><p>Ganhos e relatórios</p></section>;}export function DriverPerformanceCard(){return <section style={{minHeight:500}}><h2>Desempenho no ranking</h2><p>31 viagens no período</p></section>;}
export function useProfileRanking(query){window.__rankingQueries=window.__rankingQueries||[];window.__rankingQueries.push({scope:query.scope,periodType:query.periodType,enabled:query.enabled,start:query.start.toISOString()});return {status:state.rankingUnavailable?'unavailable':'ready',simulatorId:'gto',summary:{position:query.scope==='internal'?2:6,total:query.scope==='internal'?4:19,hasActivity:true,isLeader:false,comparableCurrency:true,activeParticipants:4,current:{id:'driver',name:'David Canto',val:query.periodType==='semana'?153026:673026,currency:'BRL',trips:query.periodType==='semana'?5:31},next:null,leader:null,leaderRatio:null}};}
export default function Secondary(){return <section style={{padding:18,minHeight:350}}><p>Conteúdo preservado da página</p></section>;}
const initial={'users/driver':{profileCoverURL:'https://cover-qa.test/initial-driver',profileCoverRevision:'initial-driver'},'frotas/dc':{profileCoverURL:'https://cover-qa.test/initial-company',profileCoverRevision:'initial-company'},'frotas/second':{profileCoverURL:'',profileCoverRevision:'empty'}};
const canonical=()=>JSON.parse(localStorage.getItem('qa-canonical')||JSON.stringify(initial));
window.__published=[];window.__uploads=[];const snapshots=new Set();
export async function getDoc(reference){return {exists:()=>true,data:()=>canonical()[reference.path]||{}};}
export function doc(db,collection,id){return {path:collection+'/'+id};}export function serverTimestamp(){return 'SERVER_TIMESTAMP';}
export function onSnapshot(reference,options,next,error){if(typeof options==='function'){error=next;next=options;}let active=true;const emit=()=>{if(active&&navigator.onLine)next({metadata:{fromCache:false,hasPendingWrites:false},exists:()=>true,data:()=>canonical()[reference.path]||{}});};snapshots.add(emit);queueMicrotask(emit);return()=>{active=false;snapshots.delete(emit);};}
window.addEventListener('storage',event=>{if(event.key==='qa-canonical')snapshots.forEach(fn=>fn());});window.addEventListener('online',()=>snapshots.forEach(fn=>fn()));
export async function updateDoc(reference,data){if(!navigator.onLine)throw new Error('offline');const records=canonical();records[reference.path]={...records[reference.path],...data};localStorage.setItem('qa-canonical',JSON.stringify(records));window.__published.push({path:reference.path,data});snapshots.forEach(fn=>fn());}
window.__remoteCover=(path,data)=>{const records=canonical();records[path]=data;localStorage.setItem('qa-canonical',JSON.stringify(records));snapshots.forEach(fn=>fn());};
export const uploadService={uploadImage:async({file,coverTarget})=>{if(!navigator.onLine)throw new Error('offline');const url='https://cover-qa.test/'+file.name;const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});localStorage.setItem('qa-upload:'+url,data);window.__uploads.push({url,scope:coverTarget.scope,profileId:coverTarget.profileId});return url;}};
`;
const adapters=new Set(['AppContext.tsx','CompanyContext.tsx','NotificationsContext.tsx','firebase.ts','routePreload.ts','rankingPhotoWarmup.ts','usePersistentRankingImage.ts','useTripHistory.ts','useDriverTrips.ts','useMissingOperationTrip.ts','SimpleAutomationCompletionBridge.tsx','CompactProfileEditorModal.tsx','GlobalMenu.tsx','NotificationCenter.tsx','ProfileModal.tsx','useVehiclePhoto.ts','workModeAvailabilityService.ts','simpleAutomationCityService.ts','operationIntegrityGuard.ts','uploadService.ts','useProfileRanking.ts','useTripsRealtime.ts']);
const secondary=new Set(['Dashboard.tsx','OperationsTab.tsx','CompanyTab.tsx','VehiclesTab.tsx','TrailersTab.tsx','DriversTab.tsx','ContractsTab.tsx','RecruitmentTab.tsx','TripHistory.tsx','DriverResults.tsx','DriverPerformanceCard.tsx']);
if(approvedProfile)secondary.delete('DriverPerformanceCard.tsx');
if(approved502){secondary.delete('CompanyTab.tsx');secondary.delete('Dashboard.tsx');adapters.add('AutomaticOperationsProvider.tsx');adapters.add('useLocalOperationPending.ts');secondary.add('GtoObserverSetup.tsx');}
const bundle=await build({stdin:{resolveDir:root,sourcefile:'cover-ui-qa.tsx',loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route,useLocation,useNavigate} from 'react-router-dom';
import NvuStatusBarController from './src/components/common/NvuStatusBarController';import AdminLayout from './src/layouts/AdminLayout';import DriverLayout from './src/layouts/DriverLayout';import Fleet from './src/pages/admin/Fleet';import Profile from './src/pages/driver/Profile';import Reports from './src/pages/admin/Reports';import {ProfileCoverHero} from './src/components/common/ProfileCoverHero';import {WorkspaceScrollMemory} from './src/components/common/WorkspaceScrollMemory';import {startProfileCoverSync} from './src/services/profileCoverService';import {startCompanyDescriptionSync} from './src/services/companyDescriptionService';import {getProfileCover,profileCoverKey} from './src/services/profileCoverStore';
window.__getCover=getProfileCover;window.__coverKey=profileCoverKey;const stop=startProfileCoverSync();${approved502?'startCompanyDescriptionSync();':''}
function Probe(){const location=useLocation(),navigate=useNavigate();window.__go=navigate;window.__route={pathname:location.pathname,state:location.state};return null;}
function Page(){return <section style={{minHeight:300}}><h1>Conteúdo da página</h1></section>;}
function Viewer(){return <main style={{padding:16}}><ProfileCoverHero scope='driver' profileId='driver' profile={{}} name='David Canto' description='Motorista Parceiro' avatar='' viewerId='viewer' simulator='GTO' simulatorOpen={false} onSimulator={()=>{}}/></main>;}
createRoot(document.getElementById('root')).render(<BrowserRouter><NvuStatusBarController/><Probe/><WorkspaceScrollMemory scope='cover-qa'/><Routes><Route path='/admin' element={<AdminLayout/>}><Route path='fleet' element={<Fleet/>}/><Route path='reports' element={<Reports/>}/><Route path='history' element={<Page/>}/><Route path='news' element={<Page/>}/><Route path='senior' element={<Page/>}/></Route><Route path='/driver' element={<DriverLayout/>}><Route path='profile' element={<Profile/>}/><Route path='reports' element={<Reports/>}/><Route path='history' element={<Page/>}/><Route path='news' element={<Page/>}/></Route><Route path='/view-driver' element={<Viewer/>}/></Routes></BrowserRouter>);
`},bundle:true,write:false,outfile:path.join(output,'fixture.js'),format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"test"','import.meta.env.BASE_URL':'"/"','import.meta.env.PROD':'false','import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID':'""'},plugins:[{name:'cover-remote-adapters',setup(plugin){
plugin.onResolve({filter:/^cover-fixtures$/},()=>({path:'fixtures',namespace:'cover-fixture'}));plugin.onLoad({filter:/.*/,namespace:'cover-fixture'},()=>({contents:fixtures,resolveDir:root,loader:'tsx'}));
plugin.onResolve({filter:/(@capacitor\/core|gtoObserver)$/},args=>args.importer.endsWith('/NvuStatusBarController.tsx')?{path:'fixtures',namespace:'cover-fixture'}:undefined);
plugin.onResolve({filter:/^firebase\/(auth|firestore)$/},args=>['/profileCoverService.ts','/companyDescriptionService.ts','/useCompanyDescription.ts','/CompanyTab.tsx'].some(file=>args.importer.endsWith(file))?{path:'fixtures',namespace:'cover-fixture'}:undefined);
plugin.onLoad({filter:/src\/.*\.tsx?$/},args=>adapters.has(path.basename(args.path))||secondary.has(path.basename(args.path))?{contents:'export * from "cover-fixtures";export {default} from "cover-fixtures";',resolveDir:root,loader:'tsx'}:undefined);
}}]});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const html=`<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1,viewport-fit=cover'><style>${css}</style></head><body><div id='root'></div><script>${js.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
const server=http.createServer(async(req,res)=>{if(req.url.startsWith('/vendor/')){try{res.setHeader('content-type','text/javascript');res.end(await fs.readFile(path.join(root,'public',req.url)));}catch{res.statusCode=404;res.end();}return;}if(req.url.endsWith('.woff2')){try{res.end(await fs.readFile(path.join(root,'public',req.url)));}catch{res.statusCode=404;res.end();}return;}res.setHeader('content-type','text/html');res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await playwright.chromium.launch({headless:true,...(process.env.NVU_CHROMIUM_EXECUTABLE?{executablePath:process.env.NVU_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage',...(process.env.NVU_QA_SINGLE_PROCESS==='true'?['--no-zygote','--single-process']:[])]});
const context=await browser.newContext({viewport:{width:390,height:867},isMobile:true,hasTouch:true,deviceScaleFactor:1});
await context.addInitScript(({freeze})=>{if(freeze){const RealDate=Date,fixed=new RealDate('2026-10-22T12:00:00Z').getTime();window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};}Object.defineProperty(navigator,'onLine',{get:()=>localStorage.getItem('qa-offline')!=='true',configurable:true});addEventListener('DOMContentLoaded',()=>document.documentElement.classList.add('dark'),{once:true});},{freeze:approved500});
let blockRemote=false;const outbound=[],errors=[],results=[];
await context.route('**/*',async route=>{const url=route.request().url();if(new URL(url).origin===origin)return route.continue();if(url.startsWith('https://cover-qa.test/')){if(blockRemote)return route.abort();const data=await route.request().frame().evaluate(url=>localStorage.getItem('qa-upload:'+url),url);if(data){const [,type,bytes]=data.match(/^data:([^;]+);base64,(.+)$/);return route.fulfill({body:Buffer.from(bytes,'base64'),contentType:type,headers:{'access-control-allow-origin':'*'}});}return route.fulfill({body:vehicle,contentType:'image/jpeg',headers:{'access-control-allow-origin':'*'}});}outbound.push(url);return route.abort();});
const page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));page.setDefaultTimeout(12000);
const tick=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const check=async(name,run)=>{await run();results.push(name);console.log('PASS',name);};
const hero=()=>page.locator('.nvu-cover-hero:visible');
async function openCoverEditor(){if(!await hero().getByRole('button',{name:'Editar capa do perfil'}).count())await hero().getByRole('button',{name:'Mostrar opções da capa do perfil'}).click();await hero().getByRole('button',{name:'Editar capa do perfil'}).click();}
async function poll(run){const end=Date.now()+12000;while(Date.now()<end){if(await run())return;await page.waitForTimeout(50);}throw new Error('Timed out waiting for durable cover state');}
async function go(path,state){await page.evaluate(({path,state})=>window.__go(path,{state}),{path,state});await page.waitForFunction(({path,state})=>window.__route.pathname===path && Object.entries(state||{}).every(([key,value])=>window.__route.state?.[key]===value),{path,state});await tick();}
async function assertGeometry(){
 const m=await page.evaluate(()=>{const hero=[...document.querySelectorAll('.nvu-cover-hero')].find(n=>n.getClientRects().length),cover=hero.querySelector('.nvu-cover-image').getBoundingClientRect(),avatar=hero.querySelector('.nvu-cover-avatar').getBoundingClientRect(),name=hero.querySelector('h2').getBoundingClientRect(),sim=hero.querySelector('.nvu-cover-simulator').getBoundingClientRect(),header=document.querySelector('.nvu-admin-header,.nvu-native-header')?.getBoundingClientRect();return {cover:{x:cover.x,y:cover.y,right:cover.right,bottom:cover.bottom,width:cover.width,height:cover.height},avatar:{x:avatar.x,y:avatar.y,bottom:avatar.bottom,right:avatar.right},name:{x:name.x,y:name.y,right:name.right},sim:{x:sim.x,right:sim.right},headerBottom:header?.bottom||0,overflow:document.documentElement.scrollWidth>innerWidth+1,bg:getComputedStyle(hero).color};});
 assert(!m.overflow,JSON.stringify(m));assert(m.cover.y>=m.headerBottom+5,JSON.stringify(m));assert(m.cover.y<=m.headerBottom+35,JSON.stringify(m));assert(m.avatar.y<m.cover.bottom&&m.avatar.bottom>m.cover.bottom,JSON.stringify(m));assert(m.name.y>=m.cover.bottom+8,JSON.stringify(m));assert(m.name.x>=m.avatar.right+7,JSON.stringify(m));assert(m.sim.x>=m.name.right+5,JSON.stringify(m));assert(m.sim.right<=m.cover.right+1,JSON.stringify(m));return m;
}
try{
 await page.goto(origin+'/driver/profile');await go('/driver/profile',{profileTab:'profile'});await hero().waitFor();
 for(const [role,pathname,state] of [['driver','/driver/profile',{profileTab:'profile'}],['company','/admin/fleet',{activeTab:'company'}]])for(const theme of ['light','dark'])for(const width of [320,390,412,768,1280])await check('Capa e identidade sem colisões '+role+' '+theme+' '+width,async()=>{
  await page.setViewportSize({width,height:867});await go(pathname,state);await page.evaluate(theme=>{document.documentElement.classList.toggle('dark',theme==='dark');window.dispatchEvent(new CustomEvent('nvu:theme-change',{detail:theme}));scrollTo(0,0);},theme);await tick();await assertGeometry();await poll(()=>page.evaluate(theme=>window.__systemBars.filter(value=>value.bar==='StatusBar').at(-1)?.style===(theme==='dark'?'DARK':'LIGHT'),theme));assert.equal(await hero().count(),1);if(width===390)await page.screenshot({path:path.join(output,role+'-'+theme+'.png')});
 });
 await page.setViewportSize({width:390,height:867});
 await check('Atividade, Resultados e Meu perfil usam a mesma capa nas rotas reais',async()=>{
  for(const profileTab of ['activity','operations','results','profile']){await go('/driver/profile',{profileTab});assert.equal(await hero().count(),1);assert.equal(await hero().getAttribute('data-profile-scope'),'driver');}
  for(const path of ['/driver/history','/driver/reports','/admin/history','/admin/reports']){await go(path);assert.equal(await hero().count(),1);}
  for(const activeTab of ['company','history','reports']){await go('/admin/fleet',{activeTab});assert.equal(await hero().count(),1);}
 });
 await check('Operação atual, Central de gestão, News e Sênior preservam seus banners',async()=>{
  await go('/driver/profile',{profileTab:'dashboard'});assert.equal(await hero().count(),0);assert.equal(await page.locator('.nvu-profile-hero:visible').count(),1);
  for(const [path,state] of [['/admin/fleet',{activeTab:'operations'}],['/admin/fleet',{activeTab:'fleet'}],['/driver/news',{}],['/admin/news',{}],['/admin/senior',{}]]){await go(path,state);assert.equal(await hero().count(),0);}
 });
 await check('Ícones da barra Android seguem o tema nas capas e preservam contraste no banner de trabalho',async()=>{
  await page.evaluate(()=>{document.documentElement.classList.remove('dark');dispatchEvent(new CustomEvent('nvu:theme-change',{detail:'light'}));});
  await go('/driver/profile',{profileTab:'dashboard'});await poll(()=>page.evaluate(()=>window.__systemBars.filter(value=>value.bar==='StatusBar').at(-1)?.style==='DARK'));
  await go('/driver/profile',{profileTab:'profile'});await poll(()=>page.evaluate(()=>window.__systemBars.filter(value=>value.bar==='StatusBar').at(-1)?.style==='LIGHT'));
 });
 await check('Áreas seguras superiores de 24 e 34 px deixam a capa abaixo do cabeçalho',async()=>{
  for(const [pathname,state] of [['/driver/profile',{profileTab:'profile'}],['/admin/fleet',{activeTab:'company'}],['/driver/history',{}],['/admin/reports',{}]])for(const safe of [24,34]){await go(pathname,state);await page.evaluate(safe=>{document.querySelector('.nvu-workspace-shell').style.setProperty('--nvu-safe-top',safe+'px');scrollTo(0,0);},safe);await tick();await assertGeometry();await page.evaluate(()=>document.querySelector('.nvu-workspace-shell').style.removeProperty('--nvu-safe-top'));}
 });
 await check('Desktop sem emulação móvel mantém cabeçalho sólido e capa alinhada nos dois perfis',async()=>{
  const desktop=await browser.newContext({viewport:{width:1280,height:900},isMobile:false,hasTouch:false});
  await desktop.route('**/*',route=>{const url=route.request().url();if(new URL(url).origin===origin)return route.continue();if(url.startsWith('https://cover-qa.test/'))return route.fulfill({body:vehicle,contentType:'image/jpeg',headers:{'access-control-allow-origin':'*'}});outbound.push(url);return route.abort();});
  const desktopPage=await desktop.newPage();desktopPage.on('pageerror',error=>errors.push(String(error)));await desktopPage.goto(origin+'/driver/profile');
  for(const [pathname,state] of [['/driver/profile',{profileTab:'profile'}],['/admin/fleet',{activeTab:'company'}]])for(const theme of ['light','dark']){
    await desktopPage.evaluate(({pathname,state,theme})=>{window.__go(pathname,{state});window.dispatchEvent(new CustomEvent('nvu:theme-change',{detail:theme}));scrollTo(0,0);},{pathname,state,theme});
    await desktopPage.waitForFunction(({pathname,state})=>window.__route.pathname===pathname&&Object.entries(state).every(([key,value])=>window.__route.state?.[key]===value),{pathname,state});
    await desktopPage.locator('.nvu-cover-hero:visible').waitFor();
    const measure=await desktopPage.evaluate(()=>{const normalizeColor=value=>{const numbers=value.match(/[\d.]+/g)?.map(Number)||[];return (value.startsWith('color(srgb')?numbers.slice(0,3).map(number=>Math.round(number*255)):numbers.slice(0,3)).join(',');};const header=document.querySelector('.nvu-admin-header,.nvu-native-header'),cover=document.querySelector('.nvu-cover-hero'),image=cover.querySelector('.nvu-cover-image').getBoundingClientRect();return {native:!!document.querySelector('.nvu-native-android'),desktop:!!document.querySelector('.nvu-desktop-shell'),header:normalizeColor(getComputedStyle(header).backgroundColor),page:normalizeColor(getComputedStyle(document.body).backgroundColor),gap:image.y-header.getBoundingClientRect().bottom,overflow:document.documentElement.scrollWidth>innerWidth+1};});
    assert(!measure.native&&measure.desktop,JSON.stringify(measure));assert.equal(measure.header,measure.page,JSON.stringify(measure));assert(measure.gap>=5&&measure.gap<=35,JSON.stringify(measure));assert(!measure.overflow);
  }
  await desktop.close();
 });
 await check('Nome comprido quebra somente na área de identidade e sem invadir seletor',async()=>{await go('/admin/fleet',{activeTab:'company'});await page.evaluate(()=>window.__scenario({companyName:'Transportadora Nacional de Cargas e Logística Integrada'}));await tick();await assertGeometry();await page.evaluate(()=>window.__scenario({companyName:'DC Transportes'}));});
 await check('Editar capa só aparece após ativação do banner e fecha por toque externo ou Escape',async()=>{
  await go('/driver/profile',{profileTab:'profile'});await page.reload();await hero().waitFor();
  const trigger=hero().getByRole('button',{name:'Mostrar opções da capa do perfil'}),edit=hero().getByRole('button',{name:'Editar capa do perfil'});
  assert.equal(await edit.count(),0);await trigger.focus();assert.equal(await edit.count(),0);
  await page.keyboard.press('Enter');await edit.waitFor();assert.equal(await trigger.getAttribute('aria-expanded'),'true');
  await page.keyboard.press('Escape');assert.equal(await edit.count(),0);assert.equal(await trigger.getAttribute('aria-expanded'),'false');
  await trigger.click();await edit.waitFor();await hero().locator('h2').click();assert.equal(await edit.count(),0);
  await trigger.focus();await page.keyboard.press('Space');await edit.waitFor();await trigger.click();assert.equal(await edit.count(),0);
 });
 if(approved500){
  const toolbar=()=>page.locator('.nvu-driver-profile-toolbar');
  const summary=()=>page.locator('[data-nvu-profile-summary]');
  const history=()=>page.locator('[data-nvu-profile-history]');
  const view=()=>page.locator('[data-nvu-profile-view]');
  const choosePeriod=async name=>{await page.getByRole('button',{name:'Período do ranking',exact:true}).click();const modal=page.getByRole('dialog',{name:'Período do ranking',exact:true});await modal.waitFor();assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'INPUT');await modal.getByRole('option',{name,exact:true}).click();await tick();};
  await check('Resumo é a visualização inicial; veículo, empresa e totais vêm dos repositórios existentes',async()=>{
   await page.reload();await go('/driver/profile',{profileTab:'profile'});await summary().waitFor();
   assert.equal(await toolbar().getByRole('button',{name:'Resumo',exact:true}).getAttribute('aria-pressed'),'true');
   assert.equal(await toolbar().getByRole('button',{name:/Ranking/}).count(),0);
   assert.equal(await summary().getByText('Iveco S Way',{exact:true}).count(),1);
   assert.equal(await summary().locator('[data-nvu-profile-summary-trips]').innerText(),'31');
   assert.match(await summary().innerText(),/673\.026,00/);
   assert.equal(await summary().locator('img').getAttribute('src'),vehicleData);
   assert.equal(await page.locator('[data-nvu-profile-company]').getByText('DC Transportes',{exact:true}).count(),1);
   assert.equal(await page.locator('[data-nvu-profile-company] img').getAttribute('src'),avatar);
   assert(!/01\/10|31\/10|GTO/.test(await summary().innerText()));
   assert.equal(await page.getByRole('button',{name:'Período do ranking',exact:true}).count(),1);
  });
  await check('Empresa precede histórico recolhido; consultas históricas só iniciam após abrir',async()=>{
   const toggle=history().getByRole('button',{name:'Histórico de classificação',exact:true});
   assert.equal(await toggle.getAttribute('aria-expanded'),'false');
   assert.equal(await history().getByText(/Últimos cinco/).count(),0);
   const companyBox=await page.locator('[data-nvu-profile-company]').boundingBox(),historyBox=await history().boundingBox();assert(companyBox.y+companyBox.height<historyBox.y);
   assert.equal(await page.evaluate(()=>window.__rankingQueries.filter(q=>q.enabled!==false).length),0);
   await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');await history().getByText(/Últimos cinco meses/).waitFor();
   const queries=await page.evaluate(()=>window.__rankingQueries.filter(q=>q.enabled===true));assert.equal(queries.length,5);assert.equal(new Set(queries.map(q=>q.start)).size,5);
   await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await history().locator('.nvu-profile-history-content').count(),0);
  });
  await check('Estatísticas mantém os dados anteriores e coloca ranking abaixo do título no mesmo card',async()=>{
   await toolbar().getByRole('button',{name:'Estatísticas',exact:true}).focus();await page.keyboard.press('Space');await page.getByText('6º de 19 motoristas',{exact:true}).waitFor();
   assert.equal(await summary().count(),0);assert.equal(await history().count(),0);assert.equal(await page.locator('[data-nvu-profile-company]').count(),0);
   const scope=page.getByRole('group',{name:'Grupo de comparação',exact:true});
   const heading=await page.getByRole('heading',{name:'Desempenho no ranking',exact:true}).boundingBox(),scopeBox=await scope.boundingBox();assert(scopeBox.y>=heading.y+heading.height+8);
   assert.equal(await scope.locator('xpath=..').getByRole('heading',{name:'Desempenho no ranking',exact:true}).count(),1);
   assert(!/01\/10 a 31\/10|· GTO/.test(await view().locator('section').first().innerText()));
   assert.match(await view().innerText(),/673\.026,00/);assert.equal(await page.getByRole('heading',{name:'Carreira',exact:true}).count(),1);
   await scope.getByRole('button',{name:'Ranking Interno',exact:true}).click();await page.getByText('2º de 4 motoristas',{exact:true}).waitFor();
   await scope.getByRole('button',{name:'Ranking Global',exact:true}).click();await page.getByText('6º de 19 motoristas',{exact:true}).waitFor();
  });
  await check('Filtro de período é compartilhado entre Resumo e Estatísticas e resiste à troca de página',async()=>{
   await choosePeriod('Semana atual');await toolbar().getByRole('button',{name:'Resumo',exact:true}).click();
   assert.equal(await summary().locator('[data-nvu-profile-summary-trips]').innerText(),'5');assert.match(await summary().innerText(),/153\.026,00/);
   await toolbar().getByRole('button',{name:'Estatísticas',exact:true}).click();assert.match(await view().innerText(),/153\.026,00/);
   await go('/driver/profile',{profileTab:'activity'});await go('/driver/profile',{profileTab:'profile'});
   assert.equal(await toolbar().getByRole('button',{name:'Estatísticas',exact:true}).getAttribute('aria-pressed'),'true');assert.match(await page.getByRole('button',{name:'Período do ranking',exact:true}).innerText(),/Semana atual/);
   await toolbar().getByRole('button',{name:'Resumo',exact:true}).click();await choosePeriod('Mês atual');assert.equal(await summary().locator('[data-nvu-profile-summary-trips]').innerText(),'31');
  });
  await check('Sem operação não reaparece veículo antigo; troca de operação e empresa atualiza a identidade correta',async()=>{
   await page.evaluate(()=>window.__scenario({jobState:'none'}));await summary().getByText('Sem veículo em operação',{exact:true}).waitFor();assert.equal(await summary().getByText('Iveco S Way',{exact:true}).count(),0);assert.equal(await summary().locator('img').count(),0);
   await page.evaluate(()=>window.__scenario({jobState:'other'}));await summary().getByText('Scania G',{exact:true}).waitFor();
   await page.evaluate(()=>window.__scenario({activeCompanyId:'second'}));await page.locator('[data-nvu-profile-company]').getByText('Outra Empresa',{exact:true}).waitFor();assert.equal(await summary().locator('[data-nvu-profile-summary-trips]').innerText(),'1');assert.equal(await summary().getByText('Scania G',{exact:true}).count(),0);
   await page.evaluate(()=>window.__scenario({activeCompanyId:'dc',jobState:'active'}));await summary().getByText('Iveco S Way',{exact:true}).waitFor();
  });
  await check('Histórico vazio mostra zero viagens e não inventa ganhos',async()=>{
   await page.evaluate(()=>window.__scenario({empty:true}));assert.equal(await summary().locator('[data-nvu-profile-summary-trips]').innerText(),'0');assert(!/673\.026,00/.test(await summary().innerText()));assert.equal(await summary().getByLabel('Sem ganhos no período').innerText(),'—');await page.evaluate(()=>window.__scenario({empty:false}));
  });
  await check('Resumo continua disponível offline mesmo quando o ranking comparativo está indisponível',async()=>{
   await page.evaluate(()=>{localStorage.setItem('qa-offline','true');dispatchEvent(new Event('offline'));window.__scenario({rankingUnavailable:true});});
   assert.equal(await summary().locator('[data-nvu-profile-summary-trips]').innerText(),'31');assert.match(await summary().innerText(),/673\.026,00/);
   await toolbar().getByRole('button',{name:'Estatísticas',exact:true}).click();await page.getByText('Ranking indisponível',{exact:true}).waitFor();assert.equal(await page.getByText('6º de 19 motoristas',{exact:true}).count(),0);
   await toolbar().getByRole('button',{name:'Resumo',exact:true}).click();assert.equal(await summary().locator('[data-nvu-profile-summary-trips]').innerText(),'31');
   await page.evaluate(()=>{localStorage.removeItem('qa-offline');dispatchEvent(new Event('online'));window.__scenario({rankingUnavailable:false});});
  });
  for(const dark of [false,true])for(const width of [320,390,412,768,1280])await check('Abas aprovadas sem colisões e último card acima da dock '+(dark?'dark':'light')+' '+width,async()=>{
   await page.setViewportSize({width,height:867});await page.evaluate(dark=>{document.documentElement.classList.toggle('dark',dark);scrollTo(0,0);},dark);
   for(const tab of ['Resumo','Estatísticas']){
    await toolbar().getByRole('button',{name:tab,exact:true}).click();await tick();
    const measure=await page.evaluate(()=>{const toolbar=document.querySelector('.nvu-driver-profile-toolbar'),panel=document.querySelector('[data-nvu-profile-view]'),dock=document.querySelector('.nvu-workspace-dock-region'),nav=dock.querySelector('nav');return {overflow:document.documentElement.scrollWidth>innerWidth+1,toolbarHeight:toolbar.getBoundingClientRect().height,panelWidth:panel.getBoundingClientRect().width,navHeight:nav.getBoundingClientRect().height,bandHeight:dock.getBoundingClientRect().height,clipped:[...panel.querySelectorAll('strong,.nvu-profile-summary-money > div > span,.nvu-profile-scope-control button')].filter(n=>n.scrollWidth>n.clientWidth+1).map(n=>n.textContent)};});
    assert(!measure.overflow,JSON.stringify(measure));assert.equal(measure.clipped.length,0,JSON.stringify(measure));assert(measure.toolbarHeight<=45);assert(measure.navHeight>=(approved502?44:50)&&measure.navHeight<=(approved502?48:54),JSON.stringify(measure));assert(measure.bandHeight>=(approved502?60:80)&&measure.bandHeight<=(approved502?64:84),JSON.stringify(measure));
    await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await tick();const last=view().locator('section').last(),box=await last.boundingBox(),band=await page.locator('.nvu-workspace-dock-region').boundingBox();assert(box.y+box.height<=band.y-4,JSON.stringify({tab,width,dark,box,band}));
    if(width===390){await page.evaluate(()=>scrollTo(0,0));await tick();await page.screenshot({path:path.join(output,(tab==='Resumo'?'summary':'statistics')+'-'+(dark?'dark':'light')+'.png')});}
   }
  });
  await page.setViewportSize({width:390,height:867});await page.evaluate(()=>{document.documentElement.classList.add('dark');scrollTo(0,0);});
 }
 if(approved502){
  const companySummary=()=>page.locator('[data-nvu-company-summary]');
  const companyToolbar=()=>page.locator('.nvu-driver-profile-toolbar:visible');
  await check('Empresa recebe Resumo e Estatísticas reais com capa, período e histórico recolhido',async()=>{
   await go('/admin/fleet',{activeTab:'company'});await companySummary().waitFor();
   assert.equal(await companyToolbar().getByRole('button',{name:'Resumo',exact:true}).getAttribute('aria-pressed'),'true');
   assert.equal(await companySummary().getByText('Iveco S Way',{exact:true}).count(),0);
   assert.equal(await companySummary().locator('img').getAttribute('alt'),'Capa de DC Transportes');
   assert.equal(await companySummary().locator('[data-nvu-profile-summary-trips]').innerText(),'32');
   assert.match(await companySummary().innerText(),/693\.026,00/);
   assert(!/01\/10|31\/10|GTO/.test(await companySummary().innerText()));
   assert.equal(await page.locator('[data-nvu-profile-history]:visible button').first().getAttribute('aria-expanded'),'false');
   await companyToolbar().getByRole('button',{name:'Estatísticas',exact:true}).click();
   await page.getByRole('heading',{name:'Desempenho no ranking',exact:true}).waitFor();
   await page.locator('.nvu-profile-company-ranking-label').waitFor();
   assert.equal(await companySummary().count(),0);assert.equal(await page.getByRole('button',{name:'Ranking Interno',exact:true}).count(),0);
   assert.equal(await page.getByRole('heading',{name:'Carreira',exact:true}).count(),1);
   await companyToolbar().getByRole('button',{name:'Resumo',exact:true}).click();
  });
  await check('Descrição da empresa salva offline, sobrevive à reabertura e sincroniza ao reconectar',async()=>{
   await companySummary().getByRole('button',{name:'Adicionar descrição da empresa'}).click();
   await page.evaluate(()=>{localStorage.setItem('qa-offline','true');dispatchEvent(new Event('offline'));});
   await companySummary().getByLabel('Descrição da empresa',{exact:true}).fill('Transportando com qualidade e compromisso.');
   await companySummary().getByRole('button',{name:'Salvar descrição da empresa'}).click();
   await companySummary().getByText('Transportando com qualidade e compromisso.',{exact:true}).waitFor();
   await companySummary().getByText(/Aguardando sincronização/).waitFor();
   assert.equal(await page.evaluate(()=>window.__published.filter(p=>p.data.profileDescription).length),0);
   await page.reload();await go('/admin/fleet',{activeTab:'company'});await companySummary().getByText('Transportando com qualidade e compromisso.',{exact:true}).waitFor();
   await page.evaluate(()=>{localStorage.removeItem('qa-offline');dispatchEvent(new Event('online'));});
   await poll(()=>page.evaluate(()=>window.__published.some(p=>p.path==='frotas/dc'&&p.data.profileDescription==='Transportando com qualidade e compromisso.')));
   await poll(()=>companySummary().getByText(/Aguardando sincronização/).count().then(n=>n===0));
  });
  await check('Descrição atualizada em outro aparelho aparece e edição depende do vínculo ativo',async()=>{
   await page.evaluate(()=>{const records=JSON.parse(localStorage.getItem('qa-canonical'));window.__remoteCover('frotas/dc',{...records['frotas/dc'],profileDescription:'Descrição atualizada por outro administrador.',profileDescriptionRevision:'other-device'});});
   await companySummary().getByText('Descrição atualizada por outro administrador.',{exact:true}).waitFor();
   await page.evaluate(()=>window.__scenario({manager:false}));await tick();
   assert.equal(await companySummary().getByRole('button',{name:/descrição da empresa/}).count(),0);
   assert.equal(await companyToolbar().getByRole('button',{name:'Editar empresa'}).count(),0);
   await page.evaluate(()=>window.__scenario({manager:true}));await companySummary().getByRole('button',{name:'Editar descrição da empresa'}).waitFor();
   await page.evaluate(()=>window.__scenario({activeCompanyId:'second'}));await companySummary().waitFor();
   assert.equal(await companySummary().getByText('Descrição atualizada por outro administrador.',{exact:true}).count(),0);
   await page.evaluate(()=>window.__scenario({activeCompanyId:'dc'}));await companySummary().getByText('Descrição atualizada por outro administrador.',{exact:true}).waitFor();
  });
  for(const theme of ['light','dark'])for(const width of [320,390,412,768,1280])await check('Perfil da empresa responsivo '+theme+' '+width,async()=>{
   await page.setViewportSize({width,height:867});await page.evaluate(theme=>{document.documentElement.classList.toggle('dark',theme==='dark');scrollTo(0,0);},theme);
   for(const tab of ['Resumo','Estatísticas']){
    await companyToolbar().getByRole('button',{name:tab,exact:true}).click();await tick();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await tick();
    const box=await page.locator('[data-nvu-profile-view] section:visible').last().boundingBox(),band=await page.locator('.nvu-workspace-dock-region').boundingBox();
    assert(box.y+box.height<=band.y-4,JSON.stringify({theme,width,tab,box,band}));
    if(width===390){await page.evaluate(()=>scrollTo(0,0));await tick();await page.screenshot({path:path.join(output,'company-'+tab+'-'+theme+'.png')});}
   }
  });
  await page.setViewportSize({width:390,height:867});await page.evaluate(()=>document.documentElement.classList.add('dark'));await go('/driver/profile',{profileTab:'profile'});
 }
 if(approvedProfile){
  await check('Toolbar compacto sem seletores duplicados e filtro real interno/global conectado',async()=>{
   await go('/driver/profile',{profileTab:'profile'});const toolbar=page.locator('.nvu-driver-profile-toolbar');await toolbar.getByRole('button',{name:'Estatísticas',exact:true}).click();
   await page.getByText('6º de 19 motoristas',{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Ranking Interno',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'Ranking Global',exact:true}).count(),1);
   for(const width of [320,390,412,768,1280])for(const dark of [true,false]){
    await page.setViewportSize({width,height:867});await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),dark);await tick();
    const m=await toolbar.evaluate(n=>{const box=n.getBoundingClientRect(),items=[...n.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return {x:r.x,right:r.right,center:r.y+r.height/2,width:r.width};}),sim=document.querySelector('.nvu-cover-simulator').getBoundingClientRect(),header=document.querySelector('.nvu-native-header'),panel=document.querySelector('[data-nvu-panel-active="true"] > .space-y-4 > section')?.getBoundingClientRect();return {height:box.height,items,simHeight:sim.height,headerLine:getComputedStyle(header).borderBottomWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,panelGap:panel?panel.y-box.bottom:null};});
    assert(m.height<=45,JSON.stringify(m));assert(m.simHeight<=35,JSON.stringify(m));assert(!m.overflow,JSON.stringify(m));assert.equal(m.headerLine,'0px');assert(m.items.every(i=>Math.abs(i.center-m.items[0].center)<1));
    if(width===390&&dark)await page.screenshot({path:path.join(output,'profile-approved-dark.png')});
   }
   await page.setViewportSize({width:390,height:867});await page.getByRole('button',{name:'Ranking Interno',exact:true}).click();await page.getByText('2º de 4 motoristas',{exact:true}).waitFor();
   await go('/driver/profile',{profileTab:'activity'});await go('/driver/profile',{profileTab:'profile'});assert.equal(await page.getByRole('button',{name:'Ranking Interno',exact:true}).getAttribute('aria-pressed'),'true');
   await page.getByRole('button',{name:'Ranking Global',exact:true}).focus();await page.keyboard.press('Space');await page.getByText('6º de 19 motoristas',{exact:true}).waitFor();
   await toolbar.getByRole('button',{name:'Informações do perfil'}).click();await page.getByText('driver@example.test',{exact:true}).waitFor();await toolbar.getByRole('button',{name:'Informações do perfil'}).click();assert.equal(await page.getByText('driver@example.test',{exact:true}).count(),0);
   await toolbar.getByRole('button',{name:'Editar meu perfil'}).click();await page.getByRole('dialog',{name:'Editar perfil',exact:true}).waitFor();await page.getByRole('button',{name:'Fechar perfil'}).click();assert.equal(await page.getByRole('dialog',{name:'Editar perfil',exact:true}).count(),0);
  });
  await check('Operação atual mantém a foto e reúne nome e simulador em uma faixa funcional',async()=>{
   await go('/driver/profile',{profileTab:'dashboard'});const bar=page.locator('[data-nvu-operation-identity]');await bar.waitFor();
   assert.equal(await bar.locator('h2').innerText(),'David Canto');assert.equal(await bar.locator('p').count(),0);assert.equal(await page.locator('.nvu-profile-hero p').count(),0);assert.equal(await bar.locator('.nvu-operation-accent').count(),1);
   for(const width of [320,390,412,768,1280]){
    await page.setViewportSize({width,height:867});await page.evaluate(()=>scrollTo(0,0));await tick();
    const m=await bar.evaluate(n=>{const r=n.getBoundingClientRect(),name=n.querySelector('h2').getBoundingClientRect(),sim=n.querySelector('button').getBoundingClientRect();return {height:r.height,x:r.x,right:r.right,nameRight:name.right,simX:sim.x,centers:[name.y+name.height/2,sim.y+sim.height/2],overflow:document.documentElement.scrollWidth>innerWidth+1};});
    assert(m.height<=38,JSON.stringify(m));assert(m.nameRight<=m.simX,JSON.stringify(m));assert(Math.abs(m.centers[0]-m.centers[1])<1);assert(!m.overflow);
   }
   await page.setViewportSize({width:390,height:867});await bar.getByRole('button',{name:'Selecionar simulador',exact:true}).click();const picker=page.getByRole('dialog',{name:'Selecione o simulador'});await picker.waitFor();assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'INPUT');await picker.getByRole('option',{name:'WBDS',exact:true}).click();await tick();assert.equal(await bar.locator('button span').innerText(),'WBDS');
   await page.evaluate(()=>window.__scenario({activeCompanyId:'dc',name:'David Canto com Sobrenome Muito Longo para Conferir a Faixa'}));await page.setViewportSize({width:320,height:867});await tick();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.evaluate(()=>window.__scenario({name:'David Canto'}));await page.setViewportSize({width:390,height:867});await page.screenshot({path:path.join(output,'operation-approved-dark.png')});
   await go('/driver/profile',{profileTab:'profile'});
  });
 }
 if(approved502)for(const theme of ['light','dark'])for(const width of [320,390,768])await check('Operação compacta, foto preservada e identidade legível '+theme+' '+width,async()=>{
   await go('/driver/profile',{profileTab:'dashboard'});await page.setViewportSize({width,height:867});await page.evaluate(theme=>{document.documentElement.classList.toggle('dark',theme==='dark');scrollTo(0,0);},theme);await tick();
   const metrics=await page.evaluate(()=>{
    const bar=document.querySelector('[data-nvu-operation-identity]'),surface=document.querySelector('.nvu-driver-surface[data-page="dashboard"]'),body=document.querySelector('.nvu-current-operation-body'),photo=document.querySelector('.nvu-driver-vehicle-photo > button'),description=document.querySelector('.nvu-driver-page-heading[data-page="dashboard"] p');
    const actualHeight=body.getBoundingClientRect().height,photoBefore=photo.getBoundingClientRect().height;
    body.style.padding=innerWidth>=640?'16px 16px 12px':'12px 12px 8px';body.style.gap='10px';
    const previousHeight=body.getBoundingClientRect().height;body.removeAttribute('style');
    const style=getComputedStyle(bar),text=getComputedStyle(bar.querySelector('h2')),b=bar.getBoundingClientRect(),s=surface.getBoundingClientRect(),d=description.getBoundingClientRect(),p=photo.getBoundingClientRect();
    return {actualHeight,previousHeight,photoBefore,photoAfter:p.height,crop:getComputedStyle(photo.querySelector('img')).objectFit,identityGap:s.y-b.bottom,color:text.color,paper:style.backgroundColor,subtitleSize:getComputedStyle(description).fontSize,descriptionGap:p.y-d.bottom,overflow:document.documentElement.scrollWidth>innerWidth+1};
   });
   assert(metrics.previousHeight>=metrics.actualHeight+10,JSON.stringify(metrics));assert.equal(metrics.photoBefore,width>=640?256:176);assert.equal(metrics.photoAfter,metrics.photoBefore);assert.equal(metrics.crop,'cover');
   assert(metrics.identityGap>=3&&metrics.identityGap<=9,JSON.stringify(metrics));assert.equal(metrics.subtitleSize,'11px');assert(metrics.descriptionGap>=18,JSON.stringify(metrics));assert(!metrics.overflow);
   assert.equal(metrics.color,theme==='light'?'rgb(24, 35, 50)':'rgb(245, 248, 250)',JSON.stringify(metrics));
   if(width===390)await page.screenshot({path:path.join(output,'operation-compact-'+theme+'.png')});
  });
 await check('Editor abre abaixo da área segura e sem focar campo de texto',async()=>{
  await go('/driver/profile',{profileTab:'profile'});await openCoverEditor();const modal=page.getByRole('dialog',{name:'Capa do perfil'});await modal.waitFor();
  // The dialog itself or its first button may receive focus. Both keep focus
  // inside the dialog without opening the mobile text keyboard.
  assert(await modal.evaluate(node=>node.contains(document.activeElement)&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)));
  const box=await modal.boundingBox();assert(box.y>=12&&box.y+box.height<=855);await page.keyboard.press('Escape');assert.equal(await modal.count(),0);
 });
 await check('Corte e salvamento offline preservam foto, identidade e bytes no aparelho',async()=>{
  await page.evaluate(()=>{localStorage.setItem('qa-offline','true');dispatchEvent(new Event('offline'));});await openCoverEditor();
  await page.getByRole('dialog',{name:'Capa do perfil'}).locator('input[type=file]').setInputFiles({name:'minha-capa.jpg',mimeType:'image/jpeg',buffer:vehicle});
  const crop=page.getByLabel('Enquadrar imagem do banner');await crop.waitFor();await page.getByRole('button',{name:'Usar enquadramento'}).click();await page.getByRole('button',{name:'Salvar capa',exact:true}).click();await page.getByRole('dialog',{name:'Capa do perfil'}).waitFor({state:'detached'});
  await poll(()=>page.evaluate(async()=>{const row=await window.__getCover('driver',{scope:'driver',profileId:'driver'});return row?.status==='pending'&&row?.imageDataUrl?.startsWith('data:');}));
  assert.equal(await page.evaluate(()=>window.__uploads.length),0);assert.equal(await hero().locator('.nvu-cover-copy h2').innerText(),'David Canto');assert.equal(await hero().locator('.nvu-cover-avatar img').getAttribute('src'),avatar);assert((await hero().locator('.nvu-cover-image > img').getAttribute('src')).startsWith('data:'));
 });
 await check('Reabertura offline recupera a nova capa sem HTTP e sem voltar ao banner anterior',async()=>{
  const before=await page.evaluate(async()=>window.__getCover('driver',{scope:'driver',profileId:'driver'}));blockRemote=true;await page.reload();await go('/driver/profile',{profileTab:'profile'});await page.waitForFunction(()=>document.querySelector('.nvu-cover-hero .nvu-cover-image > img')?.src.startsWith('data:'));
  const after=await page.evaluate(async()=>window.__getCover('driver',{scope:'driver',profileId:'driver'}));assert.equal(after.revision,before.revision);assert.equal(after.imageDataUrl,before.imageDataUrl);assert.equal(after.status,'pending');
 });
 await check('Reconexão publica capa pessoal e mostra sincronização confirmada',async()=>{
  blockRemote=false;await page.evaluate(()=>{localStorage.removeItem('qa-offline');dispatchEvent(new Event('online'));});await poll(()=>page.evaluate(async()=>{const row=await window.__getCover('driver',{scope:'driver',profileId:'driver'});return row?.status==='synced'&&row.remoteUrl.includes('capa-');}));await tick();
  assert.equal(await page.evaluate(()=>window.__uploads.length),1);assert.equal(await page.evaluate(()=>window.__published[0].path),'users/driver');assert.equal(await hero().getByRole('status').count(),0);
 });
 await check('Outro usuário vê e mantém offline a mesma capa sincronizada, sem botão de edição',async()=>{
  const viewer=await context.newPage();viewer.on('pageerror',error=>errors.push(String(error)));await viewer.goto(origin+'/view-driver');await poll(()=>viewer.evaluate(async()=>{const row=await window.__getCover('viewer',{scope:'driver',profileId:'driver'});return row?.status==='synced'&&Boolean(row.imageDataUrl);}));
  const ownerRecord=await page.evaluate(async()=>window.__getCover('driver',{scope:'driver',profileId:'driver'}));const viewerRecord=await viewer.evaluate(async()=>window.__getCover('viewer',{scope:'driver',profileId:'driver'}));assert.equal(ownerRecord.revision,viewerRecord.revision);assert.equal(ownerRecord.imageDataUrl,viewerRecord.imageDataUrl);assert.equal(await viewer.getByRole('button',{name:'Editar capa do perfil'}).count(),0);
  blockRemote=true;await viewer.evaluate(()=>localStorage.setItem('qa-offline','true'));await viewer.reload();await viewer.waitForFunction(()=>document.querySelector('.nvu-cover-image > img')?.src.startsWith('data:'));await viewer.close();blockRemote=false;await page.evaluate(()=>{localStorage.removeItem('qa-offline');dispatchEvent(new Event('online'));});
 });
 await check('Trocar empresa mantém capa pessoal e carrega a capa da empresa correta',async()=>{
  await page.evaluate(()=>window.__scenario({activeCompanyId:'second'}));await tick();assert((await hero().locator('.nvu-cover-image > img').getAttribute('src')).startsWith('data:'));await go('/admin/fleet',{activeTab:'company'});assert.equal(await hero().locator('h2').innerText(),'Outra Empresa');assert.equal(await hero().locator('.nvu-cover-image > img').count(),0);await page.evaluate(()=>window.__scenario({activeCompanyId:'dc'}));await tick();assert.equal(await hero().locator('h2').innerText(),'DC Transportes');
 });
 await check('Remover capa sincroniza estado vazio e mantém avatar ou logo',async()=>{
  await go('/driver/profile',{profileTab:'profile'});await openCoverEditor();await page.getByRole('button',{name:'Remover capa'}).click();await page.getByRole('button',{name:'Salvar capa',exact:true}).click();await poll(()=>page.evaluate(async()=>{const row=await window.__getCover('driver',{scope:'driver',profileId:'driver'});return row?.removed&&row.status==='synced';}));await tick();assert.equal(await hero().locator('.nvu-cover-image > img').count(),0);assert.equal(await hero().locator('.nvu-cover-avatar img').getAttribute('src'),avatar);
 });
 assert.deepEqual(errors,[],'Browser exceptions');assert.deepEqual(outbound,[],'Unexpected external access');
 await fs.writeFile(approved502?'reports/approved-profile-502-ui.json':approved500?'reports/approved-profile-500-ui.json':approved499?'reports/approved-profile-499-ui.json':'reports/profile-cover-498-ui.json',JSON.stringify({suite:approved502?'approved-profile-502-ui':approved500?'approved-profile-500-ui':approved499?'approved-profile-499-ui':'profile-cover-498-ui',passed:results.length,checks:results,realComponents:['AdminLayout','DriverLayout','Fleet','Profile','ProfileCoverHero','ProfileCoverEditorModal','BannerPhotoCrop','useProfileCover','profileCoverService','profileCoverStore','profileCoverSync',...(approved502?['Dashboard','CompanyTab','CompanyProfileSummary','useCompanyDescription','companyDescriptionService','companyDescriptionStore']:[]),...(approvedProfile?['DriverProfileToolbar','ProfileHero','DriverPerformanceCard','ProfileRankingPerformanceCard','DriverProfileSummary','HistoryMoneySummary']:[])],adapters:'Session/catalog, remote transport and ranking retrieval fixtures; layouts, toolbar, cover persistence/editor and ranking presentation are real. Unrelated secondary pages and existing profile form are isolated.',unexpectedRequests:outbound,browserErrors:errors},null,2)+'\n');
 console.log((approved502?'APPROVED_PROFILE_502_UI_PASS ':approved500?'APPROVED_PROFILE_500_UI_PASS ':approved499?'APPROVED_PROFILE_499_UI_PASS ':'PROFILE_COVER_498_UI_PASS ')+results.length+' checks');
}catch(error){console.error('BROWSER_ERRORS',errors);console.error('CURRENT_ROUTE',await page.evaluate(()=>window.__route));await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
