import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const read = (p) => fs.readFileSync(p, 'utf8');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const checks = [];
const check = (name, ok, detail='') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const servicePath = 'android/app/src/main/java/com/nvu/operacional/GtoObserverService.java';
const resultGatePath = 'android/app/src/main/java/com/nvu/operacional/GtoResultVisualGate.java';
const pluginPath = 'android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java';
const webPath = 'src/components/GtoObserverSetup.tsx';
const bridgePath = 'src/lib/gtoObserver.ts';
const gradlePath = 'android/app/build.gradle';
const service = read(servicePath);
const gate = read(resultGatePath);
const plugin = read(pluginPath);
const web = read(webPath);
const bridge = read(bridgePath);
const gradle = read(gradlePath);
const bundledPath = fs.readdirSync('android/app/src/main/assets/public/assets')
  .map(x => `android/app/src/main/assets/public/assets/${x}`)
  .find(x => /\/RecordTrip-.*\.js$/.test(x));
const bundled = bundledPath ? read(bundledPath) : '';

const fastDetectorSource = read('android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java');
check('freight fast detector preserves OCR-free selection contract',
  fastDetectorSource.includes('PressCandidate')
    && fastDetectorSource.includes('detectButtons')
    && !fastDetectorSource.includes('TextRecognizer'));
check('selection coordinator remains byte-identical', sha('android/app/src/main/java/com/nvu/operacional/GtoSelectionCoordinator.java') === 'd84fe0848f5a054225cf939786156c07a291a4eb74a362ca9f72878d920b0ddd');
const syncSource = read('android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java');
check('automatic sync engine preserves durable/idempotent contract',
  syncSource.includes('QUEUE_PREFS')
    && syncSource.includes('sealPayload')
    && syncSource.includes('registerGtoTrip')
    && syncSource.includes('sessionId.equals(responseSession)')
    && syncSource.includes('STATUS_SYNCED'));
check('backend remains byte-identical to audited R2', sha('functions/src/gtoTrips.ts') === '5a4bc0d902dab4929d685d9cb953f20fc3e333a81d826132f8f98c9af4f1a908');
check('result visual gate is isolated from freight detector', fs.existsSync(resultGatePath) && service.includes('new GtoResultVisualGate()') && !gate.includes('TextRecognizer'));
check('active trip gets OCR-free result probe', service.includes('ACTIVE_TRIP_VISUAL_PROBE_MS') && service.includes('resultVisualGate.looksLikeResultDialog('));
check('result OCR has bounded slow fallback', service.includes('ACTIVE_TRIP_RESULT_FALLBACK_OCR_MS') && service.includes('tripFallbackOcrDue'));
check('result candidate still requires parseResultScreen OCR', service.includes('ResultScreen resultScreen = parseResultScreen(lines, normalized);') && service.includes('STATE_RESULT_DETECTED'));
check('freight list during route requires multi-frame confirmation', service.includes('ACTIVE_TRIP_FREIGHT_LIST_CONFIRM_FRAMES = 4') && service.includes('ACTIVE_TRIP_FREIGHT_LIST_CONFIRM_MS = 420L'));
check('in-game cancellation discards only unfinished session', service.includes('CANCELLED_IN_GAME') && service.includes('GtoAutoTripSync.discardSessionSnapshot(this, cancelledSessionId)'));
check('in-game cancellation prepares clean next freight session', service.includes('beginTrip(false)') && service.includes('FREIGHT_RESTART'));
check('completed result remains outside cancellation path', service.includes('private boolean isReplaceableActiveSessionState') && service.includes('STATE_RESULT_DETECTED.equals(state)') && service.includes('STATE_AWAITING_BONUS.equals(state)') && !service.slice(service.indexOf('private boolean isReplaceableActiveSessionState'), service.indexOf('private boolean hasRecentNormalResultActionEvidence')).includes('STATE_RESULT_CONFIRMED'));
check('driver gets stage 1 guidance', service.includes('Etapa 1/4 · Escolha um frete no GTO'));
check('driver gets route guidance', service.includes('Etapa 2/4 · Frete confirmado'));
check('driver gets result guidance', service.includes('Etapa 3/4 · Entrega detectada'));
check('driver gets automatic sync guidance', service.includes('Etapa 4/4 · Recebimento confirmado'));
check('floating menu always shows current journey guide', service.includes('currentJourneyGuide(state)'));
check('normal trip explains automatic completion without manual action', service.includes('Ao chegar ao destino, a NVU identificará a conclusão e registrará a viagem automaticamente.') && !service.includes('Verificar finalização agora'));
check('manual confirmation appears only as fallback', service.includes('resultConfirmationFallbackNeeded') && service.includes('Confirmar conclusão da entrega') && service.includes('AUTO_RESULT_FALLBACK_MISSES'));
check('native status exposes driver stage', plugin.includes('driverStageMessage') && bridge.includes('driverStageMessage?: string'));
check('web panel explains four-step automatic flow', web.includes('Fluxo: 1. escolher frete') && web.includes('Etapa atual:'));
check('future Android web bundle source carries flow guidance', web.includes('Fluxo: 1. escolher frete') && bridge.includes('driverStageMessage?: string'));
check('Android version is at least the R3 production baseline', /versionCode\s+(?:2[1-9]|[3-9]\d|\d{3,})/.test(gradle) && /versionName\s+"1\.0\.(?:2[1-9]|[3-9]\d|\d{3,})"/.test(gradle));
check('delivery tree has no node_modules', !fs.existsSync('node_modules') && !fs.existsSync('functions/node_modules'));

let bundledSyntaxOk = false;
if (bundledPath) {
  try {
    execFileSync(process.execPath, ['--check', bundledPath], { stdio: 'ignore' });
    bundledSyntaxOk = true;
  } catch {}
}
check('bundled RecordTrip JavaScript parses', bundledSyntaxOk, bundledPath || 'missing');

const failed = checks.filter(c => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} R3 guided automatic-flow checks passed.`);
if (failed.length) process.exit(1);
