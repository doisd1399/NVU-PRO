import fs from 'node:fs';
import crypto from 'node:crypto';

const read = p => fs.readFileSync(p, 'utf8');
const service = read('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java');
const sync = read('android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java');
const proof = read('android/app/src/main/java/com/nvu/operacional/GtoResultProofStore.java');
const gradle = read('android/app/build.gradle');
const workflow = read('.github/workflows/build-android-release.yml');
const metadata = JSON.parse(read('NVU_RELEASE_METADATA.json'));
const pkg = JSON.parse(read('package.json'));
const checks = [];
const ck = (name, ok) => { checks.push({name, ok: !!ok}); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const method = (src, signature) => {
  const start = src.indexOf(signature);
  if (start < 0) return '';
  const next = src.indexOf('\n    private ', start + signature.length);
  return next > start ? src.slice(start, next) : src.slice(start);
};

const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || '';
ck('HF64 Android identity is preserved or advanced', versionCode >= 116 && versionName === `1.0.${versionCode}`);
ck('HF64 workflow identity follows current Android source', workflow.includes(`EXPECTED_VERSION_CODE: "${versionCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${versionName}"`));
ck('HF64 release metadata identity is preserved or advanced',
  metadata.androidVersionCode === versionCode
  && metadata.androidVersion === versionName
  && /^R3\.34-PC-HF\d+$/.test(metadata.functionalRelease));
ck('HF64 lineage remains Android-safe', metadata.hf64ChangesAndroidOnlyVsHF63 === true && metadata.hf64ChangesWebVsHF63 === false && metadata.hf64ChangesFunctionsVsHF63 === false);
ck('HF64 regression is mandatory in release gate', String(pkg.scripts?.['verify:release'] || '').includes('npm run test:gto-r3.34-hf64-completion-deadlock'));

const continuity = method(service, 'private void observeCertifiedResultVisualContinuity');
ck('terminal modal disappearance bypasses legacy Receive inference', continuity.includes('isTerminalCompletionCommittedForCurrentSession()') && continuity.includes('mainHandler.post(this::confirmNormalResultAutomatically)') && continuity.includes('finalizando registro automático'));
ck('legacy Receive copy remains only for non-terminal compatibility', continuity.includes('scheduleCertifiedResultExitResolution(now)') && continuity.indexOf('isTerminalCompletionCommittedForCurrentSession()') < continuity.indexOf('scheduleCertifiedResultExitResolution(now)'));

const exitLatch = method(service, 'private void latchCertifiedResultExitAndSend');
ck('already-posted exit resolver forwards terminal commit instead of no-op', exitLatch.includes('isTerminalCompletionCommittedForCurrentSession()') && exitLatch.includes('confirmNormalResultAutomatically();') && exitLatch.indexOf('confirmNormalResultAutomatically();') < exitLatch.indexOf('resultActionCanBeObserved(state)'));

const healer = method(service, 'private void recoverTerminalProgressIfNeeded');
ck('terminal self-healer is bounded and foreground-independent', service.includes('TERMINAL_PROGRESS_SELF_HEAL_INTERVAL_MS = 450L') && healer.includes('lastTerminalProgressSelfHealAt') && healer.includes('isTerminalCompletionCommittedForCurrentSession()'));
ck('self-healer progresses certified RESULT_DETECTED', healer.includes('STATE_RESULT_DETECTED') && healer.includes('confirmNormalResultAutomatically()'));
ck('self-healer progresses RESULT_CONFIRMED through local queue boundary', healer.includes('STATE_RESULT_CONFIRMED') && healer.includes('recoverUnsealedCompletedTripIfNeeded(now)') && healer.includes('recoverSealedCompletionToWaitingIfNeeded()'));
const pollPos = service.indexOf('recoverTerminalProgressIfNeeded(now);');
const rawGtoPos = service.indexOf('boolean rawGto =', pollPos);
ck('terminal healer runs before raw GTO/UsageStats authority', pollPos >= 0 && rawGtoPos > pollPos);

const confirm = method(service, 'private void confirmNormalResultAutomatically');
ck('terminal confirmation bypasses stale foreground only with certified authority', confirm.includes('terminalAuthority') && confirm.includes('TERMINAL_AUTHORITY_OUTSIDE_GTO'));
ck('durable value recovery runs before snapshot OCR', confirm.includes('recoverTerminalResultValueFromDurableEvidence()') && confirm.indexOf('recoverTerminalResultValueFromDurableEvidence()') < confirm.indexOf('recoverResultValueFromSnapshotAsync()'));
ck('missing value no longer requires two snapshot sources forever', !confirm.includes('ainda não alcançou duas leituras concordantes') && confirm.includes('nenhuma evidência monetária durável'));

const valueRecovery = method(service, 'private String recoverTerminalResultValueFromDurableEvidence');
ck('value recovery requires certified terminal commit', valueRecovery.includes('resultCertifiedLatched') && valueRecovery.includes('isTerminalCompletionCommittedForCurrentSession()'));
ck('actual certified result value is preferred', valueRecovery.includes('GtoResultProofStore.certifiedObservedValue') && valueRecovery.indexOf('proofValue') < valueRecovery.indexOf('else if (!lockedOffer.isEmpty())'));
ck('immutable selected freight is deterministic fallback', valueRecovery.includes('GtoAutoTripSync.lockedOfferedValue') && valueRecovery.includes('locked-freight-offer'));
ck('recovered value is synchronously committed to terminal consensus', valueRecovery.includes('resultValueConsensusStable') && valueRecovery.includes('.commit()'));

const locked = method(sync, 'static String lockedOfferedValue');
ck('locked offer recovery reads only immutable locked snapshot', locked.includes('SNAPSHOT_PREFS') && locked.includes('freightLocked') && locked.includes('validateContextSnapshot') && locked.includes('validateFreight') && !locked.includes('prefs.getString("selectedValue"'));
const proofGetter = method(proof, 'static String certifiedObservedValue');
ck('result proof recovery requires certified escrow', proofGetter.includes('certified') && proofGetter.includes('observedValue'));

const snapshot = method(service, 'private boolean recoverResultValueFromSnapshotAsync');
ck('single preserved snapshot candidate wakes durable terminal fallback', snapshot.includes('acionando recuperação terminal durável') && snapshot.includes('mainHandler.post(this::confirmNormalResultAutomatically)'));
ck('snapshot OCR failure also wakes durable terminal fallback', snapshot.includes('Falha no OCR de recuperação; acionando evidência terminal durável'));

ck('queue remains sealed before any network send', sync.indexOf('commitSealedPayload') >= 0 || sync.includes('QUEUE_PREFIX + sessionId'));
const registerSource = read('functions/src/gtoTrips.ts');
ck('HF149 registerGtoTrip uses certified Origin', registerSource.includes('const effectiveOrigin = origin;') && registerSource.includes('GTO_CERTIFIED_ORIGIN'));
ck('HF58 syncGtoTripState remains byte-identical', sha('functions/src/gtoState.ts') === 'f15301283ea37774deef756498a655a0018be17474254dcfc09485efdcfbc836');

const fixtures = [
  ['scripts/fixtures/hf64-completion-deadlock/stuck-finalizing.jpg', '397ab53e771473346293a2156ee6c28fa5850168d1f1a2501dc088087fbfedb6'],
  ['scripts/fixtures/hf64-completion-deadlock/background-sent-next-ready.jpg', '447157d42b3a8f1539c04d4c269f701e069e122ba1e0fc16b60119894d0b92f5'],
  ['scripts/fixtures/hf64-completion-deadlock/next-trip-previous-in-send.jpg', '5b35a038e71b670a3e0e5343818171e7ee85dc9d5bff0c2b0cea93907a1b5007'],
];
const hf64FixturesPresent = fixtures.every(([p]) => fs.existsSync(p));
ck('three reported completion-flow screenshots are packaged exactly',
  !hf64FixturesPresent || fixtures.every(([p,h]) => sha(p) === h));

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF64 Completion Deadlock Safe checks passed.`);
if (failed.length) process.exit(1);
