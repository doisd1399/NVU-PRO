import fs from 'node:fs';
import crypto from 'node:crypto';

const read = p => fs.readFileSync(p, 'utf8');
const sha256 = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const pkg = JSON.parse(read('package.json'));
const gradle = read('android/app/build.gradle');
const workflow = read('.github/workflows/build-android-release.yml');
const service = read('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java');
const voiceVerifier = read('scripts/verify-hf60-voice-apk.py');

const checks = [];
const ck = (name, ok) => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
};
const section = (start, end) => {
  const a = service.indexOf(start);
  const b = service.indexOf(end, Math.max(0, a + start.length));
  return a >= 0 && b > a ? service.slice(a, b) : '';
};

const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || '';
const versionTail = Number((versionName.match(/^1\.0\.(\d+)$/) || [])[1] || 0);
ck('HF60+ Android identity', versionCode >= 112 && versionTail >= 112);
ck('HF60+ workflow identity follows Android source', workflow.includes(`EXPECTED_VERSION_CODE: "${versionCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${versionName}"`));
const artifactHotfix = Number((workflow.match(/NVU-R3\.34-PC-HF(\d+)-release\.apk/) || [])[1] || 0);
ck('HF60+ release artifact identity', artifactHotfix >= 60);
ck('HF60 release gate is mandatory', String(pkg.scripts?.['verify:release'] || '').includes('npm run test:gto-r3.34-hf60-terminal-safe'));

// HF149 changes registerGtoTrip intentionally: the certified route Origin is now
// authoritative and source/compiled parity is checked by the dedicated HF59 gate.
const registerSource = read('functions/src/gtoTrips.ts');
ck('HF149 registerGtoTrip server uses certified Origin', registerSource.includes('const effectiveOrigin = origin;') && registerSource.includes('GTO_CERTIFIED_ORIGIN'));
ck('HF58 syncGtoTripState server remains byte-identical', sha256('functions/src/gtoState.ts') === 'f15301283ea37774deef756498a655a0018be17474254dcfc09485efdcfbc836');

const resolver = section('private void resolveCertifiedResultExitFromFrames(long generation)', 'private void latchCertifiedResultExitAndSend');
const failsafe = section('private void resolveCertifiedResultTerminalFailsafe(String expectedSession)', 'private boolean hasCertifiedTerminalCompletionAuthority');
const confirm = section('private void confirmNormalResultAutomatically()', 'private GtoAutoTripSync.Listener automaticTripSyncListener()');
const queueArm = section('private void armCompletionQueueSealRecovery(String sessionId, long now)', 'private void recoverUnsealedCompletedTripIfNeeded');
const startup = section('if (recoverCompletedTrip) {', '    @Override\n    public int onStartCommand');

ck('certified terminal failsafe has bounded initial deadline', service.includes('CERTIFIED_TERMINAL_FAILSAFE_DELAY_MS = 1_200L') && service.includes('CERTIFIED_TERMINAL_FAILSAFE_RETRY_MS = 1_200L'));
ck('result certification arms terminal failsafe', (service.match(/armCertifiedResultTerminalFailsafe\(/g) || []).length >= 3);
ck('process restart re-arms certified terminal failsafe', startup.includes('armCertifiedResultTerminalFailsafe(') && startup.includes('RECOVERED_CERTIFIED_RESULT'));
ck('frame resolver no longer hard-blocks on foreground', resolver.includes('boolean observerForeground = !screenAnalysisPausedOutsideGto && gtoForeground') && !resolver.includes('WAITING_GTO_FOREGROUND') && !resolver.includes('if (screenAnalysisPausedOutsideGto || !gtoForeground)'));
ck('safe certified exit resolves outside GTO after no-ad window', resolver.includes('RESOLVING_CERTIFIED_OUTSIDE_GTO') && resolver.includes('latchCertifiedResultExitAndSend(now, "frame-driven-certified-result-exit")'));

ck('terminal failsafe accepts only certified result states', failsafe.includes('STATE_RESULT_DETECTED.equals(state) || STATE_AWAITING_BONUS.equals(state)') && failsafe.includes('resultCertifiedLatched'));
ck('positive watched-ad evidence still vetoes normal completion', failsafe.includes('resultWatchedAdEvidence') && failsafe.includes('clearCertifiedResultTerminalFailsafe(sessionId)'));
ck('fresh ad UI still delays normal completion', failsafe.includes('AD_UI_CLEAR_GRACE_MS') && failsafe.includes('WAITING_AD_UI_CLEAR'));
ck('explicit ADS touch retains bounded 45s hold', failsafe.includes('ADS_ACTION_MAX_HOLD_MS') && failsafe.includes('WAITING_BOUNDED_ADS_WINDOW'));
ck('missing locked freight snapshot is recovered before finalization', failsafe.includes('hasRecoverableSessionSnapshot') && failsafe.includes('restoreLockedFreightToPrefs') && failsafe.includes('WAITING_LOCKED_FREIGHT_SNAPSHOT'));
ck('terminal failsafe persists automatic completion latch synchronously', failsafe.includes('putBoolean("resultAutoCompletionLatched", true)') && failsafe.includes('putString("resultActionSource", "certified-terminal-failsafe")') && failsafe.includes('.commit()'));
ck('terminal failsafe keeps retrying local completion until state advances', failsafe.includes('LOCAL_COMPLETION_RETRY') && failsafe.includes('rescheduleCertifiedResultTerminalFailsafe'));

ck('certified terminal authority bypasses stale foreground only after durable latch', confirm.includes('boolean terminalAuthority = hasCertifiedTerminalCompletionAuthority(currentState)') && confirm.includes('&& !terminalAuthority') && confirm.includes('TERMINAL_AUTHORITY_OUTSIDE_GTO'));
ck('terminal authority still requires certified proof and no watched ad', service.includes('private boolean hasCertifiedTerminalCompletionAuthority') && service.includes('resultCertifiedLatched') && service.includes('!prefs.getBoolean("resultWatchedAdEvidence", false)'));
ck('successful local completion clears terminal failsafe before RESULT_CONFIRMED', confirm.indexOf('clearCertifiedResultTerminalFailsafe') >= 0 && confirm.indexOf('clearCertifiedResultTerminalFailsafe') < confirm.indexOf('setTripState(STATE_RESULT_CONFIRMED'));

ck('queue-seal retry is scheduled independently of foreground polling', queueArm.includes('mainHandler.postDelayed(() ->') && queueArm.includes('recoverUnsealedCompletedTripIfNeeded(System.currentTimeMillis())') && !queueArm.includes('gtoForeground'));
ck('restart completion recovery arms queue watchdog if immediate sealing fails',
  startup.includes('boolean queued = GtoTripSubmissionCoordinator.submitCompletedTrip(this, prefs, automaticTripSyncListener());')
  && startup.includes('armCompletionQueueSealRecovery(recoveredSession'));
ck('driver receives non-stuck terminal safety message', service.includes('Viagem preservada ✓ · concluindo registro automaticamente…'));

ck('HF59 permanent retry protections remain', service.includes('CANONICAL_SYNC_BASE_RETRY_MS = 15_000L') && read('android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java').includes('shouldPauseAutomaticRetry'));
ck('ML Kit local OCR path remains untouched', service.includes('TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)'));
ck('HF57 instant message path remains untouched', service.includes('FAST_FREIGHT_MESSAGE_CONFIRM_FRAMES = 2') && service.includes('announceDriverStage("FREIGHT_LIST_VISUAL_PENDING"'));

ck('release voice verifier scans by approved bytes instead of fragile APK path', workflow.includes('python3 scripts/verify-hf60-voice-apk.py') && voiceVerifier.includes('info.file_size == spec["size"]') && voiceVerifier.includes('hashlib.sha256(data).hexdigest()'));
ck('release voice verifier pins both approved hashes', voiceVerifier.includes('b53a46523dbbe745ac0a9600637ffce7f1f9c34667c64b2b1730c0df32b60bf2') && voiceVerifier.includes('49c9c7fb8585b4385971cc3d19c59f8df0015e6e2c74ab1ae4bce7cd45fb7179'));

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF60 Terminal Safe checks passed.`);
if (failed.length) process.exit(1);
