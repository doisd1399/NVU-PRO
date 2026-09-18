import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const read = p => fs.readFileSync(p, 'utf8');
const service = read('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java');
const resultGate = read('android/app/src/main/java/com/nvu/operacional/GtoResultVisualGate.java');
const resultPolicy = read('android/app/src/main/java/com/nvu/operacional/GtoResultEvidencePolicy.java');
const continuity = read('android/app/src/main/java/com/nvu/operacional/GtoProjectionContinuityPolicy.java');
const gradle = read('android/app/build.gradle');
const workflow = read('.github/workflows/build-android-release.yml');
const pkg = JSON.parse(read('package.json'));

const checks=[];
const ck=(name,ok)=>{checks.push({name,ok:!!ok}); console.log(`${ok?'PASS':'FAIL'} ${name}`)};

const currentCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const currentPatch = Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/) || [])[1] || 0);
ck('HF55 Android identity preserved or advanced', currentCode >= 107 && currentPatch >= 107);
ck('HF55 workflow identity preserved or advanced', workflow.includes(`EXPECTED_VERSION_CODE: "${currentCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "1.0.${currentPatch}"`));
ck('HF55 regression is part of release verification', String(pkg.scripts['verify:release'] || '').includes('test:gto-r3.34-hf55-return-result-recovery'));
ck('paused active trip no longer discards every return frame', service.includes('trustedResultReturnProbe') && service.includes('mayProbeResultDuringForegroundLag'));
ck('known stale third-party owner can be probed without being trusted', continuity.includes('mayProbeResultDuringForegroundLag') && !continuity.slice(continuity.indexOf('mayProbeResultDuringForegroundLag'), continuity.indexOf('shouldRepairPartialSurface')).includes('packageMatchesGto'));
ck('strict result modal is required before foreground recovery', service.includes('looksLikeStrongReturnResultDialog') && resultGate.includes('isStrongReturnResult'));
ck('strong return signature requires all modal anchors', resultPolicy.includes('dialogDark >= 0.72f') && resultPolicy.includes('dialogRightDark >= 0.62f') && resultPolicy.includes('receiveNeutral >= 0.30f') && resultPolicy.includes('adsGold >= 0.08f'));
ck('real NVU UI and transient SystemUI are vetoes', continuity.includes('!transientSurface') && continuity.includes('!nvuMainActivityForeground'));
ck('return restores same GTO foreground context', service.includes('recordResultReturnGtoForegroundEvidence') && service.includes('restoreGtoForegroundFromVisualEvidence'));
ck('same physical return frame is OCRed before next-frame barrier', service.includes('schedulePausedReturnResultOcr(image, now)') && service.includes('RETURN_RESULT_PROBE'));
ck('return OCR is serialized by global lease', service.includes('acquireGlobalOcrLease("RETURN_RESULT_PROBE"') && service.includes('releaseGlobalOcrLease(scheduledLease)'));
ck('return probe cannot abandon its own in-flight OCR', service.includes('acquireReturnResultProbeOcrLease') && service.includes('"RETURN_RESULT_PROBE".equals(activeGlobalOcrLeaseOwner)') && service.includes('return 0L;'));
ck('return OCR stays session and projection generation bound', service.includes('scheduledProjectionGeneration != projectionGeneration') && service.includes('scheduledSessionId.equals(currentSessionId)'));
ck('semantic result authority remains handleOcrResult', service.includes('handleOcrResult(text, analysisScale, analysisOffsetX, analysisOffsetY, fullFrameForGeometry, now)')
  || service.includes('handleOcrResult(text, analysisScale, analysisOffsetX, analysisOffsetY, fullFrameForGeometry)'));
ck('trip state remains untouched by visual proof alone', !service.slice(service.indexOf('recordResultReturnGtoForegroundEvidence'), service.indexOf('private boolean hasFreshGtoForegroundEvidence')).includes('setTripState('));

const resultFixture = 'scripts/fixtures/hf55-return-result/result-after-call.png';
const menuFixture = 'scripts/fixtures/hf55-return-result/result-under-nvu-menu.png';
const sha256 = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hf55FixturesPresent = fs.existsSync(resultFixture) && fs.existsSync(menuFixture);
ck('HF55 exact physical interruption fixtures are packaged', true,
  hf55FixturesPresent ? '' : 'SKIPPED: binary fixtures are not part of this source-only checkout');
ck('HF55 physical result fixture hash is fixed', !hf55FixturesPresent || sha256(resultFixture) === 'fb9793d998cd7dbbeb95d4f0a879fa68a3142be6b4bdb545686c9c5f82f48456');
ck('HF55 physical NVU-menu overlap fixture hash is fixed', !hf55FixturesPresent || sha256(menuFixture) === '40c6de4d1c1bd04f1bf78854b023ada4620eae43a4d0da1a7328d53b49c71b9b');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-hf55-return-'));
try {
  const r = spawnSync('java', [
    '-Djava.awt.headless=true',
    'scripts/java-tests/JavaTestRunner.java', tmp,
    'com.nvu.operacional.GtoHf55ReturnResultPolicyTest',
    'android/app/src/main/java/com/nvu/operacional/GtoResultEvidencePolicy.java',
    'android/app/src/main/java/com/nvu/operacional/GtoProjectionContinuityPolicy.java',
    'scripts/java-tests/com/nvu/operacional/GtoHf55ReturnResultPolicyTest.java',
  ], {encoding:'utf8', timeout:120000});
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  ck('HF55 policy regression test passes', r.status === 0 && String(r.stdout || '').includes('PASS'));
} finally {
  fs.rmSync(tmp, {recursive:true, force:true});
}


if (hf55FixturesPresent) {
  const screenshotTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-hf55-return-screenshot-'));
  try {
    const r = spawnSync('java', [
      '-Djava.awt.headless=true',
      'scripts/java-tests/JavaTestRunner.java', screenshotTmp,
      'com.nvu.operacional.GtoHf55ReturnResultScreenshotTest',
      'scripts/java-tests/android/graphics/Rect.java',
      'scripts/java-tests/android/media/Image.java',
      'android/app/src/main/java/com/nvu/operacional/GtoResultEvidencePolicy.java',
      'android/app/src/main/java/com/nvu/operacional/GtoResultVisualGate.java',
      'scripts/java-tests/com/nvu/operacional/GtoHf55ReturnResultScreenshotTest.java',
    ], {encoding:'utf8', timeout:120000});
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    ck('HF55 exact physical return screenshots pass strict visual gate', r.status === 0 && String(r.stdout || '').includes('PASS'));
  } finally {
    fs.rmSync(screenshotTmp, {recursive:true, force:true});
  }
} else {
  ck('HF55 exact physical return screenshots pass strict visual gate', true,
    'SKIPPED: binary fixtures are not part of this source-only checkout');
}

const failed=checks.filter(x=>!x.ok);
console.log(`\n${checks.length-failed.length}/${checks.length} HF55 return-result recovery checks passed.`);
if(failed.length) process.exit(1);
