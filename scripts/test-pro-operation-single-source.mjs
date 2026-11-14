import assert from 'node:assert/strict';
import { deriveCurrentOperationProgress } from '../src/lib/currentOperation.ts';
import { filterAndSortTripHistory } from '../src/lib/tripHistoryEngine.ts';
import { toProOperationHistoryRows } from '../src/lib/proOperationHistory.ts';

const scope = { jobId: 'BLS-10', companyId: 'company', driverId: 'driver' };
const job = { id: scope.jobId, companyId: scope.companyId, driverId: scope.driverId,
  contractId: 'contract', totalDeliveries: 12, operationProgressReconciled: true, progress: 5 };
const completed = (slot, value = 2341) => ({ id: `trip-${slot}`, ...scope, contractId: 'contract',
  status: 'completed', source: 'gto_auto', uploadedAt: '2026-09-29T07:00:00.000Z', serverValidatedAt: '2026-09-29T07:00:00.000Z', completedAt: `2026-09-29T06:${String(slot).padStart(2, '0')}:00.000Z`,
  origem: 'Nova Macaé', destino: 'Itapetuna', valor: value });
const initial = [1, 2, 3, 4, 5].map(slot => completed(slot));
const project = (activeJob, trips) => ({
  progress: deriveCurrentOperationProgress(activeJob, trips, scope.driverId),
  rows: toProOperationHistoryRows(filterAndSortTripHistory(trips, {
    periodPreset: 'todos', embeddedJob: activeJob,
  }), scope),
});
const before = project(job, initial);
assert.equal(before.progress, 5);
assert.equal(before.rows.length, 5);
const staleJob = project({ ...job, progress: 6, lastValidatedTripId: 'trip-6' }, initial);
assert.equal(staleJob.progress, 5, 'a job snapshot adiantada não pode aparecer como 6 com histórico confirmado em 5');
assert.equal(staleJob.rows.length, 5);
const offline = { ...completed(6), status: 'PENDING_SYNC', syncStatus: 'pending_sync' };
const queued = project(job, [...initial, offline]);
assert.deepEqual(queued, before, 'an offline receipt cannot advance confirmed progress or history');
const validated = project({ ...job, progress: 6 }, [...initial, completed(6)]);
assert.equal(validated.progress, 6);
assert.equal(validated.rows.length, 6);
const removed = project(job, [...initial, { ...completed(6), status: 'DELETED', deleted: true }]);
assert.deepEqual(removed, before, 'deletion must remove the row and restore 5/12');
const zero = project({ ...job, progress: 6 }, [...initial, completed(6, 0)]);
assert.equal(zero.rows.length, 6, 'a confirmed zero-value legacy row must not vanish from Pro history');
console.log('pro-operation-single-source: PASS online, offline, deletion, zero-value history');
