import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const service = read('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java');
const plugin = read('android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java');
const main = read('android/app/src/main/java/com/nvu/operacional/MainActivity.java');
const sync = read('android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java');
const launcher = read('src/services/gtoWorkLauncher.ts');
const gradle = read('android/app/build.gradle');
const pkg = JSON.parse(read('package.json'));

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
const num = (re, text, fallback = -1) => Number((text.match(re) || [])[1] ?? fallback);

const versionCode = num(/versionCode\s+(\d+)/, gradle);
const versionPatch = num(/versionName\s+"1\.0\.(\d+)"/, gradle);
const bubbleRetry = num(/BUBBLE_RETRY_INTERVAL_MS\s*=\s*([0-9_]+)L/.test(service) ? /BUBBLE_RETRY_INTERVAL_MS\s*=\s*([0-9_]+)L/ : /$^/, service.replaceAll('_',''));
const permissionGrace = num(/PERMISSION_RETURN_GRACE_MS\s*=\s*([0-9_]+)L/.test(service) ? /PERMISSION_RETURN_GRACE_MS\s*=\s*([0-9_]+)L/ : /$^/, service.replaceAll('_',''));
const projectionAttempts = num(/attempt\s*>=\s*(\d+)\)\s*\{\n\s*if \(!active/, plugin);
const observerAttempts = num(/if \(started \|\| attempt >= (\d+)\)/, plugin);
const recoveryAttempts = num(/observerHealthy"\)\) \|\| attempt >= (\d+)\)/, plugin);
const returnAttempts = num(/attempt < (\d+)\)/, main);

check('R3.10 versionCode/versionName advanced', versionCode >= 30 && versionPatch >= 30, `${versionCode}/${versionPatch}`);
check('initial GTO open remains gated by active MediaProjection', launcher.indexOf('requestScreenCapture()') > 0 && launcher.indexOf('requestScreenCapture()') < launcher.indexOf('openGto()') && launcher.includes('if (!status.projectionActive)'));
check('observer cold-start wait covers weak devices (~5s)', observerAttempts >= 24, `attempts=${observerAttempts}`);
check('observer recovery wait covers weak devices (~4s)', recoveryAttempts >= 20, `attempts=${recoveryAttempts}`);
check('projection activation wait covers slow OEMs (~8s)', projectionAttempts >= 55, `attempts=${projectionAttempts}`);
check('return-to-GTO wait covers slow OEMs (~8s)', returnAttempts >= 50, `attempts=${returnAttempts}`);
check('GTO open reuses existing task when possible', plugin.includes('Intent.FLAG_ACTIVITY_REORDER_TO_FRONT'));
check('projection recovery keeps extended foreground grace', service.includes('12_000L') && service.includes('PERMISSION_RETURN_GRACE_MS = 6500L'));
check('bubble retry is sub-second', service.includes('BUBBLE_RETRY_INTERVAL_MS = 350L'));
check('detached bubble resets throttle immediately', service.includes('lastBubbleAttemptAt = 0L') && service.includes('!bubbleView.isAttachedToWindow()'));
check('permission return has multiple slow-OEM bubble retries', ['220L','700L','1400L','2600L','4200L','6500L'].every((x) => service.includes(x)));
check('bubble add/update failures remain diagnosed', service.includes('recordOverlayFailure(ex)') && service.includes('overlayFailureCount'));
check('foreground poll remains frequent enough for self-heal', service.includes('FOREGROUND_POLL_INTERVAL_MS = 350L'));
check('service remains START_STICKY', service.includes('return START_STICKY;'));
check('task removal never cancels current trip', service.includes('onTaskRemoved(Intent rootIntent)') && service.includes('observador GTO e dados da viagem permanecem preservados'));
check('process restart preserves active durable session', service.includes('recoverActiveTrip') && service.includes('hasFreshDurableSession'));
check('CONFIRMING_FREIGHT restart safely rearms WAITING_FREIGHT', service.includes('STATE_CONFIRMING_FREIGHT.equals(restoredState)') && service.includes('? STATE_WAITING_FREIGHT'));
check('selected freight is locked before TRIP_IN_PROGRESS', service.indexOf('GtoAutoTripSync.lockSelectedFreight(this, prefs)') < service.indexOf('setTripState(STATE_TRIP_IN_PROGRESS'));
check('critical km/value conflict fails closed', service.includes('hasCriticalFreightConflict') && service.includes('Selecione novamente para evitar registrar dados errados'));
check('exact freight requires cargo/origin/destination/km/value validity', service.includes('isExactFreightDataValid') && service.includes('km >= 10') && service.includes('value >= 100'));
check('page generation prevents stale page OCR overwrite', service.includes('freightPageGeneration') && service.includes('generation != freightPageGeneration'));
check('fast touch path preserves pre-touch snapshot', service.includes('frozenSelectionPanelFrame') && service.includes('fastBaselineBeforeSequence'));
check('ultra-fast touch has retrospective recovery', service.includes('retrospectiveFastTouchCandidate'));
check('old active route is replaced only by real freight-list evidence', service.includes('handleActiveTripFreightListEvidence') && service.includes('promoteReplacementFreightCandidateToWaiting'));
check('durable Receive evidence protects completed result from freight-list rearm', service.includes('hasRecentNormalResultActionEvidence'));
check('result OCR alone cannot register trip', service.includes('STATE_RESULT_DETECTED') && service.includes('latchExactReceiveAndSend'));
check('Receive and ADS are isolated actions', service.includes('latchExactReceiveAndSend') && service.includes('latchExactAdsTouch'));
check('Receive latch is durable with no temporal expiry constant', service.includes('resultReceiveLatched') && !service.includes('RESULT_ACTION_EVIDENCE_MS'));
check('result snapshot can recover final value locally', service.includes('recoverResultValueFromSnapshotAsync') && service.includes('resultSnapshotPath'));
check('completion is synchronously persisted before RESULT_CONFIRMED', service.indexOf('boolean completionPersisted = prefs.edit()') < service.indexOf('setTripState(STATE_RESULT_CONFIRMED'));
check('completed payload is synchronously queued before network', sync.includes('queue.edit().putString(QUEUE_PREFIX + sessionId, sealed).commit()') && sync.indexOf('queue.edit().putString(QUEUE_PREFIX + sessionId, sealed).commit()') < sync.indexOf('FirebaseFunctions.getInstance'));
check('queue is session-keyed and supports multiple durable pending trips', sync.includes('QUEUE_PREFIX + sessionId') && sync.includes('List<String> keys = new ArrayList<>()'));
check('Firebase transport is driver-UID gated', sync.includes('DRIVER_UID_MISMATCH') && sync.includes('payloadDriverId.equals(currentUid)'));
check('backend ACK validates exact session and contract before dequeue', sync.indexOf('sessionId.equals(responseSession)') < sync.indexOf('queue.edit().remove(key).commit()') && sync.includes('responseContract < CONTRACT_VERSION'));
check('watchdog timeout preserves queue for retry', sync.includes('CALL_WATCHDOG_MS = 25_000L') && sync.includes('CALL_TIMEOUT') && sync.includes('scheduleRetry'));
check('server failure never discards queue', sync.indexOf('.addOnFailureListener') > 0 && !sync.slice(sync.indexOf('.addOnFailureListener')).split('\n').slice(0,25).join('\n').includes('queue.edit().remove'));
check('new trip is blocked until previous ACK unless safely terminal', service.includes('Aguarde a confirmação da entrega anterior antes de iniciar outra viagem'));
check('synced trip exposes Iniciar nova viagem when operation remains open', service.includes('Iniciar nova viagem') && service.includes('isOperationClosedForNewTrip'));
check('operation close blocks extra freight', service.includes('Operação concluída. Inicie uma nova operação para continuar.'));
check('cap sync executes R3.10 aggressive gates', (pkg.scripts?.['cap:sync:android'] || '').includes('audit:gto-r3.10') && (pkg.scripts?.['cap:sync:android'] || '').includes('test:gto-r3.10-stress'));

let passed = 0;
for (const c of checks) {
  if (c.ok) passed++;
  console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log(`\n${passed}/${checks.length} R3.10 aggressive source/invariant checks passed.`);
if (passed !== checks.length) process.exit(1);
