// Windows/desktop: o menu flutuante é uma gaveta lateral (19rem, da barra do topo à base). Mede o GlobalMenu REAL
// com o CSS compilado em Chromium: regras antigas do menu de 24rem centralizado já venceram a gaveta uma vez.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root = path.resolve(import.meta.dirname, '..');
const cssDir = path.join(root, 'dist/assets');
assert(fs.existsSync(cssDir), 'Build the real CSS before the browser test.');
const css = fs.readdirSync(cssDir).filter(n => n.endsWith('.css')).map(n => fs.readFileSync(path.join(cssDir, n), 'utf8')).join('\n');
const source = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';
import {GlobalMenu} from './src/components/GlobalMenu';
const params=new URLSearchParams(location.search),role=params.get('role')==='admin'?'admin':'driver';
function Scene(){const[open,setOpen]=useState(params.get('open')!=='0');window.__toggle=()=>setOpen(v=>!v);return <div className="nvu-workspace-shell nvu-desktop-shell"><main>conteúdo</main>
<GlobalMenu profile={role==='admin'?'company':'driver'} open={open} onClose={()=>setOpen(false)} nativeAndroid={false}
currentUserName='Perfil de teste' roleLabel={role==='admin'?'Administrador':'Motorista'} activeRole={role} canSwitchRole={false} onSwitchRole={()=>{}} isProfileMenuOpen={false} onToggleProfile={()=>{}}
showCompanySwitch={false} onShowCompanySwitch={()=>{}} availableCompanies={[]} activeCompanyId='company-qa' onCompanySwitch={()=>{}} onProfileEdit={()=>{}}
theme='light' onToggleTheme={()=>{}} onLogout={()=>{}} driverItems={[]} companyGroups={[]}/></div>;}
createRoot(document.getElementById('root')).render(<MemoryRouter><Scene/></MemoryRouter>);`;
const bundled = await build({ stdin: { contents: source, loader: 'tsx', resolveDir: root }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env.BASE_URL': '"/"' },
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /routePreload$/ }, () => ({ path: 'preload', namespace: 'stub' }));
    b.onResolve({ filter: /common\/StableImage$/ }, () => ({ path: 'image', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'tsx', resolveDir: root, contents: args.path === 'preload'
      ? 'export const preloadRoute=async()=>{};' : 'import React from "react";export const StableImage=({alt})=><span>{alt}</span>;' }));
  } }] });
const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><style>${css}</style><body><div id="root"></div><script>${bundled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.NVU_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const role of ['driver', 'admin']) {
    for (const viewport of [{ width: 1366, height: 900 }, { width: 1024, height: 768 }]) {
      const page = await browser.newPage({ viewport });
      await page.goto(`${origin}/?role=${role}`);
      const menu = page.locator('[data-nvu-unified-profile-menu]');
      await menu.waitFor({ state: 'visible' });
      await page.waitForTimeout(400);
      const open = await menu.evaluate(el => { const r = el.getBoundingClientRect(), c = getComputedStyle(el); return { x: r.x, y: r.y, w: r.width, b: r.bottom, transform: c.transform, opacity: c.opacity, fs: parseFloat(getComputedStyle(document.documentElement).fontSize) }; });
      const tag = `${role} ${viewport.width}x${viewport.height}`;
      assert.equal(Math.round(open.x), 0, `${tag}: gaveta encostada na borda esquerda (x=${open.x})`);
      assert.equal(Math.round(open.w), Math.round(19 * open.fs), `${tag}: largura de 19rem (${open.w})`);
      assert(open.transform === 'none' || open.transform === 'matrix(1, 0, 0, 1, 0, 0)', `${tag}: sem deslocamento quando aberta (${open.transform})`);
      assert.equal(Math.round(open.y), 48, `${tag}: começa logo abaixo da barra do topo (y=${open.y})`);
      assert(Math.abs(open.b - viewport.height) <= 1, `${tag}: vai até a base da janela (bottom=${open.b})`);
      assert.equal(open.opacity, '1');
      await page.evaluate(() => window.__toggle());
      await page.waitForTimeout(450);
      const closed = await menu.evaluate(el => { const c = getComputedStyle(el), r = el.getBoundingClientRect(); return { v: c.visibility, o: c.opacity, right: r.right }; });
      assert(closed.v === 'hidden' && closed.o === '0' && closed.right <= 0, `${tag}: fechada, escondida à esquerda (${JSON.stringify(closed)})`);
      await page.close();
    }
  }
  console.log('DESKTOP_SIDE_MENU_PASS: gaveta lateral 19rem, da barra à base, aberta e fechada (driver/admin, 1366 e 1024).');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
