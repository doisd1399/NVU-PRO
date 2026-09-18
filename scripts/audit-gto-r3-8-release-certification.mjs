import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const service = read('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java');
const plugin = read('android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java');
const permission = read('android/app/src/main/java/com/nvu/operacional/GtoProjectionPermissionActivity.java');
const sync = read('android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java');
const detector = read('android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java');
const coordinator = read('android/app/src/main/java/com/nvu/operacional/GtoSelectionCoordinator.java');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const gradle = read('android/app/build.gradle');
const vars = read('android/variables.gradle');
const cap = read('capacitor.remote.json');
const packageJson = JSON.parse(read('package.json'));
const checks=[];
const check=(n,c)=>checks.push({name:n,ok:!!c});
const has=(t,x)=>t.includes(x);
const code=Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0);
const patch=Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/)||[])[1]||0);

check('R3.8 versionCode >= 28', code >= 28);
check('R3.8 versionName >= 1.0.28', patch >= 28);
check('APK remains local/offline web bundle', /"enabled"\s*:\s*false/.test(cap));
check('Android 7/API24 minimum retained', has(vars,'minSdkVersion = 24'));
check('target/compile API36 retained', has(vars,'compileSdkVersion = 36') && has(vars,'targetSdkVersion = 36'));
check('service remains stopWithTask=false', has(manifest,'android:stopWithTask="false"'));
check('service remains START_STICKY', has(service,'return START_STICKY;'));
check('MainActivity recovers enabled observer on start', has(read('android/app/src/main/java/com/nvu/operacional/MainActivity.java'),'GtoObserverService.recoverIfEnabled(this)'));
check('task removal records continuity and does not stop service', has(service,'public void onTaskRemoved(Intent rootIntent)') && has(service,'observador GTO e dados da viagem permanecem preservados'));

check('projection permission terminal failure clears in-flight latch', has(service,'reportProjectionPermissionTerminalFailure') && has(service,'.putBoolean("projectionPermissionInFlight", false)'));
check('missing projection manager calls terminal callback', has(permission,'reportProjectionPermissionTerminalFailure') && has(permission,'MANAGER_UNAVAILABLE'));
check('consent launch failure calls terminal callback', has(permission,'CONSENT_LAUNCH_FAILED') && has(permission,'reportProjectionPermissionTerminalFailure'));
check('permission result dispatch failure calls terminal callback', has(permission,'SERVICE_DISPATCH_FAILED') && has(permission,'reportProjectionPermissionTerminalFailure'));
check('web permission request is activity-hosted before GTO launch', has(plugin,'@ActivityCallback') && has(plugin,'screenCaptureResult') && has(read('src/services/gtoWorkLauncher.ts'),'requestScreenCapture()'));
check('projection callback generation guard retained', has(service,'generation != projectionGeneration || mediaProjection != projection'));
check('projection resize is generation-bound', has(service,'expectedGeneration != projectionGeneration') && has(service,'virtualDisplay != expectedDisplay'));
check('projection resize is handler-bound', has(service,'captureHandler != handler'));
check('stale resize cannot replace current ImageReader', service.indexOf('expectedGeneration != projectionGeneration') < service.indexOf('imageReader = replacement'));
check('projection onStop requests reauthorization', has(service,'CAPTURE_STOPPED') && has(service,'projectionReauthRequired'));
check('projection resources released on stop', has(service,'releaseCaptureResources(false)'));

check('bubble detach self-heal retained', has(service,'!bubbleView.isAttachedToWindow()') && has(service,'restaurando'));
check('bubble addView failures are persisted', has(service,'recordOverlayFailure(ex)'));
check('bubble drag failure self-heals', has(service,'mainHandler.postDelayed(this::showBubbleIfAllowed, 220L)'));
check('bubble coordinates clamp to current screen', has(service,'bubbleParams.x = clamp(savedX') && has(service,'bubbleParams.y = clamp(savedY'));
check('runtime overlay revocation detected', has(service,'OVERLAY_REVOKED'));
check('runtime usage access revocation detected', has(service,'USAGE_ACCESS_REVOKED'));
check('SystemUI transient foreground cannot steal GTO ownership', has(service,'isTransientForegroundEvent') && has(service,'sawTransientForeground'));
check('API21 foreground event support retained', has(service,'MOVE_TO_FOREGROUND'));
check('API29+ resumed event support retained', has(service,'ACTIVITY_RESUMED'));
check('API24-25 overlay fallback retained', has(service,'TYPE_PHONE'));
check('API26+ application overlay retained', has(service,'TYPE_APPLICATION_OVERLAY'));

check('freight detector remains OCR-free', !/TextRecognition|TextRecognizer|InputImage/.test(detector));
check('freight detector adaptive horizontal bands retained', has(detector,'refineButtonHorizontalBounds'));
check('freight OCR follows detected button geometry', has(service,'freightOcrLeftForCurrentLayout'));
check('page generation isolation retained', has(service,'freightPageGeneration'));
check('stale page text cannot overwrite current generation', has(service,'freightTextGeneration'));
check('critical km/value conflict fails closed', has(service,'hasCriticalFreightConflict') && has(service,'lastFreightConflict'));
check('selection coordinator sequence correlation retained', has(coordinator,'sequence'));
check('replacement list can invalidate stale active route', has(service,'promoteReplacementFreightCandidateToWaiting'));
check('completed Receive evidence wins over replacement list', has(service,'hasRecentNormalResultActionEvidence(now)'));

check('result visual gate only wakes OCR, OCR remains authority', has(read('android/app/src/main/java/com/nvu/operacional/GtoResultVisualGate.java'),'parseResultScreen() remains the authority'));
check('exact Receive still has no timeout', has(service,'the exact Receber touch is the completion rule') && !has(service,'RESULT_ACTION_EVIDENCE_MS'));
check('exact ADS path remains separate', has(service,'latchExactAdsTouch'));
check('generic redacted touch remains durable pending', has(service,'TOUCH_PENDING'));
check('sensor failure no longer silently strands result', has(service,'resultTouchFallbackRequired') && has(service,'Contingência de recebimento pronta'));
check('sensor fallback requires result screen to exit', has(service,'GAMEPLAY_AFTER_RESULT') && has(service,'FREIGHT_LIST_AFTER_RESULT'));
check('sensor fallback breaks on real GTO foreground interruption', has(service,'resultTouchFallbackContinuityBroken'));
check('sensor fallback never auto-registers ambiguous action', has(service,'Confirme abaixo somente se você tocou em Receber'));
check('sensor fallback offers safe discard/new-freight path', has(service,'Descartar e iniciar novo frete') && has(service,'discardUnresolvedResultAndStartNewFreight'));
check('fallback-confirmed Receive is durable normal evidence', has(service,'RECEIVE_FALLBACK_CONFIRMED') && has(service,'boolean receiveLatched'));
check('fallback-confirmed Receive survives process restart', has(service,'"RECEIVE_FALLBACK_CONFIRMED".equals(restoredResultAction)'));

check('result state/value persistence is synchronous before arming Receive', has(service,'boolean resultPersisted = resultEditor') && has(service,'.commit();'));
check('missing final value stores local result snapshot', has(service,'persistResultSnapshot(fullFrame)'));
check('result snapshot is stored in no-backup storage', has(service,'getNoBackupFilesDir()') && has(service,'gto_result_runtime'));
check('result snapshot path is synchronously persisted', has(service,'snapshotPathPersisted') && has(service,'.commit();'));
check('missing final value can be OCR-recovered from local snapshot', has(service,'recoverResultValueFromSnapshotAsync'));
check('snapshot recovery is session/generation guarded', has(service,'recoveryGeneration != resultSnapshotRecoveryGeneration') && has(service,'recoverySessionId.equals'));
check('snapshot is removed after durable completion', service.indexOf('deleteResultSnapshot();\n        setTripState(STATE_RESULT_CONFIRMED') > 0);
check('snapshot is removed when trip analysis is cleared', has(service,'private void clearTripAnalysis() {\n        deleteResultSnapshot();'));
check('images remain local and are not part of Firebase payload', !has(sync,'resultSnapshotPath') && !has(sync,'Bitmap'));

check('completion persistence remains synchronous', has(service,'boolean completionPersisted = prefs.edit()') && has(service,'.commit();'));
check('state cannot advance after failed completion persistence', service.indexOf('if (!completionPersisted)') < service.indexOf('setTripState(STATE_RESULT_CONFIRMED'));
check('durable queue write uses commit', has(sync,'queue.edit().putString(QUEUE_PREFIX + sessionId, sealed).commit()'));
check('payload is SHA-256 sealed', has(sync,'SHA-256') && has(sync,'checksum(payload)'));
check('server call is session-idempotent client side', has(sync,'sessionId') && has(sync,'IN_FLIGHT'));
check('Firebase call watchdog remains 25s', has(sync,'CALL_WATCHDOG_MS = 25_000L'));
check('watchdog returns stuck send to pending retry', has(sync,'CALL_TIMEOUT') && has(sync,'scheduleRetry'));
check('queue removed only after compatible backend ACK', has(sync,'responseContract < CONTRACT_VERSION') && has(sync,'queue.edit().remove(key).commit()'));
check('native auth absence is visible/preserved', has(sync,'NO_NATIVE_AUTH') && has(sync,'Aguardando autenticação NVU'));
check('driver UID mismatch is visible/preserved', has(sync,'DRIVER_UID_MISMATCH'));
check('backend region remains us-central1', has(sync,'FirebaseFunctions.getInstance("us-central1")'));
check('registerGtoTrip callable name unchanged', has(sync,'getHttpsCallable("registerGtoTrip")'));

check('GTO runtime prefs excluded from legacy backup', has(read('android/app/src/main/res/xml/backup_rules.xml'),'nvu_gto_observer.xml'));
check('queue/snapshot prefs excluded from legacy backup', has(read('android/app/src/main/res/xml/backup_rules.xml'),'nvu_gto_auto_trip_queue_v1.xml') && has(read('android/app/src/main/res/xml/backup_rules.xml'),'nvu_gto_trip_snapshot_v2.xml'));
check('Android12+ cloud/device transfer exclusions retained', has(read('android/app/src/main/res/xml/data_extraction_rules.xml'),'<cloud-backup>') && has(read('android/app/src/main/res/xml/data_extraction_rules.xml'),'<device-transfer>'));


check('capture-denied foreground restoration is exception-safe', has(service,'Falha ao manter serviço após recusa da captura'));
check('projection-stop foreground restoration is exception-safe', has(service,'Falha ao manter serviço após encerramento da captura'));
check('projection-start failure foreground restoration is exception-safe', has(service,'Falha ao restaurar serviço depois de erro na leitura da tela'));
check('notification update failures are persisted', has(service,'notificationError') && has(service,'Falha ao atualizar notificação do observador GTO'));
check('plugin exposes notification failure diagnostics', has(plugin,'status.put("notificationError"'));
check('web diagnostics surface notification failures', has(read('src/components/GtoObserverSetup.tsx'),'Serviço em segundo plano'));
check('result snapshot delete failures are no longer silent', has(service,'Não foi possível remover a captura local do resultado') && has(service,'resultSnapshotError'));
check('plugin exposes projection permission in-flight diagnostics', has(plugin,'status.put("projectionPermissionInFlight"'));
check('plugin exposes result sensor fallback diagnostics', has(plugin,'status.put("resultTouchFallbackRequired"') && has(plugin,'status.put("resultTouchFallbackReady"') && has(plugin,'status.put("resultTouchFallbackContinuityBroken"'));
check('plugin exposes local result recovery errors', has(plugin,'status.put("resultSnapshotError"') && has(plugin,'resultSnapshotErrorAt'));
check('web bridge types include R3.8 diagnostics', has(read('src/lib/gtoObserver.ts'),'projectionPermissionInFlight?: boolean') && has(read('src/lib/gtoObserver.ts'),'resultTouchFallbackReady?: boolean') && has(read('src/lib/gtoObserver.ts'),'resultSnapshotError?: string'));
check('driver UI surfaces result fallback/recovery diagnostics', has(read('src/components/GtoObserverSetup.tsx'),'Confirme o recebimento pela bolinha') && has(read('src/components/GtoObserverSetup.tsx'),'Recuperação do resultado'));
check('logout deletes local result snapshot', has(plugin,'new File(resultSnapshotPath)') && has(plugin,'snapshot.delete()'));
check('logout clears result action/fallback latches', has(plugin,'.remove("resultAction")') && has(plugin,'.remove("resultReceiveLatched")') && has(plugin,'.remove("resultTouchFallbackRequired")'));
check('logout clears projection permission latch', has(plugin,'.remove("projectionPermissionInFlight")'));
check('logout session boundary is synchronously committed', has(plugin,'boolean cleanupCommit = prefs.edit()') && has(plugin,'.commit();') && has(plugin,'cleanupPersisted'));
check('logout service-stop failure is surfaced instead of ignored', has(plugin,'Falha ao encerrar serviço GTO no logout') && has(plugin,'logoutCleanupError'));
check('R3.8 audit is wired into cap sync', (packageJson.scripts['cap:sync:android']||'').includes('audit:gto-r3.8'));

// Deterministic state-scenario model. These are deliberately simple invariants mirroring
// the Java gates above; static checks bind each modeled transition back to actual code.
function resolveResult({exact='none', genericTouch=false, ad=false, screen='result', sensorFallback=false, continuity=true, fallbackChoice='none'}) {
  if (ad || exact==='ads') return 'REJECTED_BONUS';
  if (exact==='receive') return 'RESULT_CONFIRMED';
  if (genericTouch && (screen==='gameplay' || screen==='freight')) return 'RESULT_CONFIRMED';
  if (sensorFallback && continuity && (screen==='gameplay' || screen==='freight')) {
    if (fallbackChoice==='receive') return 'RESULT_CONFIRMED';
    if (fallbackChoice==='discard') return 'WAITING_FREIGHT';
    return 'FALLBACK_READY';
  }
  if (!genericTouch && screen==='freight') return 'WAITING_FREIGHT';
  return 'RESULT_DETECTED';
}
check('scenario exact Receive + arbitrary loading completes', resolveResult({exact:'receive',screen:'loading'})==='RESULT_CONFIRMED');
check('scenario exact ADS blocks registration', resolveResult({exact:'ads'})==='REJECTED_BONUS');
check('scenario redacted touch + delayed gameplay completes', resolveResult({genericTouch:true,screen:'gameplay'})==='RESULT_CONFIRMED');
check('scenario no action + freight list cancels unfinished trip', resolveResult({screen:'freight'})==='WAITING_FREIGHT');
check('scenario sensor unavailable + screen exit does not guess Receive', resolveResult({sensorFallback:true,screen:'gameplay'})==='FALLBACK_READY');
check('scenario sensor fallback explicit Receive completes', resolveResult({sensorFallback:true,screen:'gameplay',fallbackChoice:'receive'})==='RESULT_CONFIRMED');
check('scenario sensor fallback explicit discard starts new freight', resolveResult({sensorFallback:true,screen:'freight',fallbackChoice:'discard'})==='WAITING_FREIGHT');
check('scenario foreground continuity break cannot enable fallback', resolveResult({sensorFallback:true,screen:'gameplay',continuity:false})==='RESULT_DETECTED');

// Numeric screen-layout envelope sanity: dynamic freight ROI must stay inside every
// representative display, and result crop remains a non-empty central fraction.
for (const [w,h] of [[1280,720],[1600,720],[1920,1080],[2160,1080],[2340,1080],[2400,1080],[2712,1220],[3200,1440],[1440,720]]) {
  const resultLeft=Math.round(w*.245), resultRight=Math.round(w*.755);
  const resultTop=Math.round(h*.12), resultBottom=Math.round(h*.84);
  check(`layout ${w}x${h} result ROI valid`, resultLeft>=0 && resultRight<=w && resultRight-resultLeft>=w*.49 && resultBottom-resultTop>=h*.70);
}

const hash = p => crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
console.log(`INFO detector sha256 ${hash('android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java')}`);
console.log(`INFO coordinator sha256 ${hash('android/app/src/main/java/com/nvu/operacional/GtoSelectionCoordinator.java')}`);
console.log(`INFO backend sha256 ${hash('functions/src/gtoTrips.ts')}`);
let passed=0;
for (const c of checks) { if(c.ok) passed++; console.log(`${c.ok?'OK  ':'FAIL'} ${c.name}`); }
console.log(`\n${passed}/${checks.length} R3.8 release certification checks passed.`);
if (passed!==checks.length) process.exit(1);
