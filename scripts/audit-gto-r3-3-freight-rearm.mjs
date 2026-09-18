import fs from 'node:fs';
import crypto from 'node:crypto';

const service = fs.readFileSync('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java', 'utf8');
const fast = fs.readFileSync('android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java');
const coordinator = fs.readFileSync('android/app/src/main/java/com/nvu/operacional/GtoSelectionCoordinator.java');
const gradle = fs.readFileSync('android/app/build.gradle', 'utf8');
const simple = fs.readFileSync('android/app/src/main/java/com/nvu/operacional/GtoSimpleScreenDetectionPolicy.java', 'utf8');
const backend = fs.readFileSync('functions/src/gtoTrips.ts');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const WORKING_FAST = '069c51986dd6bdf58e2b8d12d1fdcb9862f35c3b24f27c30613241a6fe8ecbfd';
const WORKING_COORD = 'd84fe0848f5a054225cf939786156c07a291a4eb74a362ca9f72878d920b0ddd';

const checks = [
  ['working freight detector preserves OCR-free selection contract', fast.toString('utf8').includes('PressCandidate') && fast.toString('utf8').includes('detectButtons') && !fast.toString('utf8').includes('TextRecognizer')],
  ['working selection coordinator remains byte-identical', sha(coordinator) === WORKING_COORD],
  ['returned jobs list creates a replacement candidate only through the list-observation path', service.includes('replacementFreightCandidateArmed') && service.includes('armOrRefreshReplacementFreightCandidate(image, frame, now)') && service.includes('handleActiveTripFreightListEvidence')],
  ['touch pulse sensor observes a replacement candidate without bypassing state policy', service.includes('replacementSelectionArmed = replacementFreightCandidateArmed') && service.includes('replacementFreightSemanticRejectedAt <= 0L') && service.includes('mayHandleCertifiedFreightBoundary(state)')],
  ['touch/list promotion is guarded by stable returned-list or exact new-Accept evidence', /promoteReplacementFreightCandidateToWaiting[\s\S]{0,2200}stableReturnedList[\s\S]{0,600}exactNewAccept[\s\S]{0,500}return false/.test(service)],
  ['single permissive frame cannot cancel a real route', simple.includes('observedFrames >= 2') && simple.includes('visibleForMs >= 55L') && service.includes('activeTripFreightListFrames >= ACTIVE_TRIP_FREIGHT_LIST_CONFIRM_FRAMES')],
  ['pending fast touch still requires a captured jobs-list candidate and guarded promotion', service.includes('replacementFreightTouchPending') && service.includes('replacementFreightCandidateArmed') && service.includes('promoteReplacementFreightCandidateToWaiting(')],
  ['pre-touch freight page is frozen before state replacement', service.includes('captureReplacementFreightPanel(image, frame)') && service.includes('replacementFreightPanelFrame')],
  ['candidate survives short list-close race until touch marker arrives', service.includes('CRITICAL_TOUCH_WINDOW_MS + 260L')],
  ['page navigation refreshes replacement baseline instead of mixing pages', service.includes('!fastVisualDetector.samePage(replacementFreightBaseline, frame)')],
  ['pressed row can be recovered before stale route promotion', service.includes('replacementFreightPressedRow = pressed.row')],
  ['old unfinished session is explicitly discarded', service.includes('GtoAutoTripSync.discardSessionSnapshot(this, cancelledSessionId)')],
  ['new session is created before selected freight is committed', service.includes('beginTrip(false);') && service.includes('STATE_WAITING_FREIGHT.equals(getTripState())')],
  ['pre-touch panel and button geometry are restored into new session', service.includes('latestFreightPanelFrame = savedPanel') && service.includes('realtimeAcceptRects.add(new Rect(rect))')],
  ['selection coordinator receives restored baseline sequence', service.includes('long baselineSequence = selectionCoordinator.onFrameProcessed()') && service.includes('recordFastFreightFrame(savedBaseline, baselineSequence)')],
  ['new page OCR is scheduled after replacement session is armed', service.includes('scheduleFreightPageOcr(') && service.includes('freightPageGeneration, savedPanel, savedOffset, savedButtons')],
  ['active route treats only a semantically certified real jobs list as the canonical cancellation boundary without a manual arm', service.includes('handleActiveTripFreightListEvidence') && service.includes('FREIGHT_LIST_REOPENED_CERTIFIED') && service.includes('GtoFreightSemanticCertificationPolicy.isCertifiedLifecycleBoundaryPage') && service.includes('GtoSimpleScreenDetectionPolicy.isCertifiedFreightListReturn') && service.includes('isReplacementFreightSemanticFresh') && service.includes('GtoFreightLifecycleBoundaryPolicy.mayReplaceCurrentContext') && !service.includes('isExplicitFreightReplacementActive')],
  ['completed delivery remains outside replacement cancellation path', (() => { const a=service.indexOf('private boolean isReplaceableActiveSessionState'); const b=service.indexOf('private boolean hasRecentNormalResultActionEvidence', a); return a>=0 && b>a && !service.slice(a,b).includes('STATE_RESULT_CONFIRMED'); })()],
  ['automatic result flow remains present', service.includes('confirmNormalResultAutomatically()') && service.includes('GtoTripSubmissionCoordinator.submitCompletedTrip')],
  ['R3.2 semantic-only fallback remains present', service.includes('hasPartialResultSemanticEvidence(normalized)')],
  ['Android version remains at or above R3.3 baseline', (() => {
    const code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
    const name = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || '';
    return code >= 23 && /^1\.0\.(?:2[3-9]|[3-9]\d|\d{3,})$/.test(name);
  })()],
];

for (const [name, ok] of checks) console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
console.log(`INFO freight detector sha256 ${sha(fast)}`);
console.log(`INFO selection coordinator sha256 ${sha(coordinator)}`);
console.log(`INFO backend gtoTrips sha256 ${sha(backend)}`);
const failed = checks.filter(([, ok]) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} R3.3 freight re-arm checks passed.`);
if (failed.length) process.exit(1);
