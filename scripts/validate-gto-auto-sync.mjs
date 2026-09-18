import fs from 'node:fs';

const servicePath = 'android/app/src/main/java/com/nvu/operacional/GtoObserverService.java';
const syncPath = 'android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java';
const pluginPath = 'android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java';
const gradlePath = 'android/app/build.gradle';
const backendPath = 'functions/src/gtoTrips.ts';
const backendIndexPath = 'functions/src/index.ts';

const service = fs.readFileSync(servicePath, 'utf8');
const sync = fs.readFileSync(syncPath, 'utf8');
const plugin = fs.readFileSync(pluginPath, 'utf8');
const gradle = fs.readFileSync(gradlePath, 'utf8');
const backend = fs.readFileSync(backendPath, 'utf8');
const backendIndex = fs.readFileSync(backendIndexPath, 'utf8');

const checks = [];
function check(name, ok) {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
}

const requiredPayloadFields = [
  'sessionId', 'driverId', 'companyId', 'jobId', 'contractId', 'cargo',
  'originCompany', 'destination', 'distanceKm', 'finalValue',
  'completionStatus', 'completedAtClient',
];

const historyFields = [
  'empresaId', 'empresaNome', 'simuladorNome', 'motoristaId', 'motoristaNome',
  'contratoId', 'contratoNumero', 'veiculoId', 'veiculoNome', 'reboqueId',
  'reboqueNome', 'origem', 'destino', 'valor', 'status', 'jobId', 'contractId',
];

check('Firebase BoM configured', gradle.includes('firebase-bom:34.16.0'));
check('Firebase Auth native dependency configured', gradle.includes('firebase-auth'));
check('Firebase Functions native dependency configured', gradle.includes('firebase-functions'));
check('trip session UUID created at beginTrip', service.includes('GtoAutoTripSync.newSessionId()'));
check('trip sync starts only after normal result confirmation', service.includes('"CONFIRMED_NORMAL"')
  && service.includes('GtoTripSubmissionCoordinator.submitCompletedTrip'));
check('durable queue uses separate SharedPreferences', sync.includes('nvu_gto_auto_trip_queue_v1'));
check('retry metadata is durable and backoff is capped', sync.includes('nvu_gto_auto_trip_retry_v1') && sync.includes('MAX_RETRY_MS'));
check('shared-device queue is gated by current Firebase uid', sync.includes('payloadDriverId') && sync.includes('currentUid'));
check('callable region is us-central1 on Android', sync.includes('GtoFirebaseRuntime.functions(context, "us-central1")'));
check('Android calls registerGtoTrip', sync.includes('getHttpsCallable("registerGtoTrip")'));
check('canonical backend export is modular', backendIndex.includes('export { registerGtoTrip } from "./gtoTrips"'));
check('backend region matches Android', backend.includes('functions.region("us-central1").https.onCall'));
check('backend requires authenticated callable context', backend.includes('requireAuthenticatedUid(context)'));
check('backend validates authenticated driver ownership', backend.includes('requestedDriverId !== uid'));
check('backend validates assigned job ownership', backend.includes('jobDriverId !== uid'));
check('backend validates company and contract context', backend.includes('text(job.companyId, 180) !== companyId') && backend.includes('text(job.contractId, 180) !== contractId'));
check('backend requires recordable operation', backend.includes('statusIsTripRecordable(job.status)'));
check('backend normalizes localized km/currency', backend.includes('parsePositiveNumber') && backend.includes('distanceKm') && backend.includes('finalValue'));
check('backend uses deterministic session idempotency', backend.includes('safeTripDocumentId(uid, sessionId)'));
check('backend writes historico_viagens in transaction', backend.includes('db.runTransaction') && backend.includes('transaction.create(tripRef'));
check('backend recalculates operation progress after registration', backend.includes('syncJobProgress(db, jobId, totalDeliveries, serverContractMode)') || backend.includes('syncJobProgress(db, jobId, totalDeliveries)'));
check('backend moves completed contract to awaiting_completion', backend.includes('nextStatus = "awaiting_completion"'));
check('successful Android sync removes queue only after FIX18 ACK', sync.includes('responseContract < CONTRACT_VERSION') && sync.indexOf('responseContract < CONTRACT_VERSION') < sync.indexOf('queue.edit().remove(key).commit()'));

const failureBlock = sync.split('.addOnFailureListener(error -> {')[1]?.split('});\n        }')[0] || '';
check('server failure never discards completed payload', !failureBlock.includes('queue.edit().remove(key)'));
check('failed sync is preserved for retry', failureBlock.includes('markPending(')
  && failureBlock.includes('onPending(')
  && !failureBlock.includes('queue.edit().remove(key)'));
check('process restart recovers completed unsynced trip', service.includes('recoverCompletedTrip') && service.includes('retomando sincronização NVU'));
check('observer retries pending queue', service.includes('GtoAutoTripSync.hasPending') && service.includes('flushAutomaticTripQueue'));
check('plugin exposes sync state', plugin.includes('gtoTripSyncStatus') && plugin.includes('gtoRegisteredTripId'));
check('plugin exposes integrity state', plugin.includes('gtoTripIntegrityStatus') && plugin.includes('gtoContractVersion'));
check('selection detector implementation remains wired', service.includes('selectionCoordinator.onFrameProcessed()') && service.includes('detectPressedRowAfterTouch'));

for (const field of requiredPayloadFields) {
  check(`Android/server contract contains ${field}`, sync.includes(`"${field}"`) && backend.includes(field));
}

check('FIX18 contract version is shared', sync.includes('CONTRACT_VERSION = 18') && backend.includes('contractVersion: 18'));
check('operation context is snapshotted before detection', sync.includes('nvu_gto_trip_snapshot_v2') && service.includes('beginSessionSnapshot(this, prefs, sessionId)'));
check('selected freight is locked in immutable snapshot', sync.includes('lockSelectedFreight') && (service.match(/lockSelectedFreight\(this, prefs\)/g) || []).length >= 1);
check('critical completion uses synchronous persistence', service.includes('boolean completionPersisted = prefs.edit()') && service.includes('.commit();'));
check('completed payload is sealed with SHA-256', sync.includes('MessageDigest.getInstance("SHA-256")') && sync.includes('NVU_GTO_QUEUE_V2'));
check('corrupt queue is quarantined', sync.includes('nvu_gto_auto_trip_quarantine_v2') && sync.includes('quarantine(context, queue'));
check('FIX17 pending queue migration retained', sync.includes('Raw FIX17 payload') && sync.includes('if (record.legacy)'));
check('backend ACK validates exact session/version', sync.includes('responseSession') && sync.includes('responseContract') && backend.includes('contractVersion: 18') && backend.includes('sessionId,'));
check('backend fingerprints idempotent payload', backend.includes('gtoPayloadFingerprint') && backend.includes('payloadFingerprint') && backend.includes('existingFingerprint !== payloadFingerprint'));
check('backend rejects vehicle drift', backend.includes('O veículo da operação mudou desde o início da viagem GTO.'));
check('backend rejects trailer drift', backend.includes('O reboque da operação mudou desde o início da viagem GTO.'));
check('backend requires operation documents', backend.includes('!userSnapshot.exists || !companySnapshot.exists || !jobSnapshot.exists || !contractSnapshot.exists'));
check('backend validates FIX18 completion timestamp', backend.includes('clientContractVersion >= 18 && completedAtClient === null'));
check('fresh-session reset protects completed unsynced trip', service.includes('preserveCompletedTripBeforeReset()') && service.includes('nova viagem bloqueada'));
check('cancelled/stale session snapshots are discarded', service.includes('GtoAutoTripSync.discardSessionSnapshot(this,') && sync.includes('discardSessionSnapshot'));

for (const field of historyFields) {
  const explicit = backend.includes(`${field}:`);
  const shorthand = new RegExp(`\\b${field}\\s*,`).test(backend);
  check(`automatic trip keeps history field ${field}`, explicit || shorthand);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
if (failed.length) {
  console.error('\nFailed checks:');
  for (const item of failed) console.error(`- ${item.name}`);
  process.exit(1);
}
