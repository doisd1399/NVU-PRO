import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
const root = path.resolve(import.meta.dirname, '..'), output = path.join(root, 'qa/results/voice-bridge');
fs.mkdirSync(output, { recursive: true });
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/driver' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
const stubs = {
  session: 'export const useSessionStore=()=>globalThis.__voiceBridge.session;export const useOperationalStore=()=>({jobs:globalThis.__voiceBridge.jobs||[],jobsReady:globalThis.__voiceBridge.jobsReady!==false});',
  notifications: 'export const useNotificationStore=()=>({notifications:[],notificationsHydrated:true});',
  company: 'export const useCompanyStore=()=>globalThis.__voiceBridge.company;',
  router: 'export const useLocation=()=>globalThis.__voiceBridge.location;',
  cap: 'export const Capacitor={isNativePlatform:()=>false};',
  app: 'export const App={};',
  trip: 'export const CANONICAL_TRIP_UPDATED="nvu:canonical-trip-updated";',
  outbox: 'export const OPERATION_OUTBOX_CHANGED="nvu-operation-outbox-changed";export const operationOutbox={entries:()=>{const h=globalThis.__voiceBridge;if(h.badStorage)throw Error("OPERATION_OUTBOX_INVALID");return h.entries;}};',
  voice: `const h=()=>globalThis.__voiceBridge;
    export const VOICE_CUE_EVENT='nvu:voice-cue';export const voiceCueForRoute=()=>undefined;
    export const voiceAssistant={setContext:(...a)=>h().contexts.push(a),suspend:()=>{},stop:()=>{},onGesture:()=>{},event:(...a)=>h().events.push(a)};`,
};
await build({ stdin: { contents: `export {VoiceAssistantBridge} from './src/components/VoiceAssistantBridge';export {beginAuthTeardown} from './src/lib/authLifecycle';`, loader: 'tsx', resolveDir: root },
  outfile: path.join(output, 'subject.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic',
  plugins: [{ name: 'controlled-voice-events', setup(b) {
    b.onResolve({ filter: /./ }, args => {
      const p = args.path, name = /context\/AppContext$/.test(p) ? 'session' : /context\/CompanyContext$/.test(p) ? 'company' : /context\/NotificationsContext$/.test(p) ? 'notifications'
        : p === 'react-router-dom' ? 'router' : p === '@capacitor/core' ? 'cap' : p === '@capacitor/app' ? 'app'
        : /CanonicalTripUpdateEvent$/.test(p) ? 'trip' : /services\/operationOutbox$/.test(p) ? 'outbox' : /lib\/voiceAssistant$/.test(p) ? 'voice' : null;
      if (name) return { path: name, namespace: 'voice-test' };
    });
    b.onLoad({ filter: /.*/, namespace: 'voice-test' }, args => ({ contents: stubs[args.path], loader: 'js' }));
  } }] });
const { VoiceAssistantBridge, beginAuthTeardown } = createRequire(import.meta.url)(path.join(output, 'subject.cjs'));
let H, renderer, container, failure; const checks = [];
const mount = async (overrides = {}) => {
  H = { session: { currentUser: { id: 'driver-qa' }, activeRole: 'driver' }, company: { activeCompanyId: 'company-qa', companies: [{ id: 'company-qa', simulatorId: 'gto' }] },
    location: { pathname: '/driver', state: null }, contexts: [], events: [], entries: [], ...overrides };
  globalThis.__voiceBridge = H; container = document.createElement('div'); document.body.append(container); renderer = createRoot(container);
  await act(async () => renderer.render(React.createElement(VoiceAssistantBridge)));
};
const dispatch = async (name, detail) => act(async () => window.dispatchEvent(new CustomEvent(name, { detail })));
const trip = overrides => ({ canonicalTripId: 'trip-qa', companyId: 'company-qa', driverId: 'driver-qa', deleted: false,
  status: 'SERVER_CONFIRMED', updatedAt: new Date().toISOString(), ...overrides });
const entry = (id, kind, state) => ({ id, kind, state, actorId: 'driver-qa', companyId: 'company-qa', requestId: id, jobId: id });
const scenario = async (name, run) => {
  try { await run(); checks.push({ name, status: 'PASS' }); }
  finally { if (renderer) await act(async () => renderer.unmount()); renderer = null; container?.remove(); }
};
try {
  await scenario('Current account, role, company, simulator and route configure the controller', async () => {
    await mount(); assert.deepEqual(H.contexts[0], [{ userId: 'driver-qa', role: 'driver', companyId: 'company-qa', simulatorId: 'gto', route: '/driver||', greetingState: 'idle', greetingReady: true }, undefined, true]);
  });
  await scenario('History refreshes, including fresh server snapshots, never announce a new registration', async () => {
    await mount(); await dispatch('nvu:canonical-trip-updated', trip({ status: 'PENDING_SYNC' }));
    await dispatch('nvu:canonical-trip-updated', trip({ deleted: true }));
    await dispatch('nvu:canonical-trip-updated', trip({ driverId: 'another-driver' }));
    await dispatch('nvu:canonical-trip-updated', trip({ companyId: 'another-company' }));
    await dispatch('nvu:canonical-trip-updated', trip({ updatedAt: new Date(Date.now() - 60_000).toISOString() }));
    assert.equal(H.events.length, 0); await dispatch('nvu:canonical-trip-updated', trip({}));
    assert.equal(H.events.length, 0, 'a history refresh is never a new trip ACK');
  });
  await scenario('Hydrated operation receipts stay silent; a new transition requires the actual server ACK', async () => {
    await mount({ entries: [entry('historical', 'start', 'CONFIRMED'), entry('start-qa', 'start', 'PENDING'), entry('finish-qa', 'finish', 'SENDING')] });
    await dispatch('nvu-operation-outbox-changed'); assert.equal(H.events.length, 0);
    H.entries[1] = { ...H.entries[1], state: 'CONFIRMED', result: { job: { status: 'active' } } };
    H.entries[2] = { ...H.entries[2], state: 'CONFIRMED', result: { completed: true, job: { status: 'completed' } } };
    await dispatch('nvu-operation-outbox-changed'); await dispatch('nvu-operation-outbox-changed');
    assert.deepEqual(H.events.map(e => e[0]), ['event_job_started', 'event_job_completed']);
  });
  await scenario('Corrupt local operation storage cannot crash the optional bridge', async () => {
    await mount({ badStorage: true }); await dispatch('nvu-operation-outbox-changed'); assert.equal(H.events.length, 0);
  });
  await scenario('Public screens disable automatic speech while retaining the account context', async () => {
    await mount({ location: { pathname: '/help', state: null } }); assert.equal(H.contexts[0][2], false); assert.equal(H.contexts[0][0].userId, 'driver-qa');
  });
  await scenario('Stale custom cues are ignored and authentication teardown clears the voice context', async () => {
    await mount(); const cue = { cue: 'event_new_job', eventId: 'job-qa', userId: 'driver-qa', companyId: 'company-qa' };
    await dispatch('nvu:voice-cue', { ...cue, at: Date.now() - 60_000 }); assert.equal(H.events.length, 0);
    await dispatch('nvu:voice-cue', { ...cue, at: Date.now() }); assert.equal(H.events.length, 1);
    await act(async () => beginAuthTeardown()); assert.deepEqual(H.contexts.at(-1), [null]);
  });
} catch (error) { failure = error; }
finally { dom.window.close(); delete globalThis.__voiceBridge;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ status: failure ? 'FAIL' : 'PASS', checks,
    method: 'Actual VoiceAssistantBridge and auth lifecycle in React DOM; store, Capacitor and controller ports controlled. No production access.', error: failure ? String(failure) : null }, null, 2)); }
if (failure) throw failure;
console.log('VOICE_BRIDGE_PASS', checks.length);
