import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const service = read('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java');
const sync = read('android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java');
const recovery = read('android/app/src/main/java/com/nvu/operacional/GtoSessionRecoveryPolicy.java');
const plugin = read('android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java');
const main = read('android/app/src/main/java/com/nvu/operacional/MainActivity.java');
const bridge = read('src/lib/gtoObserver.ts');
const recordTrip = read('src/pages/driver/RecordTrip.tsx');
const launcher = read('src/services/gtoWorkLauncher.ts');
const jobStatus = read('src/lib/jobStatus.ts');
const appContext = read('src/context/AppContext.tsx');
const backend = read('functions/src/gtoTrips.ts');
const gradle = read('android/app/build.gradle');
const pkg = JSON.parse(read('package.json'));
const checks = [];
const check = (name, ok) => { checks.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`); };

check('temporary GTO exit pauses analysis and preserves the exact trip state', service.includes('pauseScreenAnalysisOutsideGto') && service.includes('tripStateWhenAnalysisPaused = getTripState()') && service.includes('resumeScreenAnalysisInSameState') && service.includes('Returning to GTO is never a journey transition'));
check('active session age is diagnostic only and cannot discard a durable snapshot', service.includes('ACTIVE_SESSION_STALE_MS') && recovery.includes('return hasRecoverableSnapshot') && service.includes('LONG_RUNNING_SESSION'));
check('process restart recovers active trip snapshot', service.includes('recoverActiveTrip') && sync.includes('hasRecoverableSessionSnapshot'));
check('unconfirmed freight candidate falls back safely after process death', recovery.includes('return confirmedReview ? "CONFIRMING_FREIGHT" : "WAITING_FREIGHT"'));
check('confirmed REVIEW_REQUIRED freight survives process death', service.includes('GtoSessionRecoveryPolicy.restoredState') && recovery.includes('"REVIEW_REQUIRED".equals(selectionConfirmationStatus)'));
check('recovered trip exposes screen authorization action inside NVU menu', service.includes('Autorizar leitura da tela') && service.includes('projectionReauthRequired'));
check('new trip does not wait for previous completed delivery ACK', !service.includes('Aguarde a confirmação da entrega anterior')
  && service.includes('prepareFreshSessionAfterOperationSwitch')
  && service.includes('GtoTripSubmissionCoordinator.submitCompletedTrip(this, prefs')
  && service.includes('clearTripAnalysis()'));
check('new trip is blocked after operation completion', service.includes('isOperationClosedForNewTrip') && sync.includes('gtoBackendJobClosed'));
check('backend ACK persists job progress/status', sync.includes('response.get("progress")') && sync.includes('response.get("jobStatus")'));
check('Global Truck alias aligned in backend', backend.includes('normalized === "global-truck"'));
check('delayed jobs accepted by current GTO launcher when deliveries remain', launcher.includes('isTripRecordableJobStatus') && jobStatus.includes('hasRemainingDeliveries') && jobStatus.includes('"active"') && jobStatus.includes('"delayed"'));
check('job status/progress sent to native observer', recordTrip.includes('jobStatus: activeJob.status') && recordTrip.includes('jobProgress: activeJob.progress') && recordTrip.includes('jobTotalDeliveries: activeContract.totalDeliveries') && launcher.includes('const runtimeContext: GtoObserverContext') && launcher.includes('GtoObserver.setContext(runtimeContext)') && launcher.includes('buildGtoOperationContext(context)') && launcher.includes('GTO_WEB_RUNTIME_REVISION'));
check('native plugin persists job status/progress', (plugin.includes('.putString("jobStatus"') || plugin.includes('putStringIfPresent(editor, call, "jobStatus"')) && (plugin.includes('.putInt("jobTotalDeliveries"') || plugin.includes('putIntIfPresent(editor, call, "jobTotalDeliveries"')));
check('menu overlay failures are diagnosable', service.includes('menuOverlayError') && plugin.includes('menuOverlayError'));
check('status overlay failures are diagnosable', service.includes('statusOverlayError') && plugin.includes('statusOverlayError'));
check('logout clears native GTO session', plugin.includes('public void logoutCleanup') && bridge.includes('logoutCleanup()'));
check('logout does not start an idle GTO service just to stop it', plugin.includes('if (GtoObserverService.isRunning())'));
check('logout signs out native Firebase auth', appContext.includes('signOutNativeGoogleIfAvailable()'));
check('pending queue retries when NVU activity opens', main.includes('GtoTripSubmissionCoordinator.flushPending'));
check('future Android bundle source accepts delayed jobs when deliveries remain', launcher.includes('isTripRecordableJobStatus') && jobStatus.includes('hasRemainingDeliveries'));
check('future Android bundle source carries job completion data', recordTrip.includes('jobTotalDeliveries: activeContract.totalDeliveries'));
check('future Android bundle source invokes native logout cleanup', appContext.includes('GtoObserver.logoutCleanup()') && appContext.includes('signOutNativeGoogleIfAvailable()'));
check('Capacitor package excludes server runtime assets', !fs.existsSync('android/app/src/main/assets/public/server.cjs') && !fs.existsSync('android/app/src/main/assets/public/server.cjs.map'));
check('future Capacitor sync removes server runtime assets', pkg.scripts?.['prepare:cap-assets']?.includes('prepare-capacitor-assets.mjs'));
check('Android versionCode advanced from 1', /versionCode\s+(?:[2-9]|[1-9]\d+)/.test(gradle));
check('machine-specific android/local.properties excluded', !fs.existsSync('android/local.properties'));

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} R2 lifecycle checks passed.`);
if (failed.length) process.exit(1);
