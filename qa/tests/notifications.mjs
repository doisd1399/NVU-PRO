import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '../..');
const output = path.join(root, 'qa/results/notifications');
fs.mkdirSync(output, { recursive: true });
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/driver' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const stubs = {
  firestore: `const H=()=>globalThis.__nvuNotificationTest;
    export const collection=(_,name)=>({name});
    export const where=(field,op,value)=>({field,op,value});
    export const limit=value=>({limit:value});
    export const orderBy=(field,direction)=>({orderBy:field,direction});
    export const query=(collection,...filters)=>({...collection,filters});
    export const doc=(_,collection,id)=>({collection,id});
    export const serverTimestamp=()=>({testServerTimestamp:true});
    export const updateDoc=async(ref,data)=>{H().writes.push({ref,data});};
    export const getDocs=async()=>{H().historyReads++;return {docs:[]};};
    export const onSnapshot=(query,next,error)=>{
      const subscription={query,next,error,active:true};H().subscriptions.push(subscription);
      return ()=>{subscription.active=false;};
    };`,
  firebase: 'export const db={};export const auth={get currentUser(){return globalThis.__nvuNotificationTest.authUser;}};',
  session: 'export const useSessionStore=()=>globalThis.__nvuNotificationTest.session;',
  lifecycle: 'export const isAuthTeardownActive=()=>globalThis.__nvuNotificationTest.tearingDown;',
  service: 'export const NOTIFICATION_CREATED_EVENT="nvu-notification-created";',
  router: 'export const useLocation=()=>({pathname:globalThis.__nvuNotificationTest.pathname});',
  toast: 'export const toast=(...args)=>{globalThis.__nvuNotificationTest.toasts.push(args);};',
};
await build({
  stdin: { contents: `import React from 'react';
    import {NotificationsProvider,useNotificationStore} from './src/context/NotificationsContext';
    import Listener from './src/components/NotificationToastListener';
    function Probe(){globalThis.__nvuNotificationTest.state=useNotificationStore();return null;}
    export {notificationDestination} from './src/lib/notificationNavigation';
    export function Scene(props){return <NotificationsProvider {...props}><Probe/><Listener/></NotificationsProvider>;}`,
    loader: 'tsx', resolveDir: root },
  outfile: path.join(output, 'subject.cjs'), bundle: true, platform: 'node', format: 'cjs',
  jsx: 'automatic', packages: 'external', define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'controlled-notification-transports', setup(b) {
    b.onResolve({ filter: /./ }, args => {
      const p = args.path;
      const name = p === 'firebase/firestore' ? 'firestore'
        : /\/lib\/firebase$/.test(p) ? 'firebase'
        : /\/context\/AppContext$/.test(p) ? 'session'
        : /\/lib\/authLifecycle$/.test(p) ? 'lifecycle'
        : /\/services\/notificationService$/.test(p) ? 'service'
        : p === 'react-router-dom' ? 'router' : p === 'sonner' ? 'toast' : null;
      if (name) return { path: name, namespace: 'nvu-test' };
    });
    b.onLoad({ filter: /.*/, namespace: 'nvu-test' }, args => ({ contents: stubs[args.path], loader: 'js' }));
  } }],
});
const { Scene, notificationDestination } = createRequire(import.meta.url)(path.join(output, 'subject.cjs'));
const checks = [];
const propsFor = uid => ({ userId: uid, activeRole: 'driver', activeCompanyId: 'company-a', enabled: true });
let renderer, container, H;
async function mount(uid = 'driver-a') {
  H = { subscriptions: [], writes: [], toasts: [], historyReads: 0, tearingDown: false, pathname: '/driver',
    authUser: { uid }, session: { currentUser: { id: uid }, activeRole: 'driver', activeCompanyId: 'company-a' } };
  globalThis.__nvuNotificationTest = H;
  container = document.createElement('div'); document.body.append(container); renderer = createRoot(container);
  await act(async () => renderer.render(React.createElement(Scene, propsFor(uid))));
}
const subscription = (source, uid = H.authUser.uid) => {
  const found = H.subscriptions.findLast(s => s.active && s.query.name === source && s.query.filters.some(f => f.field === 'userId' && f.value === uid));
  assert(found, 'Expected active subscription for ' + source + ':' + uid); return found;
};
const snapshot = records => ({ docs: records.map(record => ({ id: record.id, data: () => { const { id, ...data } = record; return data; } })) });
async function emit(source, records) { await act(async () => subscription(source).next(snapshot(records))); }
async function hydrate() { await emit('notifications', []); await emit('notificacoes', []); }
const notification = (id, overrides = {}) => ({ id, userId: 'driver-a', companyId: 'company-a', targetProfile: 'driver',
  title: 'Aviso ' + id, message: 'Mensagem de teste', type: 'NEW_OPERATION', read: false, createdAtIso: new Date().toISOString(), ...overrides });
async function scenario(name, run) {
  try { await run(); checks.push({ name, status: 'PASS' }); }
  finally { if (renderer) await act(async () => renderer.unmount()); renderer = null; container?.remove(); }
}
let failure;
try {
  await scenario('Hydrates without opening the bell while default legacy capabilities stay enabled', async () => {
    await mount(); await hydrate(); assert.equal(H.state.notificationsHydrated, true);
    assert.equal(H.historyReads, 0); assert.equal(H.toasts.length, 0);
  });
  await scenario('A new notification displays the real toast effect after initial hydration', async () => {
    await mount(); await hydrate(); await emit('notifications', [notification('new')]);
    assert.equal(H.toasts.length, 1); assert.equal(H.toasts[0][0], 'Aviso new');
    assert(H.writes.some(w => w.ref.id === 'new' && w.data.popupShownAtIso));
  });
  await scenario('Repeating a snapshot does not repeat the popup', async () => {
    await mount(); await hydrate(); const record = notification('repeat');
    await emit('notifications', [record]); await emit('notifications', [record]);
    assert.equal(H.toasts.length, 1); assert.equal(H.writes.length, 1);
  });
  await scenario('Another company stays hidden in modern and legacy sources', async () => {
    await mount(); await hydrate(); const record = notification('foreign', { companyId: 'company-b' });
    await emit('notifications', [record]); await emit('notificacoes', [record]);
    assert.equal(H.state.notifications.length, 0); assert.equal(H.toasts.length, 0);
  });
  await scenario('Late callbacks from an old account cannot publish into the new account', async () => {
    await mount(); await hydrate(); const old = ['notifications', 'notificacoes'].map(source => subscription(source));
    H.authUser = { uid: 'driver-b' }; H.session.currentUser = { id: 'driver-b' };
    await act(async () => renderer.render(React.createElement(Scene, propsFor('driver-b'))));
    await hydrate(); await act(async () => old.forEach(s => s.next(snapshot([notification('late')]))));
    assert.equal(H.state.notifications.length, 0); assert.equal(H.toasts.length, 0);
    await emit('notifications', [notification('new-account', { userId: 'driver-b' })]);
    assert.equal(H.toasts.length, 1); assert.equal(H.toasts[0][0], 'Aviso new-account');
  });
  await scenario('The initial snapshot fills the bell without displaying an existing popup', async () => {
    await mount(); const existing = notification('existing');
    await emit('notifications', [existing]); await emit('notificacoes', []);
    assert.equal(H.state.notificationsHydrated, true); assert.equal(H.state.notifications.length, 1); assert.equal(H.toasts.length, 0);
    await emit('notifications', [notification('after-login'), existing]);
    assert.equal(H.toasts.length, 1); assert.equal(H.toasts[0][0], 'Aviso after-login');
  });
  await scenario('Bounded modern and fallback queries are ordered by newest creation time', async () => {
    await mount(); const original = subscription('notifications');
    assert(original.query.filters.some(f => f.orderBy === 'createdAt' && f.direction === 'desc'));
    assert(original.query.filters.some(f => f.limit === 200));
    await act(async () => original.error(Error('synthetic index unavailable')));
    const fallback = subscription('notifications'); assert.notEqual(original, fallback);
    assert(fallback.query.filters.some(f => f.orderBy === 'createdAt' && f.direction === 'desc'));
    assert.equal(fallback.query.filters.some(f => f.field === 'read'), false);
  });
  await scenario('An old-account error cannot create a fallback subscription in a new account', async () => {
    await mount(); const old = subscription('notifications');
    H.authUser = {uid:'driver-b'}; H.session.currentUser = {id:'driver-b'};
    await act(async () => renderer.render(React.createElement(Scene, propsFor('driver-b'))));
    const count = H.subscriptions.length; await act(async () => old.error(Error('late')));
    assert.equal(H.subscriptions.length, count);
  });
  await scenario('Destination chooses the correct driver/company or corporate tab', async () => {
    await mount();
    assert.deepEqual(notificationDestination(notification('route'), 'driver-a'), {role:'driver', companyId:'company-a',path:'/driver',activeTab:undefined});
    assert.deepEqual(notificationDestination(notification('hr',{type:'RH_APPLICATION',targetProfile:'corporate',companyId:'company-b'}),'driver-a'),{role:'admin',companyId:'company-b',path:'/admin/fleet',activeTab:'hr'});
  });
  await scenario('A notification addressed to another account cannot produce a destination', async () => {
    await mount(); assert.equal(notificationDestination(notification('foreign'), 'driver-b'), null);
    assert.equal(notificationDestination({}, 'driver-a'), null);
  });
} catch (error) { failure = error; }
finally {
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ schema: 1, status: failure ? 'FAIL' : 'PASS', checks,
    error: failure ? String(failure) : null, method: 'Real NotificationsProvider, NotificationToastListener and scope rules in React DOM/JSDOM. Firestore, auth session, route and toast transport controlled. Default legacy flags retained.',
    productionAccess: false, realPushSent: false }, null, 2) + '\n');
  dom.window.close(); delete globalThis.__nvuNotificationTest;
}
if (failure) throw failure;
console.log('NOTIFICATIONS_PASS', checks.length);
