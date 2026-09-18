import fs from 'node:fs';
import crypto from 'node:crypto';

const servicePath = 'android/app/src/main/java/com/nvu/operacional/GtoObserverService.java';
const managerPath = 'android/app/src/main/java/com/nvu/operacional/NvuAudioManager.java';
const manifestPath = 'android/app/src/main/AndroidManifest.xml';
const gradlePath = 'android/app/build.gradle';
const workflowPath = '.github/workflows/build-android-release.yml';
const readyPath = 'android/app/src/main/res/raw/nvu_ready_voice_pt_br.mp3';
const completedPath = 'android/app/src/main/res/raw/nvu_trip_completed_voice_pt_br.mp3';
const voiceVerifierPath = 'scripts/verify-hf60-voice-apk.py';

const service = fs.readFileSync(servicePath, 'utf8');
const manager = fs.readFileSync(managerPath, 'utf8');
const manifest = fs.readFileSync(manifestPath, 'utf8');
const gradle = fs.readFileSync(gradlePath, 'utf8');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const ready = fs.readFileSync(readyPath);
const completed = fs.readFileSync(completedPath);
const voiceVerifier = fs.readFileSync(voiceVerifierPath, 'utf8');

const checks = [];
const ck = (name, ok) => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
};
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const fileSha = (path) => sha(fs.readFileSync(path));

const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || '';

ck('HF51+ Android identity baseline', versionCode >= 103 && /^1\.0\.(?:10[3-9]|1[1-9][0-9]|[2-9][0-9]{2,})$/.test(versionName));
ck('workflow follows current Android identity', workflow.includes(`EXPECTED_VERSION_CODE: "${versionCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${versionName}"`));

ck('ready MP3 has expected approved size', ready.length === 18576);
ck('completed MP3 has expected approved size', completed.length === 39888);
ck('ready MP3 is byte-identical to approved upload', sha(ready) === 'b53a46523dbbe745ac0a9600637ffce7f1f9c34667c64b2b1730c0df32b60bf2');
ck('completed MP3 is byte-identical to approved upload', sha(completed) === '49c9c7fb8585b4385971cc3d19c59f8df0015e6e2c74ab1ae4bce7cd45fb7179');
ck('workflow checks ready MP3 inside APK', workflow.includes('python3 scripts/verify-hf60-voice-apk.py') && voiceVerifier.includes('nvu_ready_voice_pt_br.mp3') && voiceVerifier.includes('zipfile.ZipFile'));
ck('workflow checks completed MP3 inside APK', workflow.includes('python3 scripts/verify-hf60-voice-apk.py') && voiceVerifier.includes('nvu_trip_completed_voice_pt_br.mp3') && voiceVerifier.includes('zipfile.ZipFile'));
ck('workflow pins exact ready MP3 hash', voiceVerifier.includes('b53a46523dbbe745ac0a9600637ffce7f1f9c34667c64b2b1730c0df32b60bf2'));
ck('workflow pins exact completed MP3 hash', voiceVerifier.includes('49c9c7fb8585b4385971cc3d19c59f8df0015e6e2c74ab1ae4bce7cd45fb7179'));

ck('audio manager remains isolated from detection', manager.includes('public final class NvuAudioManager') && !manager.includes('MediaProjection') && !manager.includes('GtoFastVisualDetector') && !manager.includes('TextRecognizer'));
ck('ready voice uses local resource', manager.includes('playReadyVoice(String eventId)') && manager.includes('R.raw.nvu_ready_voice_pt_br'));
ck('completed voice uses local resource', manager.includes('playTripCompletedVoice(String eventId)') && manager.includes('R.raw.nvu_trip_completed_voice_pt_br'));
ck('voice playback is asynchronous relative to detector and has no sleep', !manager.includes('Thread.sleep') && !service.includes('Thread.sleep'));
ck('voice playback does not force device volume', !manager.includes('setStreamVolume') && !manager.includes('adjustStreamVolume') && !manager.includes('.setVolume('));
ck('runtime TTS was not introduced', !manager.includes('TextToSpeech') && !service.includes('TextToSpeech'));
ck('voice queue prevents clip overlap', manager.includes('pendingVoices') && manager.includes('activePlayer') && manager.includes('startNextLocked'));
ck('ready anti-repeat is durable', manager.includes('lastReadyVoiceEventId') && manager.includes('queuedOrPlayingEventIds'));
ck('completed anti-repeat is durable', manager.includes('lastTripCompletedVoiceEventId') && manager.includes('queuedOrPlayingEventIds'));
ck('audio resources are released', manager.includes('public void release()') && manager.includes('player.release()'));

ck('SISTEMA_PRONTO still comes from confirmed freight transition', service.includes('emitSystemReadyForDepartureIfEligible();') && service.includes('EVENT_SISTEMA_PRONTO'));
ck('ready event still requires TRIP_IN_PROGRESS', service.includes('!STATE_TRIP_IN_PROGRESS.equals(getTripState())'));
ck('ready event still requires confirmed human selection', service.includes('!hasConfirmedSelectionIdentity()'));
ck('ready event still requires immutable session snapshot', service.includes('GtoAutoTripSync.hasRecoverableSessionSnapshot(this, sessionId, true)'));
ck('ready voice is passive and fail-open', service.includes('nvuAudioManager.playReadyVoice(eventId)'));

ck('completion event constant exists', service.includes('EVENT_VIAGEM_CONCLUIDA = "VIAGEM_CONCLUIDA"'));
ck('completion voice is connected to certified result persistence', service.includes('emitTripCompletedVoiceIfEligible();') && (service.match(/emitTripCompletedVoiceIfEligible\(\);/g) || []).length >= 2);
ck('completion voice requires durable result latch', service.includes('!prefs.getBoolean("resultCertifiedLatched", false)'));
ck('completion voice refuses already-proven watched-ad result', service.includes('prefs.getBoolean("resultWatchedAdEvidence", false)'));
ck('completion voice is keyed to result/session id', service.includes('EVENT_VIAGEM_CONCLUIDA + "|" + sessionId'));
ck('completion voice is passive and fail-open', service.includes('nvuAudioManager.playTripCompletedVoice(eventId)'));
ck('existing HF49 automatic finalize remains present', service.includes('scheduleAutoFinalizeCertifiedResult(0L)'));
ck('existing result driver message remains present', service.includes('Viagem concluída, enviando dados automaticamente...'));

ck('no microphone permission added', !manifest.includes('android.permission.RECORD_AUDIO'));
ck('no audio capture permission added', !manifest.includes('android.permission.CAPTURE_AUDIO_OUTPUT'));
ck('no unnecessary audio settings permission added', !manifest.includes('android.permission.MODIFY_AUDIO_SETTINGS'));
ck('no AudioRecord API introduced', !service.includes('AudioRecord') && !manager.includes('AudioRecord'));

const detectorPath = 'android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java';
const detector = fs.readFileSync(detectorPath, 'utf8');
ck('fast freight detector preserves approved human-backed semantics',
  detector.includes('detectPressedRowAfterTouch')
  && detector.includes('Do not require aggregate current.hasFreightList() here')
  && detector.includes('signatureDistance(baseline.panelSignature, current.panelSignature) > 0.026f')
  && !detector.includes('detectPressedRowFromSingleFrame'));
const invariantFiles = [
  ['selection coordinator unchanged from HF50', 'android/app/src/main/java/com/nvu/operacional/GtoSelectionCoordinator.java', 'd84fe0848f5a054225cf939786156c07a291a4eb74a362ca9f72878d920b0ddd'],
  ['projection recovery unchanged from HF50', 'android/app/src/main/java/com/nvu/operacional/GtoProjectionRecoveryPolicy.java', 'ac9c3663d19b0d1b3eb3c252e318012c46a9c686aa91a44408e86d4134c4c119'],
  ['manifest unchanged from HF50', manifestPath, '41b6f600798bda8cb5f52ffa5d98d881ae7c6ee4ec9b24ec7ccde7ba3759e8e8'],
];
for (const [name, path, expected] of invariantFiles) ck(name, fileSha(path) === expected);
const continuity = fs.readFileSync('android/app/src/main/java/com/nvu/operacional/GtoProjectionContinuityPolicy.java', 'utf8');
const captureHealth = fs.readFileSync('android/app/src/main/java/com/nvu/operacional/GtoCaptureHealthPolicy.java', 'utf8');
ck('projection continuity keeps approved self-healing semantics',
  continuity.includes('mayProbeFreightReturnDuringForegroundLag')
  && continuity.includes('shouldRepairPartialSurface')
  && continuity.includes('needsFreshGrant'));
ck('capture health keeps approved transport freshness semantics',
  captureHealth.includes('isTransportHealthy')
  && captureHealth.includes('FRAME_HEALTH_FRESH_MS')
  && captureHealth.includes('ANALYSIS_HEALTH_FRESH_MS')
  && captureHealth.includes('shouldRecoverSurface'));

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF51 dual-voice checks passed.`);
if (failed.length) process.exit(1);
