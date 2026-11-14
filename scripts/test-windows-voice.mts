import test from 'node:test';
import assert from 'node:assert/strict';
import { WindowsVoiceObserver } from '../src/lib/windowsVoicePolicy';
import type { WindowsScope, WindowsStatus } from '../src/lib/windowsAutomation';

test('Windows voice observes live scoped transitions and never confirms local acceptance', () => {
  const events: string[] = [], now = 1_800_000_000_000;
  const scope: WindowsScope = { driverId: 'qa-driver', companyId: 'qa-company', jobId: 'qa-job', contractId: 'qa-contract', simulatorKey: 'ats' };
  const observer = new WindowsVoiceObserver((cue, id) => events.push(`${cue}:${id}`), () => now);
  const status: WindowsStatus = { active: false, enabled: false, connected: false, paused: false, scope, pending: [] };
  observer.observe(status, scope);
  observer.observe({ ...status, active: true, enabled: true, connected: true }, scope);
  assert.equal(events.length, 1); assert(events[0].startsWith('event_pro_ready:'));
  const row = { id: 'qa-trip', scope, state: 'PENDING', event: { capturedAt: now } } as any;
  const live = { ...status, active: true, enabled: true, connected: true, pending: [row] };
  observer.observe(live, scope); observer.observe(live, scope);
  assert.equal(events.filter(e => e.startsWith('event_trip_detected:')).length, 1);
  observer.observe({ ...live, pending: [{ ...row, state: 'CONFIRMED' }] }, scope);
  assert.equal(events.length, 2, 'server confirmation remains owned by the canonical ACK observer');
  observer.observe({ ...live, scope: { ...scope, companyId: 'other' }, pending: [{ ...row, id: 'other-trip' }] }, scope);
  observer.observe({ ...live, pending: [{ ...row, id: 'old', event: { capturedAt: now - 30_000 } }] }, scope);
  assert.equal(events.length, 2);
  const hydrating = new WindowsVoiceObserver(cue => events.push(cue), () => now);
  hydrating.observe(live, scope); assert.equal(events.length, 2, 'restored pending history remains silent');
});
