import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TripRegistrationService } from '../src/application/trip/TripRegistrationService.ts';
import { CanonicalTripRepository } from '../src/repositories/CanonicalTripRepository.ts';
import { selectCanonicalOperationTrips } from '../src/lib/currentOperation.ts';

const confirmed = {
  physicalDocumentId: 'physical-a', id: 'legacy-a', tripId: 'legacy-trip-a', canonicalTripId: 'legacy-canonical-a',
  operationId: 'old-operation-a', recordStatus: 'concluida', status: 'completed', source: 'gto_auto',
  uploadedAt: '2026-01-01T00:00:00.000Z', serverValidatedAt: '2026-01-01T00:00:00.000Z',
  driverId: 'driver-a', companyId: 'company-a', contractId: 'contract-a', valorCents: 12345,
};
const historical = TripRegistrationService.registerHistoricalRead(confirmed);
assert.equal(historical.physicalDocumentId, 'physical-a');
assert.equal(historical.tripId, 'legacy-trip-a');
assert.equal(historical.canonicalTripId, 'legacy-canonical-a');
assert.equal(historical.originalOperationId, 'old-operation-a');
assert.equal(historical.jobId, undefined);
assert.equal(historical.status, 'HISTORY_CONFIRMED');
assert.equal(historical.historicalReadOnly, true);

const canceled = TripRegistrationService.registerHistoricalRead({
  ...confirmed, physicalDocumentId: 'physical-c', id: 'legacy-c', status: 'cancelada', recordStatus: 'cancelada',
});
assert.equal(canceled.recordStatus, 'cancelada');
assert.equal(canceled.status, 'REGISTERED_LOCAL');
assert.equal(canceled.historicalReadOnly, true);

const repo = new CanonicalTripRepository();
const batch = repo.applyServerSnapshots([
  { ...confirmed, physicalDocumentId: 'physical-1' },
  { ...confirmed, physicalDocumentId: 'physical-2', tripId: 'legacy-trip-b', canonicalTripId: 'legacy-canonical-b' },
  { tripId: 'missing-physical', operationId: 'legacy-operation-without-snapshot-id' },
]);
assert.equal(batch.length, 2);
assert.equal(repo.getLastSnapshotIssues().length, 1);
assert.deepEqual(new Set(batch.map((item) => item.physicalDocumentId)), new Set(['physical-1', 'physical-2']));

const job = { id: 'job-1', operationId: 'job-1', driverId: 'driver-a', companyId: 'company-a', contractId: 'contract-a' };
const operationTrips = selectCanonicalOperationTrips(job, [
  confirmed,
  { ...confirmed, physicalDocumentId: 'physical-live', id: 'live', tripId: 'live', canonicalTripId: 'live', jobId: 'job-1', operationId: 'job-1' },
], 'driver-a');
assert.equal(operationTrips.length, 1);
assert.equal(operationTrips[0].tripId, 'live');

const root = path.resolve('.');
const adapter = fs.readFileSync(path.join(root, 'src/application/trip/CanonicalTripRealtimeFirebaseAdapter.ts'), 'utf8');
const ranking = fs.readFileSync(path.join(root, 'functions/src/rankingAggregates.ts'), 'utf8');
const publicProfile = fs.readFileSync(path.join(root, 'src/pages/PublicProfile.tsx'), 'utf8');
assert.match(adapter, /physicalDocumentId:\s*document\.id/);
assert.match(ranking, /isTrustedServerConfirmedTrip/);
assert.match(ranking, /parseTripValueRecord/);
assert.match(publicProfile, /startAfter/);
console.log('historical-rankings-correction: PASS R1-R7, physical identity, mixed batch, scoped operation, ranking and pagination');
