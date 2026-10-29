import assert from 'node:assert/strict';
import { buildOperationProjection } from '../src/application/operation/OperationProjectionEngine.ts';

const identity = { uid: 'driver-1', driverId: 'driver-1', companyId: 'company-1', contractId: 'contract-1', operationId: 'job-1' };
const operation = { status: 'active', totalDeliveries: 12 };
const trip = (id, extra = {}) => ({
  canonicalTripId: id, tripId: id, idempotencyKey: `key-${id}`,
  operationId: 'job-1', jobId: 'job-1', driverId: 'driver-1', companyId: 'company-1', contractId: 'contract-1',
  status: 'SERVER_CONFIRMED', recordStatus: 'completed', source: 'gto_auto',
  uploadedAt: new Date().toISOString(), serverValidatedAt: new Date().toISOString(),
  origem: 'A', destino: 'B', valor: 10, createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), ...extra,
});

const history = Array.from({ length: 7 }, (_, i) => trip(`trip-${i + 1}`));
const scenarios = [
  { name: 'counter-12-history-5', history: history.slice(0, 5), progress: 12, expected: 5 },
  { name: 'counter-0-history-7', history, progress: 0, expected: 7 },
  { name: 'counter-50-history-3', history: history.slice(0, 3), progress: 50, expected: 3 },
];
for (const scenario of scenarios) {
  const projection = buildOperationProjection({
    identity, operation, confirmedHistory: scenario.history,
    projectionHints: { progress: scenario.progress, slots: Array.from({ length: scenario.progress }, (_, i) => i + 1), snapshot: { progress: scenario.progress } },
  });
  assert.equal(projection.confirmedTripCount, scenario.expected, scenario.name);
  assert.equal(projection.remainingTrips, 12 - scenario.expected, scenario.name);
  assert.equal(projection.nextSlot, scenario.expected + 1, scenario.name);
  assert.equal(projection.nextAllowedAction, 'RECORD_TRIP', scenario.name);
}

const orphanOnly = buildOperationProjection({
  identity, operation, confirmedHistory: [trip('valid'), { ...trip('orphan'), deleted: true }, { ...trip('pending'), status: 'PENDING_SYNC', serverValidatedAt: undefined }],
  projectionHints: { progress: 3, slots: [1, 2, 3] },
});
assert.equal(orphanOnly.confirmedTripCount, 1);
assert.equal(orphanOnly.nextSlot, 2);
assert.equal(orphanOnly.nextAllowedAction, 'RECORD_TRIP');

for (let i = 0; i < 100; i += 1) {
  const count = [0, 1, 5, 10, 50, 100][i % 6];
  const confirmed = Array.from({ length: Math.min(count, 12) }, (_, j) => trip(`random-${i}-${j}`));
  const staleProgress = [0, 1, 5, 10, 50, 100][(i + 2) % 6];
  const projection = buildOperationProjection({ identity, operation, confirmedHistory: confirmed, projectionHints: { progress: staleProgress } });
  assert.equal(projection.confirmedTripCount, confirmed.length);
  assert.equal(projection.nextAllowedAction, confirmed.length >= 12 ? 'FINALIZE_OPERATION' : 'RECORD_TRIP');
}
console.log('OPERATION_PROJECTION_CHAOS_PASS 3 divergence cases + orphan + 100 randomized projection cases');
