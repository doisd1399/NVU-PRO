import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-voice-ui-'));
const cssDir = path.join(root, 'dist/assets');
assert(fs.existsSync(cssDir), 'Build the real CSS before the browser test.');
const css = fs.readdirSync(cssDir).filter(n => n.endsWith('.css')).map(n => fs.readFileSync(path.join(cssDir, n), 'utf8')).join('\n');
const source = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';
import {GlobalMenu} from './src/components/GlobalMenu';import {voiceAssistant,voiceCueForRoute} from './src/lib/voiceAssistant';
window.__errors=[];window.addEventListener('error',e=>window.__errors.push(e.message));
window.__plays=[];window.__players=[];
window.Audio=class {volume=1;preload='';onended=null;onerror=null;constructor(src){this.src=src;window.__players.push(this);}play(){window.__plays.push({src:this.src,volume:this.volume});return Promise.resolve();}pause(){}removeAttribute(){}load(){}};
window.__finish=()=>{const p=window.__players.at(-1);if(p?.onended)p.onended();};window.__voice=voiceAssistant;window.__routeCue=voiceCueForRoute;
const params=new URLSearchParams(location.search),isFloating=params.get('mode')==='floating',role=params.get('role')==='admin'?'admin':'driver';
const scope={userId:'voice-qa',role,companyId:'company-qa',simulatorId:'gto',route:'/'+role};
if(!localStorage.getItem('nvu.voice.v1.voice-qa.settings'))localStorage.setItem('nvu.voice.v1.voice-qa.settings',JSON.stringify({enabled:false,voice:'male',volume:.75,mode:'complete'}));
voiceAssistant.setContext(scope);
function Scene(){const[open,setOpen]=useState(true),[theme,setTheme]=useState('light');return <div className={'nvu-workspace-shell '+(isFloating?'nvu-native-android':'nvu-desktop-shell')}>
<main><button onClick={()=>setOpen(true)}>Abrir menu</button><button onClick={()=>window.__outside=(window.__outside||0)+1}>Ação externa</button></main>
<GlobalMenu profile={role==='admin'?'company':'driver'} open={open} onClose={()=>setOpen(false)} nativeAndroid={isFloating}
currentUserName='Perfil de teste' roleLabel={role==='admin'?'Administrador':'Motorista'} activeRole={role} canSwitchRole={false} onSwitchRole={()=>{}} isProfileMenuOpen={false} onToggleProfile={()=>{}}
showCompanySwitch={false} onShowCompanySwitch={()=>{}} availableCompanies={[]} activeCompanyId='company-qa' onCompanySwitch={()=>{}} onProfileEdit={()=>{}}
theme={theme} onToggleTheme={()=>{const next=theme==='light'?'dark':'light';setTheme(next);document.documentElement.classList.toggle('dark',next==='dark');}}
onLogout={()=>voiceAssistant.setContext(null)} driverItems={[]} companyGroups={[]}/></div>;}createRoot(document.getElementById('root')).render(<MemoryRouter><Scene/></MemoryRouter>);`;
const bundled = await build({ stdin: { contents: source, loader: 'tsx', resolveDir: root }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env.BASE_URL': '"/"' },
  plugins: [{ name: 'controlled-menu-transports', setup(b) {
    b.onResolve({ filter: /routePreload$/ }, () => ({ path: 'preload', namespace: 'voice-test' }));
    b.onResolve({ filter: /common\/StableImage$/ }, () => ({ path: 'image', namespace: 'voice-test' }));
    b.onLoad({ filter: /.*/, namespace: 'voice-test' }, args => ({ loader: 'tsx', resolveDir: root, contents: args.path === 'preload'
      ? 'export const preloadRoute=async()=>{};'
      : 'import React from "react";export const StableImage=({alt})=><span>{alt}</span>;' }));
  } }] });
const js = bundled.outputFiles[0].text;
const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><div id="root"></div><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.NVU_CHROMIUM_EXECUTABLE;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
} catch (error) {
  await new Promise(resolve => server.close(resolve)); fs.rmSync(tmp, { recursive: true, force: true });
  if (/socket\(\) failed: Operation not permitted|Executable doesn't exist/.test(String(error))) {
    const output = path.join(root, 'qa/results/voice-ui'); fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ status: 'BLOCKED', reason: String(error), method: 'Chromium could not start; no visual result is claimed.' }, null, 2));
    console.error('VOICE_UI_BLOCKED: Chromium indisponível neste ambiente; validação visual não executada.'); process.exit(2);
  }
  throw error;
}
const results = [];
try {
  for (const [mode, role, viewport] of [['floating', 'driver', { width: 390, height: 780 }], ['lateral', 'admin', { width: 1366, height: 900 }]]) {
    const page = await browser.newPage({ viewport }); const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error('VOICE_UI_PAGE_ERROR:', e.message); });
    await page.route('**/*', route => { const u = new URL(route.request().url()); return u.origin === origin ? route.continue() : route.abort(); });
    await page.goto(`${origin}/?mode=${mode}&role=${role}`);
    const panel = page.getByRole('region', { name: 'Assistente de voz' });
    await panel.waitFor({ state: 'visible' });
    await panel.getByRole('button', { name: /^Assistente de voz/ }).click();
    const initialBox = await panel.boundingBox();
    assert(initialBox && initialBox.x >= 0 && initialBox.x + initialBox.width <= viewport.width + 1,
      `${mode}: voice controls must start fully inside the horizontal viewport: ${JSON.stringify(initialBox)}`);
    assert.equal(await panel.getByRole('switch').getAttribute('aria-checked'), 'false');
    await panel.getByRole('switch').click();
    await panel.getByText('Feminina', { exact: true }).click(); assert.equal(await panel.getByRole('radio', { name: 'Feminina' }).isChecked(), true);
    await panel.getByLabel('Volume do assistente').focus(); await panel.getByLabel('Volume do assistente').press('Home'); for (let n=0;n<8;n++) await panel.getByLabel('Volume do assistente').press('ArrowRight'); await panel.getByLabel('Frequência do assistente').selectOption('quiet');
    await panel.getByRole('button', { name: 'Ouvir exemplo' }).click();
    await page.waitForFunction(() => window.__plays.length === 1);
    const playback = await page.evaluate(() => window.__plays[0]); assert(playback.src.includes('/female/')); assert.equal(playback.volume, .4);
    assert.equal(await panel.getByRole('button', { name: 'Reproduzindo…' }).isDisabled(), true);
    await panel.getByText('Masculina', { exact: true }).click(); assert.equal(await page.evaluate(() => window.__plays.length), 1, 'switching voice cannot restart or overlap the clip');
    await page.evaluate(() => window.__finish()); await panel.getByRole('button', { name: 'Ouvir exemplo' }).waitFor();
    await panel.getByRole('button', { name: 'Ouvir exemplo' }).click(); await page.waitForFunction(() => window.__plays.length === 2);
    assert((await page.evaluate(() => window.__plays[1].src)).includes('/male/'));
    await panel.getByRole('switch').click(); assert.equal(await panel.getByRole('button', { name: 'Ouvir exemplo' }).isDisabled(), true);
    const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('nvu.voice.v1.voice-qa.settings')));
    assert.deepEqual(prefs, { enabled: false, voice: 'male', volume: .4, mode: 'quiet' });
    await page.reload(); await panel.waitFor({ state: 'visible' }); await panel.getByRole('button', { name: /^Assistente de voz/ }).click();
    assert.equal(await panel.getByLabel('Volume do assistente').inputValue(), '40');
    assert.equal(await panel.getByLabel('Frequência do assistente').inputValue(), 'disabled');
    assert.equal(await panel.getByRole('switch').getAttribute('aria-checked'), 'false');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('nvu.voice.v1.voice-qa.settings')).mode), 'quiet', 'muting preserves the selected frequency');
    await page.getByRole('switch', { name: 'Alternar modo escuro' }).click();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true);
    const box = await panel.boundingBox(); assert(box && box.x >= 0 && box.x + box.width <= viewport.width + 1 && box.y >= 0 && box.y + box.height <= viewport.height + 1, 'expanded audio preferences must remain inside the viewport');
    const routes = await page.evaluate(() => [window.__routeCue('/admin/fleet', { activeTab: 'fleet', activeFleetTab: 'contracts' }), window.__routeCue('/admin/fleet', { activeTab: 'fleet', activeFleetTab: 'drivers' }), window.__routeCue('/admin/fleet', { activeTab: 'hr' }), window.__routeCue('/admin/assign'), window.__routeCue('/driver/history')]);
    assert.deepEqual(routes, [undefined, undefined, undefined, undefined, undefined]);
    assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.__errors), []);
    const screenshots = path.join(root, 'qa/results/voice-ui'); fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, `${mode}-${role}-dark.png`), fullPage: true });
    results.push({ mode, role, status: 'PASS', checks: ['menu access', 'gender selector', 'volume', 'frequency', 'preview', 'no interruption on gender change', 'mute', 'persistence after reload', 'dark theme', 'viewport fit', 'no automatic navigation speech'] });
    await page.close();
  }
  const output = path.join(root, 'qa/results/voice-ui'); fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ results, method: 'Actual GlobalMenu, settings, controller and compiled app CSS in Chromium; media transport controlled; no Firebase/production access.' }, null, 2));
  console.log('VOICE_UI_PASS: floating/driver and lateral/admin controls, persistence, voices, preview, mute, themes and layout.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(tmp, { recursive: true, force: true }); }
