import fs from 'node:fs';
import crypto from 'node:crypto';

const servicePath = 'android/app/src/main/java/com/nvu/operacional/GtoObserverService.java';
const syncPath = 'android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java';
const fastPath = 'android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java';
const coordPath = 'android/app/src/main/java/com/nvu/operacional/GtoSelectionCoordinator.java';
const gradlePath = 'android/app/build.gradle';
const service = fs.readFileSync(servicePath, 'utf8');
const sync = fs.readFileSync(syncPath, 'utf8');
const fast = fs.readFileSync(fastPath, 'utf8');
const coord = fs.readFileSync(coordPath, 'utf8');
const gradle = fs.readFileSync(gradlePath, 'utf8');
const checks = [];
const check = (name, ok) => checks.push([name, !!ok]);

check('R3.6+ versionCode >= 26', /versionCode\s+(?:2[6-9]|[3-9][0-9]|[1-9][0-9]{2,})\b/.test(gradle));
check('R3.6+ versionName >= 1.0.26', /versionName\s+"1\.0\.(?:2[6-9]|[3-9][0-9]|[1-9][0-9]{2,})"/.test(gradle));
check('Receive action has no temporal confirmation constant', !/RESULT_ACTION_CONFIRM_WINDOW_MS/.test(service));
check('result-screen action can be marked without last-seen expiry', /No expiry while the state machine is on the detected result/.test(service));
check('outside-touch coordinates attempt exact result-button resolution', /resolveResultActionOutsideTouch\(event\)/.test(service));
check('Receive and ADS are classified separately', /classifyResultButtonTouch/.test(service) && /if \(receive\) return 1;/.test(service) && /if \(ads\) return 2;/.test(service));
check('ambiguous result coordinates fail closed', /if \(receive && ads\) return 0;/.test(service));
check('exact Receive is durably latched', /putString\("resultAction", "RECEIVE"\)[\s\S]*putBoolean\("resultReceiveLatched", true\)/.test(service));
check('exact Receive immediately confirms and queues', /latchExactReceiveAndSend[\s\S]*confirmNormalResultAutomatically\(\);/.test(service));
check('exact ADS never latches normal Receive', /putString\("resultAction", "ADS"\)[\s\S]*putBoolean\("resultReceiveLatched", false\)/.test(service));
check('generic redacted touch remains durable pending action', /putString\("resultAction", "TOUCH_PENDING"\)/.test(service));
check('pending/Receive action evidence has no age comparison', /touchAt <= 0L\) return false;/.test(service) && !/touchAt > RESULT_ACTION_CONFIRM_WINDOW_MS/.test(service));
check('post-result return cannot confirm from HUD text; it needs certified result exit policy', !/directLegacyReturn/.test(service) && /shouldInferReceiveFromCertifiedExit/.test(service) && /resultDialogVisualAbsentFrames/.test(service));
check('ADS semantic evidence remains authoritative', /containsPostResultAdEvidence\(normalized\)/.test(service) && /STATE_REJECTED_BONUS/.test(service));
check('result value is restored before durable completion',
  /detectedResultValue = [\s\S]*GtoResultValueConsensus\.canonical\(prefs\.getString\("resultValueConsensusStable", ""\)\)/.test(service)
    && /resultValueConsensusVersion/.test(service));
check('missing restored result value fails closed', /RECEIVE_LATCHED_WAITING_VALUE/.test(service));
check('late OCR callback cannot overwrite confirmed completion', /stateAtResultCallback[\s\S]*STATE_RESULT_CONFIRMED[\s\S]*return;/.test(service));
check('exact Receive survives service/process restart', /recoverExactReceive[\s\S]*resultReceiveLatched[\s\S]*postDelayed\(this::confirmNormalResultAutomatically/.test(service));
check('Receive latch metadata clears before a new trip', /remove\("resultReceiveLatched"\)/.test(service) && /remove\("resultActionSource"\)/.test(service));
check('result action still persists timestamp for diagnostics', /putLong\("resultActionTouchAt", now\)/.test(service));
check('completed trip still enters durable PENDING queue', /putString\("gtoTripSyncStatus", GtoAutoTripSync\.STATUS_PENDING\)/.test(service));
check('Firebase watchdog remains active', /CALL_WATCHDOG_MS\s*=\s*25_000L/.test(sync));
check('fast freight detector remains OCR-free', /class GtoFastVisualDetector/.test(fast) && !/TextRecognition|getClient\(/.test(fast));
check('selection coordinator remains sequence based', /class GtoSelectionCoordinator/.test(coord) && /markTouch\(\)/.test(coord));

// State-model checks for the intended rule.
function resultFlow({action, adEvidence=false, next='NONE', certifiedVisualExit=false}) {
  if (action === 'ADS' || adEvidence) return 'REJECTED_BONUS';
  if (action === 'RECEIVE') return 'RESULT_CONFIRMED'; // immediate, no clock
  if (action === 'TOUCH_PENDING' && (next === 'GAMEPLAY' || next === 'FREIGHT_LIST')) return 'RESULT_CONFIRMED';
  if (!action && next === 'GAMEPLAY' && certifiedVisualExit) return 'RESULT_CONFIRMED'; // HF41 OEM-drop self-recovery
  if (!action && next === 'FREIGHT_LIST') return 'RESULT_DETECTED'; // list is neutral until explicit recovery
  return 'RESULT_DETECTED';
}
check('scenario: 15s on result then exact Receive confirms immediately', resultFlow({action:'RECEIVE'}) === 'RESULT_CONFIRMED');
check('scenario: 2min loading after exact Receive cannot invalidate trip', resultFlow({action:'RECEIVE', next:'GAMEPLAY'}) === 'RESULT_CONFIRMED');
check('scenario: redacted touch + delayed gameplay still confirms without timeout', resultFlow({action:'TOUCH_PENDING', next:'GAMEPLAY'}) === 'RESULT_CONFIRMED');
check('scenario: redacted touch + delayed jobs list preserves completed trip', resultFlow({action:'TOUCH_PENDING', next:'FREIGHT_LIST'}) === 'RESULT_CONFIRMED');
check('scenario: exact ADS does not register normal trip', resultFlow({action:'ADS', next:'GAMEPLAY'}) === 'REJECTED_BONUS');
check('scenario: explicit ad evidence overrides pending action', resultFlow({action:'TOUCH_PENDING', adEvidence:true, next:'GAMEPLAY'}) === 'REJECTED_BONUS');
check('scenario: no result action + jobs list preserves unfinished result', resultFlow({action:'', next:'FREIGHT_LIST'}) === 'RESULT_DETECTED');
check('scenario: certified result visually exits to stable gameplay even if OEM drops touch', resultFlow({action:'', next:'GAMEPLAY', certifiedVisualExit:true}) === 'RESULT_CONFIRMED');
check('scenario: no action and no certified transition never auto-confirms', resultFlow({action:'', next:'NONE'}) === 'RESULT_DETECTED');

const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
console.log(`INFO freight detector sha256 ${hash(fast)}`);
console.log(`INFO selection coordinator sha256 ${hash(coord)}`);
let passed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (ok) passed++;
}
console.log(`\n${passed}/${checks.length} R3.6 Receive-latch checks passed.`);
if (passed !== checks.length) process.exit(1);
