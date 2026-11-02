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

// ---- Simulator names: an internal identifier is never shown as a name (history, ranking card, company/application screens) ----
import { resolveSimulatorName, isOpaqueSimulatorCode } from '../src/lib/resolveSimulator.ts';
import { resolveSimulatorDisplayLabel, formatSimulatorLabel } from '../src/lib/simulatorOptions.ts';
const firestoreId = 'Zk3xP9qLm2Nw8RtYv4Bc';
assert.equal(isOpaqueSimulatorCode(firestoreId), true);
assert.equal(resolveSimulatorName({ simulatorId: firestoreId }, [], []), '', 'no catalog: the document ID is not a name');
assert.equal(resolveSimulatorDisplayLabel({ simulatorId: firestoreId }, [], []), '');
assert.equal(resolveSimulatorDisplayLabel({ simulatorId: firestoreId }, [{ id: firestoreId, name: 'American Truck Simulator' }], []), 'American Truck Simulator', 'opaque ID resolved through the catalog');
// A Windows (SCS) trip document uses the human keys, never a catalog ID.
const scsTrip = { simulatorId: 'ets2', simulatorKey: 'ets2', simulatorCode: 'ETS2', simuladorCodigo: 'ETS2' };
assert.equal(resolveSimulatorDisplayLabel(scsTrip, [], []), 'ETS 2');
assert.equal(resolveSimulatorDisplayLabel(scsTrip, [{ id: firestoreId, name: 'Euro Truck Simulator 2' }], []), 'Euro Truck Simulator 2', 'ets2 and the catalog entry are the same simulator');
assert.equal(resolveSimulatorDisplayLabel({ simulatorId: 'ats' }, [], []), 'ATS');
assert.equal(formatSimulatorLabel(firestoreId), ''); assert.equal(formatSimulatorLabel('eurotrucksimulator2'), 'ETS 2');
for (const id of ['gto', 'wtds', 'wbds', 'toe3', 'pbs']) assert.notEqual(resolveSimulatorDisplayLabel({ simulatorId: id }, [], []), '', id);
console.log('PASS simulator names: internal identifiers are never displayed');
import { displayTripSimulatorName } from '../src/lib/tripSimulatorLabel.ts';
assert.equal(displayTripSimulatorName({ simulatorCode: 'GTO' }), 'GTO');
assert.equal(displayTripSimulatorName({ simulatorCode: 'ETS2', simulatorKey: 'ets2', simulatorId: 'ets2' }), 'ETS 2');
assert.equal(displayTripSimulatorName({ simulatorCode: 'ATS', simulatorKey: 'ats' }), 'ATS');
assert.equal(displayTripSimulatorName({ simulatorId: firestoreId }), '-', 'an opaque simulatorId is never printed');
assert.match(displayTripSimulatorName({ simulatorId: firestoreId, simuladorNome: 'Truckers of Europe 3' }), /Truckers/i);
console.log('PASS trip history simulator label');
