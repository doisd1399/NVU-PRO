import assert from 'node:assert/strict';
import { loadSourceMetrics } from '/home/ubuntu/nvu-followup-2026-10-04/validation-kit/load-reviewed-source.mjs';
import { CanonicalTripRepository } from '../src/repositories/CanonicalTripRepository.ts';
import { canonicalTripStore } from '../src/lib/CanonicalTripStore.ts';
import { selectCanonicalOperationTrips } from '../src/lib/currentOperation.ts';
import { parseTripValueRecord } from '../src/lib/tripNormalizer.ts';

const date = '2026-10-02T12:00:00.000Z';
const scope = { operationId: 'job-1', driverId: 'driver-1', companyId: 'company-1', contractId: 'contract-1' };
const base = (id) => ({ id, physicalDocumentId: id, tripId: `trip-${id}`, canonicalTripId: `canonical-${id}`, driverId: scope.driverId, companyId: scope.companyId, contractId: scope.contractId, simulatorId: 'gto', status: 'concluida', recordStatus: 'concluida', source: 'legacy_import', createdAt: date, completedAt: date, updatedAt: date, valor: 125 });

canonicalTripStore.clear();
const repo = new CanonicalTripRepository();
const historical = repo.applyServerSnapshot({ ...base('legacy-alias'), trabalhoId: 'old-operation' }, date);
assert.equal(historical.jobId, undefined);
assert.equal(historical.serverUpdatedAt, undefined);
assert.equal(selectCanonicalOperationTrips({ ...scope, id: scope.operationId }, [historical], scope.driverId).length, 0);
const unprovenJob = repo.applyServerSnapshot({ ...base('unproven-job'), jobId: scope.operationId, syncStatus: 'synced' }, date);
assert.equal(unprovenJob.serverUpdatedAt, undefined);
assert.notEqual(unprovenJob.status, 'SERVER_CONFIRMED');
assert.equal(selectCanonicalOperationTrips({ ...scope, id: scope.operationId }, [unprovenJob], scope.driverId).length, 0);

const live = repo.applyServerSnapshot({ ...base('physical-live'), tripId: 'logical-live', canonicalTripId: 'logical-live', jobId: scope.operationId, serverValidatedAt: date }, date);
assert.equal(live.physicalDocumentId, 'physical-live');
assert.equal(live.tripId, 'logical-live');
assert.equal(live.canonicalTripId, 'logical-live');
assert.equal(repo.get('logical-live')?.physicalDocumentId, 'physical-live');
assert.equal(selectCanonicalOperationTrips({ ...scope, id: scope.operationId }, [live], scope.driverId).length, 1);

canonicalTripStore.clear();
const partial = new CanonicalTripRepository();
partial.applyServerSnapshots([{ ...base('good') }, { ...base('bad'), physicalDocumentId: undefined }], date);
assert.equal(partial.list().length, 1);
assert.equal(partial.getLastSnapshotIssues().length, 1);
partial.applyServerSnapshots([], date);
assert.equal(partial.getLastSnapshotIssues().length, 1);

canonicalTripStore.clear();
const failingDb = { list: () => [], get: () => undefined, saveMany: () => { throw new Error('SYNTHETIC_STORAGE_FAILURE'); } };
const atomic = new CanonicalTripRepository({ database: failingDb });
assert.throws(() => atomic.applyServerSnapshots([{ ...base('atomic-failure') }], date), /SYNTHETIC_STORAGE_FAILURE/);
assert.equal(atomic.list().length, 0);

assert.equal(parseTripValueRecord({ valor: 125, valorCents: '' }), 125);
assert.equal(parseTripValueRecord({ valor: 125, valorCents: '9900' }), 99);
assert.equal(parseTripValueRecord({ valorCents: 12345 }), 123.45);

const docs = Array.from({ length: 1001 }, (_, i) => ({ id: `page-${String(i).padStart(4, '0')}`, data: () => ({ empresaId: 'company-1', driverId: 'driver-1', createdAt: new Date(Date.parse(date) + i * 1000).toISOString(), valor: 1 }) }));
const legacy = { id: 'legacy-date-only', data: () => ({ empresaId: 'company-1', driverId: 'driver-1', dataViagem: date, valor: 1 }) };
docs.push(legacy);
let pages = 0;
const loaded = await loadSourceMetrics('/home/ubuntu/nvu-correction-2026-10-04/source-corrected', {
  getDocs: async (q) => {
    pages++;
    const order = q.filters.find((f) => f.orderBy);
    let selected = docs.filter((d) => q.filters.filter((f) => f.field).every((f) => d.data()[f.field] === f.value));
    if (order) selected = selected.filter((d) => Object.hasOwn(d.data(), order.orderBy)).sort((a, b) => String(b.data()[order.orderBy]).localeCompare(String(a.data()[order.orderBy])) || a.id.localeCompare(b.id));
    const after = q.filters.find((f) => f.startAfter)?.startAfter;
    if (after) selected = selected.slice(selected.findIndex((d) => d.id === after.id) + 1);
    const cap = q.filters.find((f) => f.limit)?.limit;
    return { docs: cap == null ? selected : selected.slice(0, cap), size: selected.length };
  },
});
try {
  const snapshot = await loaded.api.auditPublicReadTrips('empresaId', 'company-1');
  assert.equal(snapshot.docs.length, 1002);
  assert.ok(snapshot.docs.some((d) => d.id === 'legacy-date-only'));
  assert.ok(pages > 10);
} finally { loaded.dispose(); }

console.log('historical-blockers-v1-v6: PASS V1 no fabricated LIVE proof; V2 identities; V3 coverage; V4 legacy-date pagination >1000; V5 policy; V6 atomic commit');
