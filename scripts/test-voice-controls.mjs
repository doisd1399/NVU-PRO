import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'qa/results/voice-controls');
fs.mkdirSync(output, { recursive: true });
const dom = new JSDOM('<!doctype html><html lang="pt-BR"><body></body></html>', { url: 'http://localhost/driver' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, CustomEvent: dom.window.CustomEvent,
  HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
const errors = [];
dom.window.addEventListener('error', event => errors.push(String(event.error || event.message)));
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const plays = [], players = [];
globalThis.Audio = class {
  volume = 1; onended = null; onerror = null;
  constructor(src) { this.src = src; players.push(this); }
  play() { plays.push({ src: this.src, volume: this.volume }); return Promise.resolve(); }
  pause() {} removeAttribute() {} load() {}
};
await build({
  stdin: { contents: `export {GlobalMenu} from './src/components/GlobalMenu';export {voiceAssistant,voiceCueForRoute} from './src/lib/voiceAssistant';`, resolveDir: root, loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic',
  outfile: path.join(output, 'subject.cjs'), loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' },
  plugins: [{ name: 'controlled-menu-io', setup(b) {
    b.onResolve({ filter: /routePreload$/ }, () => ({ path: 'preload', namespace: 'voice-test' }));
    b.onResolve({ filter: /common\/StableImage$/ }, () => ({ path: 'image', namespace: 'voice-test' }));
    b.onLoad({ filter: /.*/, namespace: 'voice-test' }, args => ({ loader: 'tsx', resolveDir: root, contents: args.path === 'preload'
      ? 'export const preloadRoute=async()=>{};' : 'import React from "react";export const StableImage=({alt})=><span>{alt}</span>;' }));
  } }],
});
const { GlobalMenu, voiceAssistant, voiceCueForRoute } = createRequire(import.meta.url)(path.join(output, 'subject.cjs'));
const { MemoryRouter } = await import('react-router-dom');
const checks = [];
const find = (selector, text) => {
  const element = [...document.querySelectorAll(selector)].find(e => text ? e.textContent.trim() === text : true);
  assert(element, `Missing control: ${selector} ${text || ''}`); return element;
};
const button = text => find('.nvu-voice-settings button', text);
const click = async element => { await act(async () => element.click()); };
const value = async (element, next) => {
  const proto = element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, next);
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    element.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
};
const finish = async () => { await act(async () => players.at(-1)?.onended?.()); };
let renderer, container, failure;
try {
  for (const [mode, role] of [['floating', 'driver'], ['lateral', 'admin']]) {
    dom.window.localStorage.clear(); plays.length = players.length = 0;
    voiceAssistant.setContext(null);
    dom.window.localStorage.setItem('nvu.voice.v1.voice-controls.settings', JSON.stringify({ enabled: false, voice: 'male', volume: .75, mode: 'complete' }));
    voiceAssistant.setContext({ userId: 'voice-controls', companyId: 'qa-company', simulatorId: 'gto', role, route: '/' + role });
    container = document.createElement('div'); document.body.append(container); renderer = createRoot(container);
    const props = { profile: role === 'admin' ? 'company' : 'driver', open: true, onClose() {}, nativeAndroid: mode === 'floating',
      currentUserName: 'Perfil fictício', roleLabel: role, activeRole: role, canSwitchRole: false, onSwitchRole() {}, isProfileMenuOpen: false,
      onToggleProfile() {}, showCompanySwitch: false, onShowCompanySwitch() {}, availableCompanies: [], activeCompanyId: 'qa-company', onCompanySwitch() {},
      onProfileEdit() {}, theme: 'dark', onToggleTheme() {}, onLogout() {}, driverItems: [], companyGroups: [] };
    const mount = async () => act(async () => renderer.render(React.createElement(MemoryRouter, null, React.createElement(GlobalMenu, props))));
    await mount();
    assert.equal(document.querySelectorAll('section[aria-label="Assistente de voz"]').length, 1);
    await click(find('.nvu-voice-heading-button'));
    assert.equal(find('.nvu-voice-switch').getAttribute('aria-checked'), 'false');
    await click(find('.nvu-voice-switch'));
    await click(find('.nvu-voice-choice label', 'Feminina'));
    assert.equal(find('input[value="female"]').checked, true);
    await value(find('input[aria-label="Volume do assistente"]'), '40');
    await value(find('select[aria-label="Frequência do assistente"]'), 'quiet');
    assert.equal(voiceAssistant.getSnapshot().settings.volume, .4);
    assert.equal(voiceAssistant.getSnapshot().settings.mode, 'quiet');
    await click(button('Ouvir exemplo'));
    assert.equal(plays.length, 1); assert(plays[0].src.includes('/female/')); assert.equal(plays[0].volume, .4);
    assert.equal(button('Reproduzindo…').disabled, true);
    await click(find('.nvu-voice-choice label', 'Masculina'));
    assert.equal(plays.length, 1, 'Voice selection must not interrupt the current audio.');
    await finish(); await click(button('Ouvir exemplo'));
    assert.equal(plays.length, 2); assert(plays[1].src.includes('/male/'));
    await click(find('.nvu-voice-switch'));
    assert.equal(button('Ouvir exemplo').disabled, true);
    await act(async () => renderer.unmount()); container.remove(); renderer = null;
    voiceAssistant.setContext(null);
    voiceAssistant.setContext({ userId: 'voice-controls', companyId: 'qa-company', simulatorId: 'gto', role, route: '/' + role });
    assert.deepEqual(voiceAssistant.getSnapshot().settings, { enabled: false, voice: 'male', volume: .4, mode: 'quiet' });
    checks.push({ mode, role, status: 'PASS', checks: ['menu entry', 'expand', 'enable', 'gender', 'volume', 'frequency', 'preview', 'current clip preserved', 'next voice', 'mute', 'persistent preferences'] });
  }
  assert.deepEqual([
    voiceCueForRoute('/admin/fleet', { activeTab: 'fleet', activeFleetTab: 'contracts' }),
    voiceCueForRoute('/admin/fleet', { activeTab: 'fleet', activeFleetTab: 'drivers' }),
    voiceCueForRoute('/admin/fleet', { activeTab: 'hr' }), voiceCueForRoute('/admin/assign'), voiceCueForRoute('/driver/history')
  ], [undefined, undefined, undefined, undefined, undefined]);
  assert.deepEqual(errors, [], 'No uncaught DOM handler errors are allowed.');
} catch (error) { failure = error; }
finally {
  if (renderer) await act(async () => renderer.unmount());
  voiceAssistant.setContext(null); dom.window.close(); delete globalThis.Audio;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ status: failure ? 'FAIL' : 'PASS', checks,
    method: 'Actual GlobalMenu, settings and controller in React DOM/JSDOM; media, image and route preloading controlled. No pixel/layout or device validation.',
    error: failure ? String(failure) : null }, null, 2));
}
if (failure) throw failure;
console.log('VOICE_CONTROLS_PASS: both menus, both voices, settings, preview, mute, persistence and actual route mapping.');
