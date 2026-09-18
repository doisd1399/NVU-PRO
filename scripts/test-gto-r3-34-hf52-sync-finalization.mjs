import fs from 'node:fs';
import crypto from 'node:crypto';

const read = (path) => fs.readFileSync(path, 'utf8');
const sha = (path) => crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');

const sync = read('android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java');
const service = read('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java');
const plugin = read('android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java');
const recordTrip = read('src/pages/driver/RecordTrip.tsx');
const gradle = read('android/app/build.gradle');
const workflow = read('.github/workflows/build-android-release.yml');

const checks = [];
const ck = (name, ok) => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
};

ck('HF52 Android identity', gradle.includes('versionCode 104') && gradle.includes('versionName "1.0.104"'));
ck('HF52 workflow identity', workflow.includes('PC-HF52') && workflow.includes('EXPECTED_VERSION_CODE: "104"') && workflow.includes('EXPECTED_VERSION_NAME: "1.0.104"'));

ck('durable queue exposes any-queued truth', sync.includes('static boolean hasQueued(Context context)'));
ck('durable queue exposes background-queued truth', sync.includes('static boolean hasQueuedOtherThan(Context context, String excludedSessionId)'));
ck('durable queue exposes diagnostic count', sync.includes('static int queuedCount(Context context)'));
ck('legacy pending markers self-heal against real queue', sync.includes('static void reconcileBackgroundSyncMarkers(Context context, SharedPreferences mainPrefs)') && sync.includes('!hasPendingSession(context, markedSession)'));

const successCleanup = sync.slice(sync.indexOf('if (!queue.edit().remove(key).commit())'), sync.indexOf('.addOnFailureListener(error ->'));
ck('background ACK is persisted without listener dependency', successCleanup.includes('backgroundSyncLastSessionId') && successCleanup.includes('backgroundSyncLastTripId') && successCleanup.indexOf('backgroundSyncLastSessionId') < successCleanup.lastIndexOf('if (listener != null) listener.onSynced'));
ck('background ACK clears exact sticky marker', successCleanup.includes('.remove("backgroundSyncPendingSessionId")') && successCleanup.includes('.remove("backgroundSyncPendingDetail")') && successCleanup.includes('.remove("backgroundSyncPendingAt")'));
ck('successful queue cleanup reconciles all stale pointers', successCleanup.includes('reconcileBackgroundSyncMarkers(context, mainPrefs);'));

const summaryStart = service.indexOf('private String operationSummaryText()');
const summaryEnd = service.indexOf('private Button menuButton', summaryStart);
const summary = service.slice(summaryStart, summaryEnd);
ck('menu background state comes from sealed queue only', summary.includes('boolean backgroundPending = GtoAutoTripSync.hasQueuedOtherThan(this, currentSessionId);'));
ck('menu no longer trusts sticky background pending marker', !summary.includes('!prefs.getString("backgroundSyncPendingSessionId"'));
ck('current queued trip reports actual send/pending state', summary.includes('currentSessionQueued') && summary.includes('STATUS_SYNCING') && summary.includes('"Enviando..."'));

const listenerStart = service.indexOf('private GtoAutoTripSync.Listener automaticTripSyncListener()');
const listenerEnd = service.indexOf('private void flushAutomaticTripQueue()', listenerStart);
const listener = service.slice(listenerStart, listenerEnd);
ck('every non-current ACK is accepted, not only one legacy previous pointer', !listener.includes('String previousQueuedSession =') && listener.includes('backgroundSyncLastSessionId'));
ck('late background pending callback cannot resurrect removed queue', listener.includes('if (!GtoAutoTripSync.hasPendingSession(GtoObserverService.this, sessionId))'));

const confirmStart = service.indexOf('private void confirmNormalResultAutomatically()');
const confirmEnd = service.indexOf('private GtoAutoTripSync.Listener automaticTripSyncListener()', confirmStart);
const confirm = service.slice(confirmStart, confirmEnd);
const enqueueAt = confirm.indexOf('GtoAutoTripSync.enqueueConfirmedTrip(this, prefs, automaticTripSyncListener())');
const nextAt = confirm.indexOf('prepareNextFreightFromSealedQueue(completedSessionId)');
ck('Concluido still seals current trip before releasing next freight', enqueueAt >= 0 && nextAt > enqueueAt);
ck('Concluido does not wait for or inspect an older queue before sealing current trip', !confirm.includes('hasQueuedOtherThan') && !confirm.includes('backgroundSyncPendingSessionId'));
ck('completed trip keeps immediate durable-save driver message', confirm.includes('Viagem salva ✓ · enviando em segundo plano. Próximo frete liberado.'));

ck('print receipt has explicit analysis/preparation/upload phases', recordTrip.includes('"idle" | "analyzing" | "preparing" | "uploading"') && recordTrip.includes('setReceiptUploadPhase("analyzing")') && recordTrip.includes('setReceiptUploadPhase("uploading")'));
ck('receipt overlay no longer uses generic isUploading state', recordTrip.includes('{receiptUploadPhase !== "idle" && (') && !recordTrip.includes('{isUploading && (\n                    <div className="absolute inset-x-0 bottom-0'));
ck('0 percent is shown only during real Storage upload phase', recordTrip.includes('{receiptUploadPhase === "uploading" && <span>{uploadProgress.toFixed(0)}%</span>}'));
const submitStart = recordTrip.indexOf('const handleLancarViagem = async () =>');
const submitEnd = recordTrip.indexOf('return (', submitStart);
const submit = recordTrip.slice(submitStart, submitEnd > submitStart ? submitEnd : recordTrip.length);
ck('final trip submission does not masquerade as receipt upload', !submit.includes('setReceiptUploadPhase("uploading")'));

ck('plugin exposes queue diagnostics for field postmortem', plugin.includes('gtoDurableQueueCount') && plugin.includes('gtoCurrentSessionQueued') && plugin.includes('gtoBackgroundQueuePending'));

ck('fast freight detector preserved byte-for-byte', sha('android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java') === '2ea7ac8f322553f238c4c4e068caf3ae31a2477c5ed792db4353ce7a8d84880c');
ck('selection coordinator preserved byte-for-byte', sha('android/app/src/main/java/com/nvu/operacional/GtoSelectionCoordinator.java') === 'd84fe0848f5a054225cf939786156c07a291a4eb74a362ca9f72878d920b0ddd');
ck('result visual gate preserved byte-for-byte', sha('android/app/src/main/java/com/nvu/operacional/GtoResultVisualGate.java') === '74814dbfd0e977e1d30f86eb8b2bd615b7bfc19399f6d2950c0e1af2cce57745');
ck('registerGtoTrip backend contract preserved byte-for-byte', sha('functions/src/gtoTrips.ts') === '5b2de010d946e5e98499414a272eb265518bb241525130264f26e45894622f5d');
ck('ready voice preserved byte-for-byte', sha('android/app/src/main/res/raw/nvu_ready_voice_pt_br.mp3') === 'b53a46523dbbe745ac0a9600637ffce7f1f9c34667c64b2b1730c0df32b60bf2');
ck('completed voice preserved byte-for-byte', sha('android/app/src/main/res/raw/nvu_trip_completed_voice_pt_br.mp3') === '49c9c7fb8585b4385971cc3d19c59f8df0015e6e2c74ab1ae4bce7cd45fb7179');

const failed = checks.filter(({ ok }) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF52 sync/finalization checks passed.`);
if (failed.length) process.exit(1);
