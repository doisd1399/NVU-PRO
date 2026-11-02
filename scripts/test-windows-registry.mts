import assert from 'node:assert/strict';
import { getSimpleAutomationSimulator } from '../src/lib/simpleAutomation.ts';
import { resolveWindowsNavigation } from '../src/lib/windowsNavigation.ts';
const globalWindow = globalThis as any;
globalWindow.window = { nvuWindows: { version: 1, platform: 'windows' } };
for (const [key, name] of [['ets2', 'Euro Truck Simulator 2'], ['ats', 'American Truck Simulator']]) {
  assert.equal(getSimpleAutomationSimulator(name)?.key, key);
  assert.equal(getSimpleAutomationSimulator({ simulatorId: 'opaque-' + key }, [{ id: 'opaque-' + key, name }])?.key, key);
  assert.equal(getSimpleAutomationSimulator({ simulatorId: 'opaque-' + key }, [{ id: 'opaque-' + key, code: key.toUpperCase() }])?.key, key);
  assert.equal(getSimpleAutomationSimulator({ simulatorId: 'opaque-' + key, name }, [{ id: 'opaque-' + key, name: 'Another game' }]), undefined);
  console.log('PASS Windows simulator identity and opaque catalog:', key);
}
assert.equal(getSimpleAutomationSimulator('WTDS'), undefined);
delete globalWindow.window;
assert.equal(getSimpleAutomationSimulator('ETS2'), undefined);
assert.equal(getSimpleAutomationSimulator('ATS'), undefined);
assert.equal(getSimpleAutomationSimulator('WTDS')?.key, 'wtds');
console.log('PASS Web/Android and Windows platform isolation');
const scope = { driverId: 'qa-driver', companyId: 'qa-company', jobId: 'qa-job', contractId: 'qa-contract', simulatorKey: 'ats' };
for (const action of ['panel', 'trips', 'setup'] as const) assert.equal(resolveWindowsNavigation({ action, scope }, scope), action);
assert.equal(resolveWindowsNavigation({ action: 'trips', scope: { ...scope, jobId: 'old-job' } }, scope), null);
assert.equal(resolveWindowsNavigation({ action: 'trips', scope: { ...scope, companyId: 'another-company' } }, scope), null);
assert.equal(resolveWindowsNavigation({ action: 'panel', scope: { ...scope, driverId: 'old-user' } }, scope), null);
assert.equal(resolveWindowsNavigation({ action: 'trips', scope }, null), null);
assert.equal(resolveWindowsNavigation('https://untrusted.invalid', scope), null);
console.log('PASS Windows navigation: correct operation and rejection after context/account switch');
