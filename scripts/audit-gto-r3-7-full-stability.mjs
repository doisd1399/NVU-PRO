import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const service = read('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java');
const plugin = read('android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java');
const permission = read('android/app/src/main/java/com/nvu/operacional/GtoProjectionPermissionActivity.java');
const detector = read('android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const gradle = read('android/app/build.gradle');
const vars = read('android/variables.gradle');
const capConfig = read('capacitor.config.ts');
const buildManifest = read('dist/nvu-build.json');
const packageJson = JSON.parse(read('package.json'));
const runtimeMode = String(packageJson.capacitorRuntime || '');
const gtoTs = read('src/lib/gtoObserver.ts');
const setupTsx = read('src/components/GtoObserverSetup.tsx');
const backup = read('android/app/src/main/res/xml/backup_rules.xml');
const extraction = read('android/app/src/main/res/xml/data_extraction_rules.xml');
const resultActionFlow = read('android/app/src/main/java/com/nvu/operacional/GtoResultActionFlowPolicy.java');

const checks = [];
const check = (name, condition) => checks.push({name, ok: !!condition});
const has = (text, token) => text.includes(token);

check('release version remains at or above R3.7 baseline', Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0) >= 27 && Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/) || [])[1] || 0) >= 27);
check('production APK uses the declared Web runtime mode',
  runtimeMode === 'remote'
    ? /server\s*:\s*loadRemoteServer\(\)/.test(capConfig)
      && /webDir\s*:\s*["']dist["']/.test(capConfig)
      && /"capacitorRuntime"\s*:\s*"remote"/.test(buildManifest)
    : runtimeMode === 'local'
      && !/server\s*:/.test(capConfig)
      && /webDir\s*:\s*["']dist["']/.test(capConfig)
      && /"capacitorRuntime"\s*:\s*"local"/.test(buildManifest));
check('minSdk remains Android 7 / API 24', has(vars, 'minSdkVersion = 24'));
check('target/compile SDK remain API 36', has(vars, 'compileSdkVersion = 36') && has(vars, 'targetSdkVersion = 36'));
check('legacy API24-25 overlay path retained', has(service, 'return WindowManager.LayoutParams.TYPE_PHONE'));
check('API26+ application overlay path retained', has(service, 'TYPE_APPLICATION_OVERLAY'));
check('usage events support pre-29 foreground events', has(service, 'UsageEvents.Event.MOVE_TO_FOREGROUND'));
check('usage events support API29+ activity resumed', has(service, 'UsageEvents.Event.ACTIVITY_RESUMED'));
check('media projection default-display path retained on Android14+', has(permission, 'MediaProjectionConfig.createConfigForDefaultDisplay()'));
check('foreground service types declared', has(manifest, 'specialUse|mediaProjection'));

check('GTO runtime prefs excluded from legacy backup', has(backup, 'nvu_gto_observer.xml') && has(backup, 'nvu_gto_trip_snapshot_v2.xml'));
check('GTO queue excluded from legacy backup', has(backup, 'nvu_gto_auto_trip_queue_v1.xml'));
check('GTO runtime prefs excluded from Android12+ cloud backup', has(extraction, '<cloud-backup>') && has(extraction, 'nvu_gto_observer.xml'));
check('GTO runtime prefs excluded from Android12+ device transfer', has(extraction, '<device-transfer>') && has(extraction, 'nvu_gto_observer.xml'));
check('manifest binds both backup rule generations', has(manifest, 'android:fullBackupContent="@xml/backup_rules"') && has(manifest, 'android:dataExtractionRules="@xml/data_extraction_rules"'));

check('projection callbacks are generation-bound', has(service, 'private long projectionGeneration = 0L') && has(service, 'generation != projectionGeneration || mediaProjection != projection'));
check('stale projection onStop cannot release new capture', has(service, 'Never let that stale callback') && has(service, 'if (generation != projectionGeneration || mediaProjection != projection) return;'));
check('manual projection stop invalidates callbacks first', has(service, 'projectionGeneration++;') && has(service, 'Invalidate callbacks before calling MediaProjection.stop()'));
check('system projection stop requests explicit reauthorization', has(service, 'putBoolean("projectionReauthRequired", true)') && has(service, 'Leitura da tela foi encerrada pelo Android'));
check('projection reauthorization is visible to driver', has(service, 'maybeNotifyProjectionReauthorization()') && has(service, 'autorize novamente'));
check('passive touch observer is scoped to enabled GTO foreground even across projection rebinds', has(service, 'GtoResultActionFlowPolicy.keepPassiveTransportObserver')
  && has(resultActionFlow, 'return observeEnabled && gtoForeground && overlayAllowed'));
check('permission activity reports missing MediaProjectionManager', has(permission, 'MANAGER_UNAVAILABLE') && has(permission, 'MediaProjectionManager indisponível'));
check('permission activity reports consent launch failure', has(permission, 'CONSENT_LAUNCH_FAILED'));

check('runtime overlay revocation is detected', has(service, 'OVERLAY_REVOKED'));
check('runtime usage-access revocation is detected', has(service, 'USAGE_ACCESS_REVOKED'));
check('runtime permission failure hides stale overlays', has(service, 'validateObserverRuntimePermissions()')
  && (has(service, 'hideTransientOverlaysKeepBubble();') || has(service, 'removeAllOverlays();')));
check('runtime permission failure is exposed via plugin', has(plugin, 'runtimePermissionError') && has(plugin, 'runtimePermissionErrorCode'));
check('runtime permission failure is visible in web diagnostics', has(setupTsx, 'Permissões:') && has(gtoTs, 'runtimePermissionError?: string'));
check('projection failures are exposed in web diagnostics', has(gtoTs, 'projectionError?: string') && has(setupTsx, 'Captura:'));
check('menu overlay failures are visible in web diagnostics', has(setupTsx, 'Painel flutuante:') && has(gtoTs, 'menuOverlayError?: string'));
check('status overlay failures are visible in web diagnostics', has(setupTsx, 'Avisos flutuantes:') && has(gtoTs, 'statusOverlayError?: string'));
check('touch sensor fallback is visible in web diagnostics', has(setupTsx, 'Sensor de seleção:') && has(gtoTs, 'touchPulseSensorError?: string'));
check('freight conflicts are visible instead of silently accepted', has(setupTsx, 'leitura conflitante bloqueada') && has(gtoTs, 'lastFreightConflict?: string'));
check('sync errors are visible in observer diagnostics', has(setupTsx, 'Envio:') && has(gtoTs, 'gtoTripSyncError?: string'));
check('integrity errors are visible in observer diagnostics', has(setupTsx, 'Integridade:') && has(gtoTs, 'gtoTripIntegrityError?: string'));

check('transient system UI foreground is tracked', has(service, 'boolean sawTransientForeground = false'));
check('transient system UI cannot clear GTO ownership', has(service, 'else if (!sawTransientForeground'));
check('detached bubble self-healing remains enabled', has(service, '!bubbleView.isAttachedToWindow()') && has(service, 'restaurando'));
check('bubble drag failures are no longer silent', has(service, 'recordOverlayFailure(ex);') && has(service, 'windowManager.updateViewLayout(bubbleView, bubbleParams)'));
check('bubble addView failures remain diagnosed', has(service, 'recordOverlayFailure(ex);'));
check('bubble ACTION_UP cannot dereference failed drag LayoutParams', has(service, 'if (bubbleParams != null)') && has(service, 'bubbleView == null && gtoForeground'));
check('failed bubble drag schedules self-heal', has(service, 'mainHandler.postDelayed(this::showBubbleIfAllowed, 220L)'));

check('freight detector supports the current wider adaptive horizontal bands',
  has(detector, '{0.750f, 0.900f}') && has(detector, '{0.670f, 0.850f}')
    && has(detector, 'refineButtonHorizontalBounds'));
check('freight frame validation matches current adaptive detector min height', has(detector, 'screenHeight * 0.014f'));
check('freight frame validation matches current adaptive detector max height', has(detector, 'screenHeight * 0.160f'));
check('freight frame validation matches current adaptive detector gaps', has(detector, 'screenHeight * 0.060f') && has(detector, 'screenHeight * 0.320f'));
check('single freight scale envelope is aligned with current GTO layout', has(detector, 'screenHeight * 0.32f'));
check('adaptive OCR panel follows detected button column', has(service, 'freightOcrLeftForCurrentLayout') && has(service, 'freightPanelLeftForButtons'));
check('freight conflict is fail-closed instead of guessing', has(service, 'lastFreightConflict') && has(service, 'Frete não confirmado'));
check('page generation isolation remains present', has(service, 'freightPageGeneration'));

check('exact Receive latch has no timeout', has(service, 'putBoolean("resultReceiveLatched", true)') && has(service, 'The exact Receber action is durable') && !has(service, 'RESULT_ACTION_EVIDENCE_MS'));
check('exact ADS remains isolated from Receive', has(service, 'latchExactAdsTouch') && has(service, 'VERIFYING_AD_BONUS'));
check('late OCR cannot downgrade Receive latch', has(service, 'receiveAlreadyLatched') && has(service, 'A late OCR callback must never downgrade'));
check('persisted capture OCR can recover and revalidate final result value',
  has(service, 'recoverResultValueFromSnapshotAsync()')
    && has(service, 'extractResultValueFromRawOcr')
    && has(service, 'observeResultValueCandidate'));
check('completion state advances only after synchronous persistence succeeds', service.indexOf('if (!completionPersisted)') < service.indexOf('setTripState(STATE_RESULT_CONFIRMED'));
check('failed local completion persistence retains Receive state', has(service, 'Receber permanece bloqueado para retry'));
check('Firebase sync watchdog remains active', has(read('android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java'), 'CALL_WATCHDOG_MS = 25_000L'));
check('Firebase timeout returns queue to pending retry', has(read('android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java'), 'CALL_TIMEOUT'));
check('shared-device UID mismatch is surfaced', has(read('android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java'), 'DRIVER_UID_MISMATCH'));
check('completed queue is removed only after backend ACK', has(read('android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java'), 'queue.edit().remove(key).commit()'));

check('cold-start observer confirmation waits beyond 320ms', Number((plugin.match(/started \|\| attempt >= (\d+)/) || [])[1] || 0) >= 10 && has(plugin, 'resolveObserverStart(call, 0)'));
check('observer recovery polls health on slower devices', has(plugin, 'resolveObserverRecovery(call, 0)') && Number((plugin.match(/observerHealthy"\)\) \|\| attempt >= (\d+)/) || [])[1] || 0) >= 7);
check('MainActivity onStart visibility is public for Capacitor 8', has(read('android/app/src/main/java/com/nvu/operacional/MainActivity.java'), 'public void onStart()'));

let passed = 0;
for (const c of checks) {
  if (c.ok) passed++;
  console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name}`);
}
console.log(`\n${passed}/${checks.length} R3.7 full stability checks passed.`);
if (passed !== checks.length) process.exit(1);
