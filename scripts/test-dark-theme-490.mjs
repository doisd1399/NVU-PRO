import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
let playwright;try{playwright=await import('playwright');}catch{playwright=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);}
const root=process.cwd(),out=path.resolve('verification/dark-theme-490');await fs.mkdir(out,{recursive:true});
const cssPrefixes=['vendor','index','DriverWorkspace','ModalSelect','RankingPeriodModal','OperationsTab','RankingGlobal'];
async function styles(dir){const names=await fs.readdir(dir);return (await Promise.all(cssPrefixes.flatMap(pre=>names.filter(n=>n.startsWith(pre+'-')&&n.endsWith('.css'))).map(n=>fs.readFile(path.join(dir,n),'utf8')))).join('\n');}
const css=await styles('dist/assets');
const baselineDir=process.env.NVU_DARK_BASELINE_CSS;const baseline=baselineDir?await styles(baselineDir):null;
const bundle=await build({stdin:{sourcefile:'dark-color-audit.tsx',resolveDir:root,loader:'tsx',contents:`
import React,{useState,useLayoutEffect} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';
import {LayoutGrid,Trophy,Newspaper,Activity,BookOpen,Menu,Bell} from 'lucide-react';
import {GlobalMenu} from './src/components/GlobalMenu';import {Card,CardHeader,CardTitle,CardContent} from './src/components/ui/Card';
import {DriverDock} from './src/components/driver/DriverDock';import {DriverOperationTiming} from './src/components/driver/DriverOperationTiming';import {OperationProgressBar} from './src/components/common/OperationProgressBar';
import {ModalSelect} from './src/components/ui/ModalSelect';import {RankingPeriodModal} from './src/components/RankingPeriodModal';
import RankingPremiumPodium from './src/components/RankingPremiumPodium';import {RankingGamerLeaderboard} from './src/components/RankingGamerLeaderboard';
const noop=()=>{};const items=[{id:'1',name:'Matecom',trips:222},{id:'2',name:'Cooper Log',trips:135},{id:'3',name:'Tijoleira Transportes',trips:49}];
const nav=[{path:'/driver/profile',label:'Painel Operacional',icon:LayoutGrid},{path:'/ranking',label:'Ranking Global',icon:Trophy},{path:'/news',label:'NVU News',icon:Newspaper},{path:'/reports',label:'Relatórios',icon:Activity},{path:'/manual',label:'Manual',icon:BookOpen}];
function App(){const [config,set]=useState({dark:true,screen:'surfaces',company:false,native:true,account:false});window.__colors=set;
useLayoutEffect(()=>{document.documentElement.classList.toggle('dark',config.dark);},[config.dark]);const menu=config.screen==='menu';
return <div className={'nvu-workspace-shell nvu-workspace-theme nvu-driver-workspace '+(config.native?'nvu-native-android nvu-native-profile-route':'nvu-desktop-shell')+(config.company?' nvu-admin-shell nvu-native-admin-company-route':'')}>
<header className='nvu-native-header nvu-profile-native-header nvu-profile-chrome-header' data-nvu-hero-chrome='settled' style={{'--nvu-chrome-progress':1}}><button><Menu/></button><span className='nvu-wordmark nvu-profile-wordmark'>NVU</span><button className='nvu-notification-trigger'><Bell/></button></header>
<main style={{padding:'80px 14px 20px'}}>
{config.screen==='ranking'?<div className='nvu-gamer-ranking nvu-ranking-page'><RankingPremiumPodium items={items} assetType='company' formatCurrency={()=>'R$ 100.000,00'} onOpen={noop}/><RankingGamerLeaderboard items={items} assetType='driver' showPhotos criticalLimit={3} formatCurrency={()=>'R$ 100.000,00'} onOpen={noop}/></div>:
<section data-testid='audit-surfaces'><header className='nvu-driver-page-heading' data-page='dashboard'><h1>Operação atual</h1><p>Acompanhe suas entregas e o prazo.</p></header>
<Card data-testid='audit-card'><CardHeader><CardTitle>Iveco S Way</CardTitle></CardHeader><CardContent><p className='text-gray-400 dark:text-nvu-muted'>Rodocaçamba 6 eixos</p><div className='bg-gray-50/50 dark:bg-nvu-strip rounded-lg p-3 text-center'><strong className='text-slate-800 dark:text-nvu-text'>3/10</strong><small className='block text-gray-400 dark:text-nvu-muted'>ENTREGAS</small></div><div data-testid='audit-progress'><OperationProgressBar percent={30}/></div><p className='text-gray-400 dark:text-nvu-muted'>Progresso da operação</p></CardContent><DriverOperationTiming remaining='1d · 13h · 50min' disabled={false} busy={false} onStart={noop}/></Card>
<div className='mt-3'><ModalSelect title='Selecionar simulador' value='gto' onChange={noop}><option value='gto'>GTO</option><option value='wtds'>World Truck Driving Simulator</option></ModalSelect></div>
</section>}
</main><DriverDock active='dashboard' onSelect={noop}/>
{menu&&<GlobalMenu profile={config.company?'company':'driver'} open nativeAndroid={config.native} onClose={noop} currentUserName='David Canto' roleLabel={config.company?'Administrador':'Motorista'} activeRole={config.company?'admin':'driver'} canSwitchRole isProfileMenuOpen={config.account} onToggleProfile={()=>set(s=>({...s,account:!s.account}))} onSwitchRole={noop} showCompanySwitch={false} onShowCompanySwitch={noop} availableCompanies={[]} activeCompanyId='dc' onCompanySwitch={noop} onProfileEdit={noop} theme={config.dark?'dark':'light'} onToggleTheme={()=>set(s=>({...s,dark:!s.dark}))} onLogout={noop} driverItems={nav} companyGroups={[{items:nav}]} hasSeniorPanelAccess onSeniorPanel={noop}/>}
{config.screen==='calendar'&&<RankingPeriodModal preset='month' startDate='2026-10-01' endDate='2026-10-31' referenceDate={new Date('2026-10-21T12:00:00Z')} onApply={noop} onClose={noop}/>}
</div>;}
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/driver/profile']}><App/></MemoryRouter>);
`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-remote-ports',setup(b){
 b.onLoad({filter:/src\/lib\/routePreload\.ts$/},()=>({contents:'export const preloadRoute=async()=>{};',loader:'ts'}));
 b.onLoad({filter:/src\/components\/common\/StableImage\.tsx$/},()=>({contents:'import React from "react";export function StableImage({wrapperClassName,fallback}){return <span className={wrapperClassName}>{fallback}</span>}',loader:'tsx',resolveDir:root}));
}}]});
const html=`<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'><style id='production-css'>${css}</style><style>*,*::before,*::after{animation:none!important;transition-duration:0s!important}</style></head><body><div id='root'></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
const browser=await playwright.chromium.launch({headless:true,...(process.env.NVU_CHROMIUM_EXECUTABLE?{executablePath:process.env.NVU_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
const results=[],errors=[];const settle=()=>new Promise(r=>setTimeout(r,15));
try{
 const ctx=await browser.newContext();await ctx.route('**/*',async route=>{const u=new URL(route.request().url());assert.equal(u.hostname,'127.0.0.1');if(u.pathname.startsWith('/assets/'))return route.fulfill({body:await fs.readFile(path.join(root,'public',u.pathname)),contentType:'font/woff2'});return route.fulfill({body:html,contentType:'text/html'});});
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:43900/');await page.getByTestId('audit-card').waitFor();
 async function set(config){await page.evaluate(c=>window.__colors(c),config);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.evaluate(()=>document.fonts.ready);}
 async function contrast(selector){return page.locator(selector).evaluateAll(nodes=>{
 const context=document.createElement('canvas').getContext('2d',{willReadFrequently:true});const rgba=s=>{if(!s.startsWith('rgb')){context.clearRect(0,0,1,1);context.fillStyle=s;context.fillRect(0,0,1,1);const c=[...context.getImageData(0,0,1,1).data];return [c[0],c[1],c[2],c[3]/255];}const n=s.match(/[\d.]+/g)?.map(Number)||[];return [n[0]||0,n[1]||0,n[2]||0,n.length>3?n[3]:1]};const over=(a,b)=>[0,1,2].map(i=>a[i]*a[3]+b[i]*(1-a[3])).concat(1);
 const lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((v,c,i)=>v+c*[.2126,.7152,.0722][i],0);
 const bg=n=>{const p=n.parentElement?bg(n.parentElement):[16,26,32,1];return over(rgba(getComputedStyle(n).backgroundColor),p)};
 const all=[];for(const root of nodes){const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);while(walk.nextNode()){const t=walk.currentNode;if(!t.textContent.trim())continue;const el=t.parentElement,st=getComputedStyle(el),r=el.getBoundingClientRect();if(!r.width||!r.height||st.visibility==='hidden'||el.closest('[disabled],[aria-hidden="true"],.nvu-podium-rank,.nvu-podium-participant'))continue;const a=lum(over(rgba(st.color),bg(el))),b=lum(bg(el));all.push({text:t.textContent.trim().slice(0,90),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),color:st.color,bg:getComputedStyle(el).backgroundColor});}}return all;
 });}
 for(const width of [360,412,768,1280])for(const company of [false,true])for(const screen of ['surfaces','menu','ranking','calendar']){
  await page.setViewportSize({width,height:950});const native=width<1000;const config={dark:true,screen,company,native,account:false};await set(config);assert.deepEqual(errors,[],JSON.stringify(config));
  const selector=screen==='menu'?'[data-nvu-unified-profile-menu]':screen==='calendar'?'.nvu-period-dialog':screen==='ranking'?'.nvu-ranking-page':'[data-testid="audit-surfaces"]';
  if(screen==='menu'){
   assert.equal(await page.locator(selector).evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(36, 52, 63)','Menu is opaque and follows the shared elevated surface');
   await page.getByRole('button',{name:company?'Perfil do administrador':'Perfil do motorista',exact:true}).click();await page.getByRole('button',{name:'Editar perfil',exact:true}).waitFor();
  }
  const ratios=await contrast(selector);const failures=ratios.filter(x=>x.ratio<4.49);
  assert.deepEqual(failures,[],`Low-contrast text at ${width}/${company}/${screen}`);
  if(screen==='surfaces'){
   const c=await page.locator('[data-testid="audit-progress"] > div > div').evaluate(n=>getComputedStyle(n).backgroundColor);assert.equal(c,'rgb(36, 207, 222)','Current-operation progress uses cyan');
   if(native)assert.equal(await page.locator('header.nvu-profile-chrome-header').evaluate(n=>{const c=document.createElement('canvas').getContext('2d');c.fillStyle=getComputedStyle(n).backgroundColor;c.fillRect(0,0,1,1);return '#'+[...c.getImageData(0,0,1,1).data].slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('');}),'#101a20','Scrolled driver header uses the page palette');
  }
  results.push({width,company,screen,textChecks:ratios.length,minContrast:Math.min(...ratios.map(x=>x.ratio))});
  if(width===412&&!company)await page.screenshot({path:path.join(out,screen+'-dark.png'),fullPage:true});
  if(baseline){
   await set({...config,dark:false});
   const snapshot=()=>page.evaluate(()=>[...document.querySelectorAll('body *')].filter(n=>n.getClientRects().length).map(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return [n.tagName,s.color,s.backgroundColor,s.borderColor,s.fontSize,s.padding,s.margin,Math.round(r.width*100)/100,Math.round(r.height*100)/100]}));
   const after=await snapshot();await page.locator('#production-css').evaluate((n,css)=>n.textContent=css,baseline);await settle();await page.evaluate(()=>document.fonts.ready);const before=await snapshot();
   assert.deepEqual(after,before,`Light theme changed at ${width}/${company}/${screen}`);await page.locator('#production-css').evaluate((n,css)=>n.textContent=css,css);
  }
 }
 for(const width of [360,412,768,1280]){
  await page.setViewportSize({width,height:950});await set({dark:true,screen:'surfaces',company:false,native:width<1000,account:false});
  await page.getByRole('button',{name:'Selecionar simulador',exact:true}).click();await page.locator('.nvu-options-dialog').waitFor();
  assert.equal(await page.locator('.nvu-options-dialog').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(36, 52, 63)');
  const ratios=await contrast('.nvu-options-dialog');assert.deepEqual(ratios.filter(x=>x.ratio<4.49),[],'Portaled option contrast');
  results.push({width,company:false,screen:'options',textChecks:ratios.length,minContrast:Math.min(...ratios.map(x=>x.ratio))});
  if(width===412)await page.screenshot({path:path.join(out,'options-dark.png'),fullPage:true});
  await page.locator('.nvu-options-close').click();
 }
 assert.deepEqual(errors,[]);await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/dark-theme-490-ui.json',JSON.stringify({result:'PASS',productionCSS:true,actualComponents:['GlobalMenu','Card','DriverOperationTiming','OperationProgressBar','DriverDock','ModalSelect','RankingPeriodModal','RankingPremiumPodium','RankingGamerLeaderboard'],lightBaselineCompared:Boolean(baseline),productionAccess:false,physicalDeviceTested:false,results},null,2));console.log('DARK_THEME_490_PASS',results.length,'layouts; dark contrast and light palette/geometry verified');
}finally{await browser.close();}
