import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const checks = [];
const commandLogs = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function sha256(path) {
  return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
}
function run(name, command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  commandLogs.push({ name, command: [command, ...args].join(' '), stdout: result.stdout || '', stderr: result.stderr || '', status: result.status });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  check(name, result.status === 0, `exit=${result.status}`);
}

const fastDetector = 'android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java';
const coordinator = 'android/app/src/main/java/com/nvu/operacional/GtoSelectionCoordinator.java';
const sync = 'android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java';
const service = 'android/app/src/main/java/com/nvu/operacional/GtoObserverService.java';
const plugin = 'android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java';
const backend = 'functions/src/gtoTrips.ts';
const backendIndex = 'functions/src/index.ts';
const firebaseConfig = 'firebase.json';
const webBridge = 'src/lib/gtoObserver.ts';

const fix17FastSha = '069c51986dd6bdf58e2b8d12d1fdcb9862f35c3b24f27c30613241a6fe8ecbfd';
const fix17CoordinatorSha = 'd84fe0848f5a054225cf939786156c07a291a4eb74a362ca9f72878d920b0ddd';
const fastDetectorText = fs.readFileSync(fastDetector, 'utf8');
const controlledAdaptiveFastDetector = fastDetectorText.includes('detectButtonsInBand')
  && fastDetectorText.includes('refineButtonHorizontalBounds')
  && fastDetectorText.includes('PressCandidate')
  && !fastDetectorText.includes('TextRecognizer');
check('FIX17 fast detector contract preserved or controlled adaptive successor',
  sha256(fastDetector) === fix17FastSha || controlledAdaptiveFastDetector,
  sha256(fastDetector));
check('FIX17 selection coordinator binary-equivalent', sha256(coordinator) === fix17CoordinatorSha, sha256(coordinator));

const syncText = fs.readFileSync(sync, 'utf8');
const serviceText = fs.readFileSync(service, 'utf8');
const pluginText = fs.readFileSync(plugin, 'utf8');
const backendText = fs.readFileSync(backend, 'utf8');
const backendIndexText = fs.readFileSync(backendIndex, 'utf8');
const firebaseText = fs.readFileSync(firebaseConfig, 'utf8');
const webText = fs.readFileSync(webBridge, 'utf8');

check('FIX18 immutable context snapshot present', syncText.includes('nvu_gto_trip_snapshot_v2') && serviceText.includes('beginSessionSnapshot(this, prefs, sessionId)'));
check('FIX18 freight lock present on both selection commits', (serviceText.match(/lockSelectedFreight\(this, prefs\)/g) || []).length >= 2);
check('FIX18 completion uses synchronous persistence', serviceText.includes('boolean completionPersisted = prefs.edit()') && serviceText.includes('.putString("gtoTripIntegrityStatus", "COMPLETION_PERSISTED")'));
check('FIX18 queue envelope/checksum present', syncText.includes('NVU_GTO_QUEUE_V2') && syncText.includes('MessageDigest.getInstance("SHA-256")'));
check('FIX18 quarantine preserves malformed queue data', syncText.includes('nvu_gto_auto_trip_quarantine_v2') && syncText.includes('quarantine(context, queue'));
check('FIX17 pending queue migration retained', syncText.includes('Raw FIX17 payload') && syncText.includes('if (record.legacy)'));
check('local dequeue requires validated FIX18 ACK', syncText.includes('responseContract < CONTRACT_VERSION') && syncText.indexOf('responseContract < CONTRACT_VERSION') < syncText.indexOf('queue.edit().remove(key).commit()'));
check('fresh-session reset protects unsealed completed delivery', serviceText.includes('preserveCompletedTripBeforeReset()') && serviceText.includes('nova viagem bloqueada'));
check('abandoned session snapshots are cleaned explicitly', syncText.includes('discardSessionSnapshot') && serviceText.includes('discardSessionSnapshot(this, prefs.getString("gtoTripSessionId", ""))'));
check('plugin exposes FIX18 integrity and sync status', pluginText.includes('gtoTripIntegrityStatus') && pluginText.includes('gtoTripSyncStatus') && pluginText.includes('gtoContractVersion'));
check('web bridge exposes FIX18 status', webText.includes('gtoTripIntegrityStatus') && webText.includes('gtoContractVersion'));
check('canonical backend is modular gtoTrips export', backendIndexText.includes('export { registerGtoTrip } from "./gtoTrips"'));
check('server idempotency validates payload fingerprint', backendText.includes('gtoPayloadFingerprint') && backendText.includes('existingFingerprint !== payloadFingerprint'));
check('server validates vehicle/trailer operation drift', backendText.includes('O veículo da operação mudou desde o início da viagem GTO.') && backendText.includes('O reboque da operação mudou desde o início da viagem GTO.'));
check('server validates FIX18 timestamp', backendText.includes('clientContractVersion >= 18 && completedAtClient === null'));
check('server returns FIX18 exact-session ACK', backendText.includes('contractVersion: 18') && backendText.includes('success: true') && backendText.includes('sessionId,'));
check('server and Android use us-central1', backendText.includes('functions.region("us-central1").https.onCall') && syncText.includes('FirebaseFunctions.getInstance("us-central1")'));
check('Firebase predeploy builds Functions', firebaseText.includes('npm --prefix functions run build'));
check('delivery package contains no root node_modules', !fs.existsSync('node_modules'));
check('delivery package contains no Functions node_modules', !fs.existsSync('functions/node_modules'));
const nestedPackages = [];
for (const path of ['app/package.json', 'project/package.json', 'workspace/package.json', 'src/package.json', 'android/package.json']) {
  if (fs.existsSync(path)) nestedPackages.push(path);
}
check('no duplicated application root package detected', nestedPackages.length === 0, nestedPackages.join(', '));

run('native GTO regression validator', process.execPath, ['scripts/validate-gto-native-flow.mjs']);
run('FIX18 Android/backend contract validator', process.execPath, ['scripts/validate-gto-auto-sync.mjs']);
run('project preflight', process.execPath, ['scripts/preflight.mjs', '--full']);

const failed = checks.filter((item) => !item.ok);
const passed = checks.length - failed.length;
const report = [
  'NVU GTO FIX18 — LOCAL CAPACITOR FINAL AUTOMATED AUDIT',
  '======================================================',
  `Result: ${passed}/${checks.length} checks passed`,
  '',
  ...checks.map((item) => `${item.ok ? 'PASS' : 'FAIL'} | ${item.name}${item.detail ? ` | ${item.detail}` : ''}`),
  '',
  'Command summary:',
  ...commandLogs.map((item) => `${item.status === 0 ? 'PASS' : 'FAIL'} | ${item.command} | exit=${item.status}`),
  '',
  'Environment note:',
  '- node_modules is intentionally excluded from the delivery ZIP.',
  '- Run npm install/npm ci before build or Capacitor sync.',
  '- Firebase Functions in this local package mirror the canonical AI Studio backend to prevent contract drift.',
  '- Publish Firebase from the AI Studio/Netlify package as the official source.',
  '',
].join('\n');
fs.writeFileSync('GTO_FIX18_FINAL_AUTOMATED_AUDIT.txt', report);

console.log(`\n${passed}/${checks.length} final FIX18 audit checks passed.`);
if (failed.length) process.exit(1);
