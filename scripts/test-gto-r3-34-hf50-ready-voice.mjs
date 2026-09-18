import fs from 'node:fs';
import crypto from 'node:crypto';

const servicePath = 'android/app/src/main/java/com/nvu/operacional/GtoObserverService.java';
const audioManagerPath = 'android/app/src/main/java/com/nvu/operacional/NvuAudioManager.java';
const legacyAudioPath = 'android/app/src/main/res/raw/nvu_ready_voice_pt_br.ogg';
const mp3AudioPath = 'android/app/src/main/res/raw/nvu_ready_voice_pt_br.mp3';
const audioPath = fs.existsSync(mp3AudioPath) ? mp3AudioPath : legacyAudioPath;
const manifestPath = 'android/app/src/main/AndroidManifest.xml';
const gradlePath = 'android/app/build.gradle';
const workflowPath = '.github/workflows/build-android-release.yml';
const voiceVerifierPath = 'scripts/verify-hf60-voice-apk.py';

const service = fs.readFileSync(servicePath, 'utf8');
const manager = fs.readFileSync(audioManagerPath, 'utf8');
const manifest = fs.readFileSync(manifestPath, 'utf8');
const gradle = fs.readFileSync(gradlePath, 'utf8');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const voiceVerifier = fs.readFileSync(voiceVerifierPath, 'utf8');
const audio = fs.readFileSync(audioPath);

const checks = [];
const ck = (name, ok) => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
};
const sha = (path) => crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');

const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || '';
ck('HF50+ Android identity baseline', versionCode >= 102);
ck('HF50+ workflow keeps signed Android release identity', workflow.includes('EXPECTED_APPLICATION_ID: com.nvu.operacional') && workflow.includes('EXPECTED_VERSION_CODE'));

ck('bundled local ready voice exists', audio.length > 10_000 && audio.length < 500_000);
ck('bundled ready voice uses a supported local container', audio.subarray(0, 4).toString('ascii') === 'OggS' || audioPath.endsWith('.mp3'));
ck('bundled ready voice hash is release-pinned for HF50 or newer user-supplied asset', [
  '928647652e4ad9ab0a0838097c15e8f42d77b311c03bb89812c3394a8f7e25d5',
  'b53a46523dbbe745ac0a9600637ffce7f1f9c34667c64b2b1730c0df32b60bf2',
].includes(crypto.createHash('sha256').update(audio).digest('hex')));
ck('workflow verifies ready voice inside built APK', workflow.includes('python3 scripts/verify-hf60-voice-apk.py') && voiceVerifier.includes('nvu_ready_voice_pt_br.mp3') && voiceVerifier.includes('zipfile.ZipFile'));

ck('audio module is isolated from screen detection', manager.includes('public final class NvuAudioManager') && !manager.includes('MediaProjection') && !manager.includes('GtoFastVisualDetector'));
ck('audio module consumes a confirmed event id', manager.includes('playReadyVoice(String eventId)') && manager.includes('lastReadyVoiceEventId'));
ck('audio module uses local MediaPlayer resource', manager.includes('MediaPlayer.create') && manager.includes('R.raw.nvu_ready_voice_pt_br'));
ck('audio playback is speech/media and does not force volume', manager.includes('CONTENT_TYPE_SPEECH') && manager.includes('USAGE_MEDIA') && !manager.includes('setStreamVolume') && !manager.includes('adjustStreamVolume') && !manager.includes('.setVolume('));
ck('audio module releases MediaPlayer resources', manager.includes('public void release()') && manager.includes('player.release()'));
ck('audio path has no detector-blocking sleep', !manager.includes('Thread.sleep') && !service.includes('Thread.sleep'));
ck('runtime TTS was not introduced', !manager.includes('TextToSpeech') && !service.includes('TextToSpeech'));

ck('service preloads audio manager once', service.includes('nvuAudioManager = new NvuAudioManager(this'));
ck('service releases audio manager on destroy', service.includes('nvuAudioManager.release();'));
ck('SISTEMA_PRONTO is emitted from existing confirmed freight transition', service.includes('emitSystemReadyForDepartureIfEligible();') && service.includes('recordObserverEvent(EVENT_SISTEMA_PRONTO'));
ck('ready event requires existing TRIP_IN_PROGRESS state and confirmed selection', service.includes('!STATE_TRIP_IN_PROGRESS.equals(getTripState())') && service.includes('!hasConfirmedSelectionIdentity()'));
ck('ready event requires immutable session snapshot', service.includes('GtoAutoTripSync.hasRecoverableSessionSnapshot(this, sessionId, true)'));
ck('ready voice is suppressed when terminal/result evidence already exists', service.includes('pendingResultDuringFreightReview') && service.includes('resultCertifiedLatched'));
ck('event anti-repeat is durable per trip session', service.includes('EVENT_SISTEMA_PRONTO + "|" + sessionId') && service.includes('lastSistemaProntoEventId'));

ck('no microphone permission exists', !manifest.includes('android.permission.RECORD_AUDIO'));
ck('no audio-recording permission/API added', !manifest.includes('android.permission.CAPTURE_AUDIO_OUTPUT') && !service.includes('AudioRecord') && !manager.includes('AudioRecord'));
ck('no audio volume permission added', !manifest.includes('android.permission.MODIFY_AUDIO_SETTINGS'));

ck('fast freight detector remains OCR-free and present', fs.existsSync('android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java') && !fs.readFileSync('android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java', 'utf8').includes('TextRecognition'));
ck('selection coordinator remains present', fs.existsSync('android/app/src/main/java/com/nvu/operacional/GtoSelectionCoordinator.java'));
const projectionContinuity = fs.readFileSync('android/app/src/main/java/com/nvu/operacional/GtoProjectionContinuityPolicy.java', 'utf8');
const captureHealth = fs.readFileSync('android/app/src/main/java/com/nvu/operacional/GtoCaptureHealthPolicy.java', 'utf8');
const projectionRecovery = fs.readFileSync('android/app/src/main/java/com/nvu/operacional/GtoProjectionRecoveryPolicy.java', 'utf8');
const projectionForeground = fs.readFileSync('android/app/src/main/java/com/nvu/operacional/GtoProjectionForegroundBridgePolicy.java', 'utf8');
ck('projection continuity policy keeps current self-healing gates',
  projectionContinuity.includes('mayProbeFreightReturnDuringForegroundLag')
  && projectionContinuity.includes('shouldRepairPartialSurface')
  && projectionContinuity.includes('needsFreshGrant'));
ck('capture health policy keeps transport freshness gates',
  captureHealth.includes('isTransportHealthy')
  && captureHealth.includes('FRAME_HEALTH_FRESH_MS')
  && captureHealth.includes('ANALYSIS_HEALTH_FRESH_MS')
  && captureHealth.includes('shouldRecoverSurface'));
ck('projection recovery policy remains present',
  projectionRecovery.includes('shouldEscalateSurfaceRecovery')
  && projectionRecovery.includes('shouldAutoRequest'));
ck('projection foreground bridge remains present',
  projectionForeground.includes('foreground') || projectionForeground.includes('GTO'));
ck('Android manifest remains free of recording permissions',
  !manifest.includes('android.permission.RECORD_AUDIO')
  && !manifest.includes('android.permission.CAPTURE_AUDIO_OUTPUT'));

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF50 ready-voice checks passed.`);
if (failed.length) process.exit(1);
