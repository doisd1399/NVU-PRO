import assert from 'node:assert/strict';
import { normalizeWorkModeAvailability, normalizeSimulatorKey, isWorkModeAllowed } from '../src/lib/workModeAvailability';
import { uniqueCompanyMembers } from '../src/lib/seniorMembers';

assert.equal(normalizeSimulatorKey('4G0V2HVGMH4M335JMNV1'), null);
assert.equal(normalizeSimulatorKey('Truckers of Europe 3'), 'toe3');
assert.equal(normalizeSimulatorKey('World Truck Driving Simulator'), 'wtds');
const defaults = normalizeWorkModeAvailability(null);
assert.equal(isWorkModeAllowed(defaults, 'print', 'GTO'), true);
assert.equal(isWorkModeAllowed(defaults, 'print', 'random-document-id'), false);
const value = normalizeWorkModeAvailability({ version: 3, print: { enabled: true, simulators: { GTO: false, gto: true, 'invalid-id': false } }, pro: { enabled: false }, max: { enabled: true } });
assert.equal(value.version, 3);
assert.equal(value.print.simulators.gto, false, 'a conflicting alias cannot unpause maintenance');
assert.equal('invalid-id' in value.print.simulators, false);
assert.equal(isWorkModeAllowed(value, 'print', 'gto'), false);
assert.equal(isWorkModeAllowed(value, 'pro', 'toe3'), false);
assert.equal(isWorkModeAllowed(value, 'max', 'toe3'), false);
assert.deepEqual(normalizeWorkModeAvailability(value), value, 'normalization is idempotent');
const members = [
 { id: 'old', companyId: 'a', userId: 'u', status: 'inactive' },
 { id: 'new', companyId: 'a', userId: 'u', status: 'active' },
 { id: 'owner', companyId: 'a', userId: 'owner' },
 { id: 'other', companyId: 'b', userId: 'u' },
 { id: 'removed', companyId: 'a', userId: 'removed', status: 'removed' },
];
assert.deepEqual(uniqueCompanyMembers(members, 'a', 'owner').map(x => x.id), ['new']);
assert.equal(uniqueCompanyMembers(members, 'b').length, 1);
console.log('PASS: simulator normalization, mode/simulator gates, legacy aliases, membership deduplication');
