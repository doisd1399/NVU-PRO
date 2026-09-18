import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = p => fs.readFileSync(p, 'utf8');
const gradle = read('android/app/build.gradle');
const workflow = read('.github/workflows/build-android-release.yml');
const metadata = JSON.parse(read('NVU_RELEASE_METADATA.json'));
const service = read('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java');
const pkg = JSON.parse(read('package.json'));
const checks = [];
const ck = (name, ok) => { checks.push({name, ok: !!ok}); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
const versionCode = Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0);
const versionName = (gradle.match(/versionName\s+"([^"]+)"/)||[])[1]||'';

const versionPatch = Number((versionName.match(/^1\.0\.(\d+)$/)||[])[1]||0);
ck('HF62 Android identity preserved or advanced', versionCode >= 114 && versionPatch >= 114);
ck('HF62 workflow identity preserved or advanced', workflow.includes(`EXPECTED_VERSION_CODE: "${versionCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${versionName}"`) && workflow.includes(`versionCode ${versionCode}`) && workflow.includes(`versionName "${versionName}"`));
ck('HF62 release metadata identity preserved or advanced', metadata.androidVersionCode === versionCode && metadata.androidVersion === versionName && /^R3\.34-PC-HF\d+$/.test(String(metadata.functionalRelease || '')) && /^PC-HF\d+$/.test(String(metadata.packageRevision || '')));
ck('HF62 release gate is mandatory', String(pkg.scripts?.['verify:release'] || '').includes('npm run test:gto-r3.34-hf62-bootstrap-coordinate'));

const queueStart = service.indexOf('private void queueFreightTouchMarker(MotionEvent sourceEvent)');
const queueEnd = service.indexOf('private void toggleMenu()', queueStart);
const queue = queueStart >= 0 && queueEnd > queueStart ? service.slice(queueStart, queueEnd) : '';
ck('bootstrap promotion receives real raw/local coordinates explicitly', queue.includes('promoteReplacementFreightCandidateToWaiting(\n                    true, rawX, rawY, localX, localY'));
ck('bootstrap promotion marks touch as already armed exactly once', queue.includes('touchArmedDuringPromotion = true;') && queue.includes('if (!touchArmedDuringPromotion)'));
ck('fallback arm uses the same real raw/local coordinates', queue.includes('armFastTouchPulseOnCaptureThread(rawX, rawY, localX, localY);'));
ck('coordinate/pressed-row disagreement remains fail-closed', queue.includes('replacementFreightPressedRow != exactReplacementRow') && queue.includes('Toque e quadro pressionado apontaram linhas diferentes; seleção descartada'));
ck('fresh bootstrap still preserves fast first Aceitar', queue.indexOf('exactConsistentRowForTouch') < queue.indexOf('GtoFreightBootstrapPolicy.shouldAwaitSecondListFrame'));

const r324 = spawnSync('node', ['scripts/test-gto-r3-24-bootstrap-origin.mjs'], {encoding:'utf8'});
if (r324.stdout) process.stdout.write(r324.stdout);
if (r324.stderr) process.stderr.write(r324.stderr);
ck('R3.24 bootstrap/origin regression remains 14/14', r324.status === 0 && String(r324.stdout || '').includes('14/14 R3.24 bootstrap/origin checks passed.'));

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF62 Bootstrap Coordinate checks passed.`);
if (failed.length) process.exit(1);
