import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const servicePath = path.join(root, 'android/app/src/main/java/com/nvu/operacional/GtoObserverService.java');
const policyPath = path.join(root, 'android/app/src/main/java/com/nvu/operacional/GtoOverlayLayoutPolicy.java');
const testPath = path.join(root, 'scripts/java-tests/com/nvu/operacional/GtoBubbleStartupRestorePolicyTest.java');
const service = fs.readFileSync(servicePath, 'utf8');
const policy = fs.readFileSync(policyPath, 'utf8');
const checks = [];
const check = (condition, message) => {
  if (!condition) throw new Error(message);
  checks.push(message);
};

check(policy.includes('STARTUP_REFERENCE_HOLD_MS = 10_000L'), 'timer nominal de dez segundos');
check(policy.includes('shouldRestoreSavedPositionAfterStartup'), 'policy pura de restauração temporal');
check(service.includes('scheduleBubbleStartupRestore(bubbleWidth, bubbleHeight)'), 'timer armado no nascimento');
check(service.includes('mainHandler.postDelayed(\n            bubbleStartupRestoreRunnable,\n            GtoOverlayLayoutPolicy.STARTUP_REFERENCE_HOLD_MS'), 'timer usa a constante única');
check(service.includes('GtoOverlayLayoutPolicy.referenceTopX(') && service.includes('GtoOverlayLayoutPolicy.referenceTopY('), 'nascimento usa âncora da referência');
check(service.includes('!hasExplicitUserGtoBubblePosition() || mainHandler == null'), 'sem posição explícita não há restauração');
check(service.includes('rebaseBubbleLayoutForCurrentDisplay(true, "STARTUP_SAVED_POSITION_RESTORE")'), 'restauração posterior usa o rebase oficial');
check(service.includes('resetBubbleStartupRestoreState();\n                            DisplayMetrics releaseMetrics'), 'arraste cancela o snap tardio');
check(service.includes('resetBubbleStartupRestoreState();\n        FrameLayout candidate = bubbleView'), 'remoção cancela callback tardio');
check(service.includes('shouldRestoreSavedPositionAfterStartup(\n                System.currentTimeMillis(),\n                bubbleStartupAnchorAt'), 'rebase respeita os dez segundos');
check(fs.existsSync(testPath), 'teste puro da fronteira temporal presente');

const classes = '/tmp/gto-hf188-bubble-classes';
fs.rmSync(classes, { recursive: true, force: true });
fs.mkdirSync(classes, { recursive: true });
const javac = spawnSync('javac', ['-d', classes, policyPath, testPath], { encoding: 'utf8' });
if (javac.status !== 0) {
  process.stderr.write(javac.stderr || javac.stdout || 'javac failed\n');
  process.exit(javac.status || 1);
}
const java = spawnSync('java', ['-cp', classes, 'com.nvu.operacional.GtoBubbleStartupRestorePolicyTest'], { encoding: 'utf8' });
if (java.status !== 0) {
  process.stderr.write(java.stderr || java.stdout || 'java failed\n');
  process.exit(java.status || 1);
}
process.stdout.write(java.stdout);
console.log(`HF188 startup bubble restore gate: PASS ${checks.length}/${checks.length}`);
