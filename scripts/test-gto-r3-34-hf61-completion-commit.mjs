import fs from 'node:fs';
import crypto from 'node:crypto';

const read = p => fs.readFileSync(p, 'utf8');
const sha256 = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const pkg = JSON.parse(read('package.json'));
const gradle = read('android/app/build.gradle');
const workflow = read('.github/workflows/build-android-release.yml');
const service = read('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java');
const sync = read('android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java');
const flow = read('android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java');

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
ck('HF61 Android baseline identity preserved or advanced', versionCode >= 113 && versionName === `1.0.${versionCode}`);
ck('HF61 workflow remains aligned to current Android identity', workflow.includes(`EXPECTED_VERSION_CODE: "${versionCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${versionName}"`) && workflow.includes(`grep -Fq 'versionCode ${versionCode}' android/app/build.gradle`) && workflow.includes(`grep -Fq 'versionName \"${versionName}\"' android/app/build.gradle`));
ck('HF61 release artifact lineage preserved', /NVU-R3\.34-PC-HF\d+-release\.apk/.test(workflow));
ck('HF61 release gate is mandatory', String(pkg.scripts?.['verify:release'] || '').includes('npm run test:gto-r3.34-hf61-completion-commit'));

// HF149 changes registerGtoTrip intentionally; the dedicated HF59 gate checks
// source/compiled parity and this gate checks the canonical route rule.
const registerSource = read('functions/src/gtoTrips.ts');
ck('HF149 registerGtoTrip server uses certified Origin', registerSource.includes('const effectiveOrigin = origin;') && registerSource.includes('GTO_CERTIFIED_ORIGIN'));
ck('HF58 syncGtoTripState server remains byte-identical', sha256('functions/src/gtoState.ts') === 'f15301283ea37774deef756498a655a0018be17474254dcfc09485efdcfbc836');

const result = section('if (resultScreen != null) {', 'if (isResultTrackingState(getTripState()) && !manualFinishCapturePending)');
const confirm = section('private void confirmNormalResultAutomatically()', 'private GtoAutoTripSync.Listener automaticTripSyncListener()');
const failsafe = section('private void resolveCertifiedResultTerminalFailsafe(String expectedSession)', 'private boolean hasCertifiedTerminalCompletionAuthority');
const bonus = section('if (containsBonusVideo(normalized)) {', 'ResultScreen resultScreen =');
const postResult = section('if ((STATE_RESULT_DETECTED.equals(stateAfterResult)', 'if (!STATE_WAITING_FREIGHT.equals(getTripState()))');
const replacement = section('private boolean sealCertifiedResultForReplacementBoundary', 'private boolean startWaitingFreightSessionAfterSealedResult');
const clear = section('private boolean clearTripAnalysis()', 'private void openOperationalPanel()');

ck('Concluido synchronously latches terminal commit by session', result.includes('.putBoolean("resultTerminalCommitLatched", true)') && result.includes('.putString("resultTerminalCommitSessionId", prefs.getString("gtoTripSessionId", ""))') && result.includes('.putLong("resultTerminalCommitAt", resultScreenLastSeenAt)'));
ck('Concluido synchronously arms automatic completion', result.includes('.putBoolean("resultAutoCompletionLatched", true)') && result.includes('.putString("resultActionSource", "certified-result-terminal-commit")'));
ck('terminal commit auto-finalize is not blocked by stale foreground', service.includes('if ((screenAnalysisPausedOutsideGto || !gtoForeground) && !terminalCommit) return;'));
ck('certified result no longer requires post-result ADS guard', result.includes('boolean adsGuardRequired = false'));
ck('first compatible amount on certified result is frozen immediately', result.includes('latchCertifiedTerminalResultValue(resultScreen.value, "certified-result-screen")') && service.includes('CONFIRMED_CERTIFIED_TERMINAL'));
ck('legacy two-read consensus still exists for uncertain paths', service.includes('observeResultValueCandidate(') && read('android/app/src/main/java/com/nvu/operacional/GtoResultValueConsensus.java').includes('bestCount >= 2'));

ck('post-terminal watched-ad OCR is neutral', bonus.includes('POST_TERMINAL_AD_IGNORED') && postResult.includes('POST_TERMINAL_WATCHED_AD_IGNORED'));
ck('post-terminal touch cannot mutate result action', service.includes('private boolean resultActionCanBeObserved(String state) {\n        if (isTerminalCompletionCommittedForCurrentSession()) return false;'));
ck('normal confirmation ignores ad marker only after terminal commit', confirm.includes('(watchedAdEvidence && !terminalCommit)') && confirm.includes('boolean terminalCommit = isTerminalCompletionCommittedForCurrentSession()'));
ck('terminal failsafe bypasses legacy ADS waits only after terminal commit', failsafe.includes('if (!terminalCommit) {') && failsafe.includes('WAITING_AD_UI_CLEAR') && failsafe.includes('WAITING_BOUNDED_ADS_WINDOW'));
ck('restart recovery recognizes terminal commit despite stale later ad marker', service.includes('boolean restoredTerminalCommit') && service.includes('(restoredTerminalCommit || !prefs.getBoolean("resultWatchedAdEvidence", false))'));

ck('new certified freight list can seal committed previous result', replacement.includes('watchedAd && !terminalCommit') && replacement.includes('!terminalCommit') && replacement.includes('shouldSealAtCertifiedFreightBoundary'));
ck('RESULT_CONFIRMED can observe a real new list without backend ACK only when old session is terminal+queued', service.includes('if (isSealedTerminalResultBoundary(state)) return true;') && service.includes('STATE_RESULT_CONFIRMED.equals(state)') && service.includes('GtoAutoTripSync.hasPendingSession(this, sessionId)'));
ck('stable certified new list is a post-commit lifecycle boundary', service.includes('boolean sealedTerminalNewList = isSealedTerminalResultBoundary(activeState)') && service.includes('freightBoundaryVisibleMs >= ACTIVE_TRIP_FREIGHT_LIST_CONFIRM_MS'));
ck('already queued completed session is preserved when next list takes over', service.includes('boolean alreadySealedTerminalBoundary = isSealedTerminalResultBoundary(replacedState);') && service.includes('boolean sealedCompletedResultBoundary = alreadySealedTerminalBoundary') && service.includes('if (!sealedCompletedResultBoundary) {\n            GtoAutoTripSync.discardSessionSnapshot'));
ck('new session is only prepared as WAITING_FREIGHT', service.includes('setTripState(STATE_WAITING_FREIGHT,\n            "Nova lista certificada assumiu o fluxo; entrega anterior segue em envio")'));
ck('WAITING_FREIGHT cannot interpret result screen as another trip', (() => { const a=flow.indexOf('static boolean mayInterpretResultScreen'); const b=flow.indexOf('static boolean mayInterpretBonusOrAds', a); const body=a>=0&&b>a?flow.slice(a,b):''; return body.includes('TRIP_IN_PROGRESS') && !body.includes('WAITING_FREIGHT'); })());
ck('completed queue is keyed idempotently by session id before network', sync.includes('putString(QUEUE_PREFIX + sessionId, sealed).commit()') && sync.includes('IN_FLIGHT.add(sessionId)'));
ck('terminal fields are cleared only with trip/session reset', clear.includes('.remove("resultTerminalCommitLatched")') && clear.includes('.remove("resultTerminalCommitSessionId")') && clear.includes('.remove("resultTerminalCommitAt")'));

ck('HF59 retry protections remain', sync.includes('shouldPauseAutomaticRetry') && sync.includes('BASE_RETRY_MS = 15_000L') && sync.includes('MAX_RETRY_MS = 5 * 60_000L'));
ck('HF58 canonical cost backoff remains', service.includes('CANONICAL_SYNC_BASE_RETRY_MS = 15_000L') && service.includes('CANONICAL_SYNC_MAX_RETRY_MS = 5L * 60_000L'));
ck('HF57 instant message and pluralization remain', service.includes('FAST_FREIGHT_MESSAGE_CONFIRM_FRAMES = 2') && service.includes('safeCount == 1 ? " opção" : " opções"') && !service.includes('opçãoões'));
ck('ML Kit remains local OCR path', service.includes('TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)'));

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF61 Completion Commit checks passed.`);
if (failed.length) process.exit(1);
