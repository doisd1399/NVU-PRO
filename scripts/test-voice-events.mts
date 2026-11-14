import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { VoiceEventObserver, type VoicePolicyEvent } from '../src/lib/voiceEventPolicy';
import type { VoiceObservation } from '../src/lib/voiceEventSource';
const base = { userId: 'u', companyId: 'c', simulatorId: 'gto' };
function setup(role: 'driver' | 'admin' = 'driver') {
  let now = Date.now(); const events: VoicePolicyEvent[] = [];
  const observer = new VoiceEventObserver({ ...base, role }, e => events.push(e), () => now, 'session-a');
  const observe = (kind: VoiceObservation['kind'], rows: any[], extra = {}) => observer.observe({ ...base, role, kind, rows, at: now, ...extra });
  const job = (patch = {}) => ({ id: 'j', companyId: 'c', driverId: 'u', status: 'active', totalDeliveries: 10, progress: 0, updatedAt: now, ...patch });
  const partnership = (patch = {}) => ({ id: 'p', jobId: 'j', driverId: 'u', executorCompanyId: 'c', contractorCompanyId: 'other', goalAmountCents: 10000, earningsCents: 0, updatedAtMs: now, ...patch });
  return { observer, events, observe, job, partnership, now: () => now, tick: (ms: number) => { now += ms; observer.tick(); }, cues: () => events.map(e => e.cue) };
}
test('hydration is silent and only committed operation transitions speak', () => {
  const h = setup(); h.observe('jobs', [h.job({ status: 'pending' })]); assert.deepEqual(h.cues(), []);
  h.observe('jobs', [h.job({ operationSyncState: 'pending_start' })]); assert.deepEqual(h.cues(), []);
  h.observe('jobs', [h.job({ status: 'pending' })]);
  h.observe('jobs', [h.job()]); h.observe('jobs', [h.job({ status: 'completed' })]);
  assert.deepEqual(h.cues(), ['event_job_started', 'event_job_completed']);
});
test('old, cross-account, company and simulator transitions cannot become new events', () => {
  const h = setup(); h.observe('jobs', [h.job({ status: 'pending' })]);
  h.observe('jobs', [h.job()], { userId: 'another' }); h.observe('jobs', [h.job()], { companyId: 'other' });
  h.observe('jobs', [h.job({ simulatorId: 'ats' })]); h.observe('jobs', [h.job({ updatedAt: h.now() - 60000 })]);
  assert.deepEqual(h.cues(), []);
});
test('trip confirmation requires a registration ACK, rotates phrases and rejects unvalidated data', () => {
  const h = setup(); const row = { id: 't', companyId: 'c', driverId: 'u', serverValidatedAt: h.now() };
  h.observe('trip-ack', [{ ...row, serverValidatedAt: null }, { ...row, driverId: 'other' }, { ...row, deleted: true }]);
  assert.deepEqual(h.cues(), []);
  for (let n = 0; n < 3; n++) h.observe('trip-ack', [{ ...row, id: `t${n}` }]);
  assert.deepEqual(h.cues(), ['event_trip_saved', 'event_trip_saved_b', 'event_trip_saved_c']);
});
test('only a definitive own registration failure speaks', () => {
  const h = setup(), row = { id: 't', driverId: 'u', companyId: 'c' };
  h.observe('trip-failed', [row]); assert.deepEqual(h.cues(), []);
  h.observe('trip-failed', [{ ...row, definitive: true }]); assert.deepEqual(h.cues(), ['event_trip_failed']);
});
test('driver progress announces half and the last remaining trip from fresh confirmed progress', () => {
  const h = setup(); h.observe('jobs', [h.job()]); h.observe('jobs', [h.job({ progress: 5, progressUpdatedAt: h.now(), updatedAt: h.now() - 60000 })]);
  h.observe('jobs', [h.job({ progress: 9 })]); h.observe('jobs', [h.job({ progress: 10 })]);
  assert.deepEqual(h.cues(), ['event_half_done', 'event_last_trip']);
});
test('cancellation by a driver does not say the company cancelled', () => {
  const h = setup(); h.observe('jobs', [h.job()]); h.observe('jobs', [h.job({ status: 'cancelled', cancelledBy: 'u' })]); assert.deepEqual(h.cues(), []);
  h.observe('jobs', [h.job()]); h.events.length = 0;
  h.observe('jobs', [h.job({ status: 'cancelled', cancelledBy: 'manager' })]); assert.deepEqual(h.cues(), ['event_job_cancelled']);
});
test('online status alone never claims queued trips were sent', () => {
  const h = setup(); h.observer.connection(false, [], true); assert.deepEqual(h.cues(), []);
  h.observer.connection(false, ['t'], true); h.observer.connection(true, ['t'], true);
  h.observer.synced(1, 0, ['t']); assert.deepEqual(h.cues(), ['event_offline']);
  h.observe('trip-ack', [{ id: 't', driverId: 'u', companyId: 'c', serverValidatedAt: h.now() }]);
  h.observer.synced(1, 0, []); assert.equal(h.cues().at(-1), 'event_back_online');
});
test('deadline alerts require a live threshold crossing; expired jobs at login are silent', () => {
  const h = setup(); h.observe('jobs', [h.job({ dueAt: h.now() - 1000 })]); h.tick(1000); assert.deepEqual(h.cues(), []);
  h.observe('jobs', [h.job({ dueAt: h.now() + 6 * 3600000 + 1000 })]); h.tick(1001);
  assert.deepEqual(h.cues(), ['event_deadline_near']);
  const risk = setup(); risk.observe('jobs', [risk.job({ dueAt: risk.now() + 6 * 3600000 + 1000 })]);
  risk.observe('partnerships', [risk.partnership()]); risk.tick(1001); assert.deepEqual(risk.cues(), ['event_deadline_goal_risk']);
  for (const role of ['driver', 'admin'] as const) { const p = setup(role); p.observe('jobs', [p.job({ dueAt: p.now() + 1000 })]); p.tick(1001); assert.equal(p.cues()[0], role === 'driver' ? 'event_deadline_passed' : 'admin_late'); }
});
test('earnings thresholds come from a confirmed goal and not from trip count', () => {
  const h = setup(); h.observe('partnerships', [h.partnership()]);
  h.observe('partnerships', [h.partnership({ earningsCents: 8000 })]); h.observe('partnerships', [h.partnership({ earningsCents: 10000 })]);
  assert.deepEqual(h.cues(), ['event_near_goal', 'event_goal_reached']);
  const a = setup('admin'); a.observe('partnerships', [a.partnership()]); a.observe('partnerships', [a.partnership({ earningsCents: 10000 })]); assert.deepEqual(a.cues(), ['admin_goal_reached']);
});
test('a paid claim cannot announce receipt; only the receiver-confirmed transition can', () => {
  const d = setup(), payment = { id: 'pay', driverId: 'u', companyId: 'c', status: 'pending', receivedAtMs: d.now() };
  d.observe('payments', [payment]); d.observe('payments', [{ ...payment, status: 'paid' }]); assert.deepEqual(d.cues(), []);
  d.observe('payments', [{ ...payment, status: 'received' }]); assert.deepEqual(d.cues(), ['event_payment_confirmed']);
  const a = setup('admin'); a.observe('partnerships', [a.partnership({ payment: { status: 'pending' } })]);
  a.observe('partnerships', [a.partnership({ payment: { status: 'paid' } })]); assert.deepEqual(a.cues(), []);
  a.observe('partnerships', [a.partnership({ payment: { status: 'settled', settledAtMs: a.now() } })]); assert.deepEqual(a.cues(), ['admin_payment_received']);
  const other = setup('admin'); other.observe('partnerships', [other.partnership({ executorCompanyId: 'other', contractorCompanyId: 'c', payment: { status: 'paid' } })]);
  other.observe('partnerships', [other.partnership({ executorCompanyId: 'other', contractorCompanyId: 'c', payment: { status: 'settled', settledAtMs: other.now() } })]); assert.deepEqual(other.cues(), []);
});
test('business events distinguish initial data, new candidature, offer and an actual refusal', () => {
  const h = setup('admin'); h.observe('candidates', []); h.observe('partnerships', []); h.observe('offers', [{ id: 'offer', status: 'pending' }]);
  h.observe('candidates', [{ id: 'cv', status: 'pending', createdAt: h.now() }]);
  h.observe('partnerships', [h.partnership({ status: 'pending', createdAtMs: h.now() })]);
  h.observe('offers', [{ id: 'offer', status: 'declined', respondedAt: h.now() }]);
  assert.deepEqual(h.cues(), ['admin_new_candidate', 'admin_partnership_offer', 'admin_job_declined']);
});
test('business trips aggregate over ten seconds; starts and completions require server transitions', () => {
  const h = setup('admin'); h.observe('jobs', [h.job({ status: 'pending' })]); h.observe('jobs', [h.job()]);
  h.observe('jobs', [h.job({ progress: 1 })]); h.tick(5000); h.observe('jobs', [h.job({ progress: 2 })]); assert(!h.cues().includes('admin_trips_batch'));
  h.tick(5000); h.observe('jobs', [h.job({ status: 'completed', progress: 2 })]);
  assert.deepEqual(h.cues(), ['admin_driver_started', 'admin_trips_batch', 'admin_driver_completed']);
});
test('daily payment reminders and notification events use a confirmed, scoped source', () => {
  const h = setup('admin'); h.observe('payments', [{ id: 'pay', status: 'pending', amountCents: 100 }]);
  assert.equal(h.cues()[0], 'admin_payments_due');
  h.observer.notification({ id: 'n', ...base, type: 'PARTNERSHIP_PAID', createdAt: h.now() });
  h.observer.notification({ id: 'old', ...base, type: 'PARTNERSHIP_OFFER', createdAt: h.now() - 60000 });
  assert.equal(h.events.length, 1);
});
test('the integration observes existing subscriptions and never creates Firebase reads', () => {
  for (const file of ['src/components/VoiceAssistantEvents.tsx', 'src/lib/voiceEventPolicy.ts', 'src/lib/voiceEventSource.ts']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /from ['"]firebase|\bonSnapshot\s*\(|\bgetDocs?\s*\(/);
  }
  const engine = fs.readFileSync('src/services/sync/SyncEngine.ts', 'utf8');
  assert(engine.indexOf('SERVER_TRIP_ACK_INVALID') < engine.indexOf('kind: "trip-ack"'));
  assert(engine.includes('if (!deleting && !updating) emitVoiceObservation'));
});
