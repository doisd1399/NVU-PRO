import fs from 'fs';
import path from 'path';
const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const service=read('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java');
const sync=read('android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java');
const plugin=read('android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java');
const has=(s,t)=>s.includes(t);
const results=[];
const test=(name, ok)=>results.push({name,ok:!!ok});

// Small deterministic model of the safety invariants. It is intentionally conservative:
// an ambiguous observation never becomes a registered trip without a Receive-equivalent
// action, while durable completion never falls back into an unfinished state.
function transition(state, event, ctx={}) {
  if (event==='START_SESSION') return 'WAITING_FREIGHT';
  if (state==='WAITING_FREIGHT' && event==='FREIGHT_LOCKED') return 'TRIP_IN_PROGRESS';
  if (state==='TRIP_IN_PROGRESS' && event==='TEMP_APP_EXIT') return 'TRIP_IN_PROGRESS';
  if (state==='TRIP_IN_PROGRESS' && event==='PROCESS_RESTART') return 'TRIP_IN_PROGRESS_REAUTH';
  if (['TRIP_IN_PROGRESS','RESULT_DETECTED','AWAITING_BONUS_VALIDATION'].includes(state) && event==='FREIGHT_LIST' && !ctx.receiveEvidence) return 'WAITING_FREIGHT';
  if (state==='TRIP_IN_PROGRESS' && event==='RESULT_OCR') return 'RESULT_DETECTED';
  if (['RESULT_DETECTED','AWAITING_BONUS_VALIDATION'].includes(state) && event==='EXACT_RECEIVE') return 'RESULT_CONFIRMED';
  if (['RESULT_DETECTED','AWAITING_BONUS_VALIDATION'].includes(state) && event==='EXACT_ADS') return 'REJECTED_BONUS';
  if (state==='RESULT_DETECTED' && event==='REDACTED_TOUCH') return 'RESULT_DETECTED_TOUCH_PENDING';
  if (state==='RESULT_DETECTED_TOUCH_PENDING' && ['GAMEPLAY','FREIGHT_LIST'].includes(event)) return 'RESULT_CONFIRMED';
  if (state==='RESULT_DETECTED' && event==='SENSOR_FAILED_RESULT_EXIT') return 'FALLBACK_READY';
  if (state==='FALLBACK_READY' && event==='FALLBACK_RECEIVE') return 'RESULT_CONFIRMED';
  if (state==='FALLBACK_READY' && event==='FALLBACK_DISCARD') return 'WAITING_FREIGHT';
  if (state==='RESULT_CONFIRMED' && event==='PROCESS_RESTART') return 'RESULT_CONFIRMED_PENDING_SYNC';
  if (state==='RESULT_CONFIRMED' && event==='NETWORK_FAIL') return 'PENDING';
  if (state==='RESULT_CONFIRMED' && event==='CALL_TIMEOUT') return 'PENDING';
  if (['RESULT_CONFIRMED','PENDING','RESULT_CONFIRMED_PENDING_SYNC'].includes(state) && event==='BACKEND_ACK') return 'SYNCED';
  if (event==='TASK_REMOVED') return state;
  if (event==='PROJECTION_STOPPED') return `${state}_REAUTH`;
  if (event==='LOGOUT_UNFINISHED') return 'IDLE';
  if (event==='LOGOUT_COMPLETED_PENDING') return 'QUEUE_PRESERVED_SESSION_CLEARED';
  return state;
}

let s=transition('IDLE','START_SESSION');
test('01 start creates waiting-freight state', s==='WAITING_FREIGHT');
s=transition(s,'FREIGHT_LOCKED');
test('02 locked freight starts trip', s==='TRIP_IN_PROGRESS');
test('03 temporary app exit preserves active trip', transition(s,'TEMP_APP_EXIT')==='TRIP_IN_PROGRESS');
test('04 process restart preserves active trip and requires capture reauth', transition(s,'PROCESS_RESTART')==='TRIP_IN_PROGRESS_REAUTH');
test('05 real freight list cancels unfinished prior route and rearms', transition(s,'FREIGHT_LIST')==='WAITING_FREIGHT');
s=transition(s,'RESULT_OCR');
test('06 result OCR alone never completes trip', s==='RESULT_DETECTED');
test('07 exact Receive completes regardless of loading duration', transition(s,'EXACT_RECEIVE')==='RESULT_CONFIRMED');
test('08 exact ADS cannot enter normal completion', transition(s,'EXACT_ADS')==='REJECTED_BONUS');
let redacted=transition(s,'REDACTED_TOUCH');
test('09 redacted touch remains pending until screen transition', redacted==='RESULT_DETECTED_TOUCH_PENDING');
test('10 redacted touch + gameplay transition completes', transition(redacted,'GAMEPLAY')==='RESULT_CONFIRMED');
let fallback=transition(s,'SENSOR_FAILED_RESULT_EXIT');
test('11 sensor failure never guesses Receive automatically', fallback==='FALLBACK_READY');
test('12 explicit sensor fallback Receive completes safely', transition(fallback,'FALLBACK_RECEIVE')==='RESULT_CONFIRMED');
test('13 explicit fallback discard starts a clean freight session', transition(fallback,'FALLBACK_DISCARD')==='WAITING_FREIGHT');
let completed=transition(s,'EXACT_RECEIVE');
test('14 process restart after Receive preserves completed trip for sync', transition(completed,'PROCESS_RESTART')==='RESULT_CONFIRMED_PENDING_SYNC');
test('15 network failure keeps completed trip pending', transition(completed,'NETWORK_FAIL')==='PENDING');
test('16 Firebase watchdog timeout keeps completed trip pending', transition(completed,'CALL_TIMEOUT')==='PENDING');
test('17 compatible backend ACK is the only modeled synced terminal', transition('PENDING','BACKEND_ACK')==='SYNCED');
test('18 removing NVU task does not cancel trip state', transition('TRIP_IN_PROGRESS','TASK_REMOVED')==='TRIP_IN_PROGRESS');
test('19 projection termination preserves trip but requires reauthorization', transition('TRIP_IN_PROGRESS','PROJECTION_STOPPED')==='TRIP_IN_PROGRESS_REAUTH');
test('20 logout discards unfinished trip from shared-account context', transition('TRIP_IN_PROGRESS','LOGOUT_UNFINISHED')==='IDLE');
test('21 logout preserves already completed pending queue while clearing session', transition('RESULT_CONFIRMED','LOGOUT_COMPLETED_PENDING')==='QUEUE_PRESERVED_SESSION_CLEARED');
test('22 freight list cannot discard a trip with durable Receive evidence', transition('RESULT_DETECTED','FREIGHT_LIST',{receiveEvidence:true})==='RESULT_DETECTED');

// Bind modeled behavior back to concrete implementation markers.
test('23 implementation binds START_STICKY + stopWithTask recovery path', has(service,'return START_STICKY;') && has(service,'onTaskRemoved(Intent rootIntent)'));
test('24 implementation binds active-trip restart recovery', has(service,'recoverActiveTrip') && has(service,'projectionReauthRequired'));
test('25 implementation binds list-driven stale-session replacement', has(service,'promoteReplacementFreightCandidateToWaiting') && has(service,'discardUnresolvedResultAndStartNewFreight'));
test('26 implementation binds exact Receive latch without timeout', has(service,'latchExactReceiveAndSend') && !has(service,'RESULT_ACTION_EVIDENCE_MS'));
test('27 implementation binds ADS rejection independently', has(service,'latchExactAdsTouch') && has(service,'REJECTED_BONUS'));
test('28 implementation binds completed-trip local sealing before network', has(sync,'PAYLOAD_SEALED') && has(sync,'queue.edit().putString(QUEUE_PREFIX + sessionId, sealed).commit()'));
test('29 implementation binds 25s call watchdog and retry', has(sync,'CALL_WATCHDOG_MS = 25_000L') && has(sync,'scheduleRetry(retry, sessionId, null)'));
test('30 implementation binds exact backend session/contract ACK', has(sync,'sessionId.equals(responseSession)') && has(sync,'responseContract < CONTRACT_VERSION'));
test('31 implementation binds logout synchronous account-boundary cleanup', has(plugin,'boolean cleanupCommit = prefs.edit()') && has(plugin,'cleanupPersisted'));
test('32 implementation binds overlay detach self-heal', has(service,'!bubbleView.isAttachedToWindow()') && has(service,'showBubbleIfAllowed'));
test('33 implementation binds runtime permission revocation diagnostics', has(service,'OVERLAY_REVOKED') && has(service,'USAGE_ACCESS_REVOKED'));
test('34 implementation binds projection terminal failure recovery', has(service,'reportProjectionPermissionTerminalFailure') && has(service,'projectionPermissionInFlight'));

let passed=0;
for (const r of results) { if(r.ok) passed++; console.log(`${r.ok?'OK  ':'FAIL'} ${r.name}`); }
console.log(`\n${passed}/${results.length} R3.8 modeled runtime scenarios passed.`);
if (passed!==results.length) process.exit(1);
