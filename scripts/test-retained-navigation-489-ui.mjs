import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
let playwright;try{playwright=await import('playwright');}catch{playwright=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);}
const root=process.cwd();
const bundle=await build({stdin:{resolveDir:root,sourcefile:'retained-ui.tsx',loader:'tsx',contents:`
import React,{lazy,Suspense} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,Routes,Route,useNavigate} from 'react-router-dom';
import {RetainedWorkspaceOutlet} from './src/components/common/RetainedWorkspaceOutlet';import {commitNavigation} from './src/lib/navigationTransition';
let finish;const History=lazy(()=>new Promise(resolve=>{finish=()=>resolve({default:()=> <section data-testid='history'><input aria-label='Filtro do histórico'/><p>Histórico pronto</p></section>});}));
function Probe(){const navigate=useNavigate();window.__go=path=>commitNavigation(()=>navigate(path));window.__finish=()=>finish();return null;}
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/admin/fleet']}><Probe/><input aria-label='Controle responsivo'/><Routes><Route path='/admin' element={<RetainedWorkspaceOutlet scope='viewer:company'/>}><Route path='fleet' element={<section data-testid='fleet'><input aria-label='Busca da frota'/><p>Frota pronta</p></section>}/><Route path='history' element={<History/>}/></Route></Routes></MemoryRouter>);
`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const html=`<!doctype html><html><body><div id='root'></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
const browser=await playwright.chromium.launch({headless:true,...(process.env.NVU_CHROMIUM_EXECUTABLE?{executablePath:process.env.NVU_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.fulfill({body:html,contentType:'text/html'}));await page.goto('http://127.0.0.1:43849');await page.getByTestId('fleet').waitFor();
 await page.getByRole('textbox',{name:'Busca da frota'}).fill('Volvo');await page.evaluate(()=>window.__go('/admin/history'));await page.waitForTimeout(60);
 assert(await page.getByTestId('fleet').isVisible());assert.equal(await page.locator('[data-nvu-panel-loading]').count(),0,'A first lazy destination cannot replace the visible page with a spinner');
 await page.getByRole('textbox',{name:'Controle responsivo'}).fill('responde');await page.evaluate(()=>window.__go('/admin/fleet'));await page.evaluate(()=>window.__finish());await page.waitForTimeout(30);assert(await page.getByTestId('fleet').isVisible(),'Latest selection wins while the first chunk is pending');
 await page.evaluate(()=>window.__go('/admin/history'));await page.getByTestId('history').waitFor();await page.getByRole('textbox',{name:'Filtro do histórico'}).fill('Outubro');
 const durations=[];
 for(let n=0;n<20;n++)for(const [route,id] of [['/admin/fleet','fleet'],['/admin/history','history']]){
  const start=Date.now();await page.evaluate(path=>window.__go(path),route);await page.getByTestId(id).waitFor({state:'visible'});durations.push(Date.now()-start);assert.equal(await page.locator('[data-nvu-panel-loading]').count(),0);
 }
 assert.equal(await page.getByRole('textbox',{name:'Filtro do histórico'}).inputValue(),'Outubro');await page.evaluate(()=>window.__go('/admin/fleet'));await page.getByTestId('fleet').waitFor();assert.equal(await page.getByRole('textbox',{name:'Busca da frota'}).inputValue(),'Volvo');assert.deepEqual(errors,[]);
 await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/retained-navigation-489-ui.json',JSON.stringify({result:'PASS',checks:['pending route preserves visible source','input remains responsive','latest choice wins','40 returns without fallbacks','drafts retained in both pages'],fixtureTransitionTimesMs:durations,physicalDeviceTested:false,productionAccess:false},null,2));console.log('RETAINED_NAVIGATION_489_UI_PASS 5 checks including 40 returns without a loading fallback');
}finally{await browser.close();}
