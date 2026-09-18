import fs from 'node:fs';

const service = fs.readFileSync('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java', 'utf8');
const sync = fs.readFileSync('android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java', 'utf8');
const detector = fs.readFileSync('android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java', 'utf8');
const gradle = fs.readFileSync('android/app/build.gradle', 'utf8');
const selectionIdentity = fs.readFileSync('android/app/src/main/java/com/nvu/operacional/GtoSelectionIdentityPolicy.java', 'utf8');

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({name, ok: Boolean(ok)});
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

check('R3.31 Android version', Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0) >= 48 && Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/)||[])[1]||0) >= 48);
check('single-frame row guessing removed from runtime', !service.includes('detectPressedRowFromSingleFrame(current)'));
check('nearest-row freight resolver removed', !service.includes('findFreightAt(') && !service.includes('findFreightFlexible('));
check('precise touch uses exact bounding boxes', service.includes('exactUniqueRowForTouch(x, y, buttons)') && !service.includes('target.inset(-dp(10), -dp(10))'));
check('no widened freight touch hitbox helper remains in selection', !service.includes('isTapNearRect(rawX, rawY, option.acceptRect'));
check('pre-touch baseline cannot fall back to arbitrary latest frame', service.includes('Never synthesize a pre-touch baseline from an arbitrary latest frame'));
check('touch coordinates are only advisory and must agree when usable', service.includes('coordinateEvidenceAgreesWithRow') && service.includes('GtoSelectionIdentityPolicy.resolveRow') && selectionIdentity.includes('visualCandidateRow != touchedRow'));
check('touch-correlated row path remains available', service.includes('selectionCoordinator.isPostTouch(sequence)') && service.includes('detectPressedRowAfterTouch'));
check('OEM visual fallback still requires isolated press + list closure', service.includes('fastVisualDetector.detectPressedRow(') && service.includes('fastMissingListFrames >= missingRequired') && service.includes('runPreciseSelectedRowOcr(transaction)'));
check('list closure remains a confirmation gate', service.includes('fastMissingListFrames >= missingRequired') && service.includes('finalizeFastVisualSelection()'));
check('selected transaction freezes panel and row geometry', service.includes('FreightSelectionTransaction') && service.includes('panelCopy') && service.includes('final int exactRow = rowIndex'));
check('precise OCR is generation/session protected', service.includes('transaction.generation != preciseSelectionOcrGeneration') && service.includes('!transaction.sessionId.equals(currentSessionId)'));
check('full FreightOption snapshot source is used for durable lock', sync.includes('readJson(prefs.getString("selectedFreight", ""))'));
check('snapshot stores all model identity fields', ['companyRoute','origin','rawText','selectedRow','freightFingerprint'].every(f => sync.includes(`"${f}"`)));
check('snapshot fingerprint is SHA-256', sync.includes('private static String freightFingerprint') && sync.includes('MessageDigest.getInstance("SHA-256")'));
check('locked snapshot cannot be replaced with different freight', sync.includes('snapshot.optBoolean("freightLocked", false)') && sync.includes('sameFreight(snapshot, candidate)'));
check('snapshot removed only after successful ACK path', sync.includes('removeSnapshot(context, sessionId)') && sync.includes('queue.edit().remove(key).commit()'));
check('queue payload carries locked freight fingerprint', sync.includes('"freightFingerprint"') && sync.includes('payload.put("contractVersion", CONTRACT_VERSION)'));
check('completion still requires exact Receive action/verification', service.includes('latchExactReceiveAndSend') && service.includes('resultReceiveLatched'));
check('completed trip is sealed before network send', sync.includes('sealPayload(payload)') && sync.includes('queue.edit().putString(QUEUE_PREFIX + sessionId, sealed).commit()'));

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} R3.17 selection-integrity checks passed.`);
if (failed.length) {
  console.error('\nFailures:');
  for (const item of failed) console.error(`- ${item.name}`);
  process.exit(1);
}
