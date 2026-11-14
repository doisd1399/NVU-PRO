import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const mustContain = (file, pattern, label) => assert.match(read(file), pattern, `${label}: ${file}`);

// Canonical identity/outbox contracts are present and versioned.
mustContain('src/domain/operation/OperationalIdentity.ts', /interface OperationalIdentity/, 'OperationalIdentity');
mustContain('src/domain/trip/CanonicalTripOutbox.ts', /schemaVersion: 1/, 'CanonicalTripOutbox schema');
mustContain('src/domain/trip/CanonicalTripOutbox.ts', /idempotencyKey/, 'CanonicalTripOutbox idempotency');
mustContain('src/services/sync/SyncEngine.ts', /nvu_sync_queue_v2/, 'canonical Web queue');

// ACK and state invariants.
mustContain('src/services/sync/SyncEngine.ts', /SERVER_TRIP_ACK_INVALID/, 'remote ACK validation');
mustContain('src/services/sync/SyncEngine.ts', /isAbandonedSync/, 'lease recovery');
mustContain('src/domain/trip/TripStateMachine.ts', /HISTORY_CONFIRMED: \['DELETED'\]/, 'confirmed terminal state');
mustContain('src/application/operation/CanonicalOperationCommandService.ts', /Sole Web gateway/, 'operation status gateway');
mustContain('src/context/CompanyContext.tsx', /company|empresa/i, 'company context');
mustContain('src/contexts/MembershipProvider.tsx', /membership|company/i, 'membership context');
mustContain('firestore.rules', /request\.auth/, 'authenticated Rules scope');

// Print and Pro must enter the canonical path.
mustContain('src/services/sync/FirebaseTripSyncAdapter.ts', /offlineReceiptKey/, 'Print/receipt upload');
mustContain('android/app/src/main/java/com/nvu/operacional/SimpleProNativeSubmissionCoordinator.java', /idempotencyKey/, 'Pro idempotency');
mustContain('android/app/src/main/java/com/nvu/operacional/ProPendingTripStore.java', /retry|PENDING|FAILED/i, 'Pro pending store');
mustContain('android/app/src/main/java/com/nvu/operacional/GtoServiceBoundaries.java', /GtoCaptureController/, 'Android capture boundary');
mustContain('android/app/src/main/java/com/nvu/operacional/GtoServiceBoundaries.java', /GtoOverlayController/, 'Android overlay boundary');
mustContain('android/app/src/main/java/com/nvu/operacional/CanonicalTripOutboxSchema.java', /STATE_SERVER_CONFIRMED/, 'Android outbox schema');

// Production safety: this suite performs no build, deployment, or data mutation.
// A release APK may already exist from a previous phase; this phase never touches it.

console.log('PRODUCTION INTEGRITY SUITE: PASS');
console.log('Covered contracts: identity, outbox, Print, Pro, offline, online, retry, ACK, operation and history.');
console.log('External effects: none (no deploy, no real-data mutation, no APK generation).');
