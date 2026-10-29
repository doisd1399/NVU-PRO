import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeTombstoneGuardError, TRIP_TOMBSTONE_GUARD } from '../src/lib/tripTombstoneGuardError.ts';
import { buildPrintDiagnostic, tagLocalCommitError } from '../src/lib/localCommitDiagnostic.ts';

const err = makeTombstoneGuardError();
assert.equal(err.message, 'CANONICAL_TRIP_TOMBSTONED');
assert.equal(err.code, TRIP_TOMBSTONE_GUARD);
assert.equal(err.tripSyncStage, 'IDENTITY_GUARD');
assert.equal(tagLocalCommitError(err, 'repository-save').localCommitPhase, 'identity-tombstone-check');
err.localCommitTripId = 'private-print-trip-123';
err.localCommitElapsedMs = 5;
const store = {
  'nvu_canonical_trips.v2': JSON.stringify({schemaVersion:2,records:{},outbox:{}}),
  'nvu.trips.tombstones.v2': JSON.stringify([['private-print-trip-123', 1792934076902],['deleted-other',1792934076901]]),
};
const raw = buildPrintDiagnostic(err, err.tripSyncStage, {nativeVersion:'1.0.517'}, {
  getItem(key) { return store[key] || null; },
});
const diagnostic = JSON.parse(raw);
assert.equal(diagnostic.stage, 'IDENTITY_GUARD');
assert.equal(diagnostic.phase, 'identity-tombstone-check');
assert.equal(diagnostic.journal.records, 0);
assert.equal(diagnostic.journal.commands, 0);
assert.deepEqual(diagnostic.identityGuard,{state:'read',markers:2,attemptTombstoned:true});
assert(!raw.includes('private-print-trip-123'));
assert(!raw.includes('deleted-other'));
assert.deepEqual(JSON.parse(store['nvu.trips.tombstones.v2']).length, 2, 'The ledger is unchanged');
const readFailed = JSON.parse(buildPrintDiagnostic(err, err.tripSyncStage, {}, {getItem(){throw Error('broken');}}));
assert.equal(readFailed.identityGuard.state, 'read-failed');
const repo=fs.readFileSync('src/repositories/CanonicalTripRepository.ts','utf8');
const cmd=fs.readFileSync('src/application/trip/CanonicalTripCommandService.ts','utf8');
const ui=fs.readFileSync('src/pages/driver/RecordTrip.tsx','utf8');
assert(repo.includes('if (isTripTombstoned(id) && !isDeleted(trip))'));
assert(repo.includes('throw makeTombstoneGuardError()'));
assert(cmd.includes('tombstoned ? "IDENTITY_GUARD" : "LOCAL_COMMIT"'));
assert(ui.includes('combinedError.includes("CANONICAL_TRIP_TOMBSTONED")'));
console.log('PASS: guarded identity preserved, diagnostic is redacted, no tombstones cleared, domain-specific user message');
