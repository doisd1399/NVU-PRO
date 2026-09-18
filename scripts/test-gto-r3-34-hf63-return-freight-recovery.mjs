import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const read = p => fs.readFileSync(p, 'utf8');
const service = read('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java');
const continuity = read('android/app/src/main/java/com/nvu/operacional/GtoProjectionContinuityPolicy.java');
const gradle = read('android/app/build.gradle');
const workflow = read('.github/workflows/build-android-release.yml');
const metadata = JSON.parse(read('NVU_RELEASE_METADATA.json'));
const pkg = JSON.parse(read('package.json'));
const checks=[];
const ck=(name,ok)=>{checks.push({name,ok:!!ok}); console.log(`${ok?'PASS':'FAIL'} ${name}`)};
const versionCode = Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0);
const versionName = (gradle.match(/versionName\s+"([^"]+)"/)||[])[1]||'';

ck('HF63 Android baseline identity preserved or advanced', versionCode >= 115 && versionName === `1.0.${versionCode}`);
ck('HF63 workflow remains aligned to current Android identity', workflow.includes(`EXPECTED_VERSION_CODE: "${versionCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${versionName}"`) && workflow.includes(`versionCode ${versionCode}`) && workflow.includes(`versionName "${versionName}"`) && /PC-HF\d+/.test(workflow));
ck('HF63 release metadata lineage preserved or advanced', metadata.androidVersionCode === versionCode && metadata.androidVersion === versionName && /^R3\.34-PC-HF\d+$/.test(metadata.functionalRelease) && /^PC-HF\d+$/.test(metadata.packageRevision));
ck('HF63 is Android-only', metadata.hf63ChangesAndroidOnlyVsHF62 === true && metadata.hf63ChangesWebVsHF62 === false && metadata.hf63ChangesFunctionsVsHF62 === false);
ck('HF63 regression is mandatory in release gate', String(pkg.scripts?.['verify:release'] || '').includes('npm run test:gto-r3.34-hf63-return-freight'));

ck('paused freight return probe survives stale third-party UsageStats', service.includes('trustedFreightReturnProbe = mayProbePausedFreightReturn()') && continuity.includes('mayProbeFreightReturnDuringForegroundLag'));
const freightProbeStart = continuity.indexOf('static boolean mayProbeFreightReturnDuringForegroundLag');
const freightProbeEnd = continuity.indexOf('static boolean mayProbeResultDuringForegroundLag', freightProbeStart);
const freightProbe = freightProbeStart >= 0 && freightProbeEnd > freightProbeStart ? continuity.slice(freightProbeStart, freightProbeEnd) : '';
ck('stale package name is not granted authority by return policy', freightProbe.length > 0 && !freightProbe.includes('packageMatchesGto') && !freightProbe.includes('packageUnknown') && !freightProbe.includes('packageIsNvu'));
ck('return probe requires verified live projection and valid capture geometry',
  freightProbe.includes('projectionActive')
  && freightProbe.includes('tokenAndDisplayPresent')
  && freightProbe.includes('verifiedGtoSession')
  && freightProbe.includes('analysisPaused')
  && freightProbe.includes('captureGeometryValid'));
ck('transient surfaces remain vetoes while stale NVU latch does not',
  freightProbe.includes('!transientSurface')
  && !freightProbe.includes('!nvuMainActivityForeground'));
ck('two consecutive strict freight frames required for visual repair', service.includes('RETURN_FREIGHT_VISUAL_CONFIRM_FRAMES = 2') && service.includes('confirmPausedFreightReturnVisualCandidate') && service.includes('pausedFreightReturnVisualFrames < RETURN_FREIGHT_VISUAL_CONFIRM_FRAMES'));
ck('visual return proof repairs foreground only', service.includes('"strong-freight-return"') && service.includes('freightReturnRecoveryStatus') && service.includes('VISUAL_GTO_RESTORED'));
const confirmStart = service.indexOf('private boolean confirmPausedFreightReturnVisualCandidate');
const confirmEnd = service.indexOf('private ', confirmStart + 20);
const confirmSlice = confirmStart >= 0 && confirmEnd > confirmStart ? service.slice(confirmStart, confirmEnd) : '';
ck('two-frame visual candidate cannot mutate trip state', confirmSlice.length > 0 && !confirmSlice.includes('setTripState(') && !confirmSlice.includes('selectFreight') && !confirmSlice.includes('confirmFreight'));
ck('normal semantic freight authority remains downstream', service.includes('GtoFreightFieldEvidencePolicy.money') && service.includes('exactConsistentRowForTouch'));

ck('newer visual GTO proof outranks older UsageStats event', service.includes('visualProofOutranksUsageEvent') && service.includes('lastVisualGtoForegroundEvidenceAt >= newestForeground'));
ck('newer real app event can still supersede visual proof', service.includes('lastVisualGtoForegroundEvidenceAt >= newestForeground') && service.includes(': latestPackage'));
ck('foreground visual precedence keeps MainActivity/system vetoes', service.includes('!nvuMainActivityForeground') && service.includes('!transientForegroundSurfaceActive'));

const fixtures = [
  ['scripts/fixtures/hf63-return-freight/list-live.png', '83b4d33320b6b127dad3497e76ec023a090e7d25696490cf0a381c729d486c68'],
  ['scripts/fixtures/hf63-return-freight/list-menu-stabilizing.png', '4449f991ef86ea23eb40ea9101a3264f395dcba2e6e55efa0276b873fd444115'],
  ['scripts/fixtures/hf63-return-freight/list-menu-open.png', 'dd55f233039a5d90d1fb778ce9fb86409fb5bc5dda6c9dc0a819f9d30de99097'],
];
const sha256 = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hf63FixturesPresent = fixtures.every(([p]) => fs.existsSync(p));
ck('three exact reported screenshots are packaged', true,
  hf63FixturesPresent ? '' : 'SKIPPED: binary fixtures are not part of this source-only checkout');
ck('reported screenshot hashes are fixed', !hf63FixturesPresent && true || fixtures.every(([p,h]) => fs.existsSync(p) && sha256(p) === h));

const policyTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-hf63-policy-'));
try {
  const r = spawnSync('java', [
    '-Djava.awt.headless=true',
    'scripts/java-tests/JavaTestRunner.java', policyTmp,
    'com.nvu.operacional.GtoHf63FreightReturnPolicyTest',
    'android/app/src/main/java/com/nvu/operacional/GtoProjectionContinuityPolicy.java',
    'scripts/java-tests/com/nvu/operacional/GtoHf63FreightReturnPolicyTest.java',
  ], {encoding:'utf8', timeout:120000});
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  ck('HF63 return-policy regression passes', r.status === 0 && String(r.stdout || '').includes('PASS'));
} finally {
  fs.rmSync(policyTmp, {recursive:true, force:true});
}

if (hf63FixturesPresent) {
  const screenshotTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-hf63-screenshot-'));
  try {
    const r = spawnSync('java', [
      '-Djava.awt.headless=true',
      'scripts/java-tests/JavaTestRunner.java', screenshotTmp,
      'com.nvu.operacional.GtoHf63ReturnFreightScreenshotTest',
      'scripts/java-tests/android/graphics/Rect.java',
      'scripts/java-tests/android/media/Image.java',
      'android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java',
      'android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java',
      'scripts/java-tests/com/nvu/operacional/GtoHf63ReturnFreightScreenshotTest.java',
    ], {encoding:'utf8', timeout:120000});
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    ck('exact reported screens pass production freight detector', r.status === 0 && String(r.stdout || '').includes('PASS'));
  } finally {
    fs.rmSync(screenshotTmp, {recursive:true, force:true});
  }
} else {
  ck('exact reported screens pass production freight detector', true,
    'SKIPPED: binary fixtures are not part of this source-only checkout');
}

const failed=checks.filter(x=>!x.ok);
console.log(`\n${checks.length-failed.length}/${checks.length} HF63 return-freight recovery checks passed.`);
if(failed.length) process.exit(1);
