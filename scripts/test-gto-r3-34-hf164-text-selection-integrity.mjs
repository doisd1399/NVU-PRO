import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const javaRoot = path.join(root, 'android/app/src/main/java/com/nvu/operacional');
const servicePath = path.join(javaRoot, 'GtoObserverService.java');
const pausePath = path.join(javaRoot, 'GtoPauseScreenDetectionPolicy.java');
const listPath = path.join(javaRoot, 'GtoFreightListTextAuthorityPolicy.java');
const evidencePath = path.join(javaRoot, 'GtoFreightFieldEvidencePolicy.java');
const cargoAuthorityPath = path.join(javaRoot, 'GtoCargoAuthorityPolicy.java');
const certifiedPath = path.join(javaRoot, 'GtoCertifiedFreight.java');
const syncPath = path.join(javaRoot, 'GtoAutoTripSync.java');
const detectorPath = path.join(javaRoot, 'GtoFastVisualDetector.java');
const testPath = path.join(root, 'scripts/java-tests/com/nvu/operacional/GtoHf164TextAuthorityAndSelectionTest.java');

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  passed += 1;
  console.log(`PASS: ${message}`);
}
function read(file) {
  check(fs.existsSync(file), `arquivo existe: ${path.basename(file)}`);
  return fs.readFileSync(file, 'utf8');
}
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

const service = read(servicePath);
const serviceCode = withoutComments(service);
const pause = read(pausePath);
const pauseCode = withoutComments(pause);
const list = read(listPath);
const evidence = read(evidencePath);
const cargoAuthority = read(cargoAuthorityPath);
const certified = read(certifiedPath);
const sync = read(syncPath);
const detector = read(detectorPath);

check(/resolvePauseCargo\s*\(/.test(cargoAuthority), 'autoridade pura da Carga existe');
check(/LIST_SAME_ROW_PRESERVED_OVER_PAUSE_OCR/.test(cargoAuthority), 'Soja same-row vence Sojo divergente');
check(!/replace\s*\(\s*["']Sojo["']\s*,\s*["']Soja["']/.test(cargoAuthority), 'política de Carga não contém correção ortográfica Sojo');
check(/textFromSameRowAuthority\s*\(/.test(evidence), 'evidência same-row é contrato explícito');
check(/canPromoteSameRow\s*\(/.test(list), 'Lista possui rota estreita same-row');
check(/canDirectPromote\s*\(/.test(list), 'barreira genérica da Lista permanece disponível');
check(/hasCompleteSameRowIndependentEvidence\s*\(/.test(serviceCode), 'serviço exige prova completa de cinco campos');
check(/mergeVerifiedPreciseWithStable\s*\(\s*selected\s*,\s*stableSamePage\s*\)/s.test(serviceCode), 'candidata é reconciliada com a baseline da mesma linha');
check(/hasCompleteSameRowIndependentEvidence\s*\(\s*selected\s*,\s*stableSamePage\s*\)/s.test(serviceCode), 'autoridade same-row só nasce após prova independente');
check(/canPromoteSameRow\s*\(/.test(serviceCode), 'barreira final usa a rota same-row explicitamente');
check(/cargoListSameRowAuthority/.test(certified) && /cargoSelectedRowEvidence/.test(certified), 'selo projeta proveniência da Carga');
check(/cargoListSameRowAuthority/.test(sync) && /selectedCargoListSameRowAuthority/.test(sync), 'lock/snapshot preservam proveniência da Carga');
check(/cargoListSameRowAuthority/.test(serviceCode) && /reviewCargoListSameRowAuthority/.test(serviceCode), 'revisão restaura somente autoridade persistida');
check(/Never derive a registered field from the normalized detection string/.test(pause), 'fallback normalizado não gera valor registrado');
check(!/return\s+normalized\.substring/.test(pauseCode), 'Pause não devolve sufixo normalizado como texto visível');
check(/return\s+""\s*;/.test(pauseCode), 'Pause retorna pendência quando o rótulo bruto não é encontrado');
check(/exactConsistentRowForTouch/.test(serviceCode) && /bestCount\s*>\s*secondCount/.test(serviceCode), 'coordenadas usam maioria inequívoca');
check(/rawHit\s*>=\s*0\s*&&\s*rawHit\s*==\s*localHit/.test(serviceCode), 'raw/local concordantes têm prioridade');
check(/return\s+bestCount\s*>\s*secondCount\s*\?\s*bestRow\s*:\s*-1/.test(serviceCode), 'empate de coordenadas continua fail-closed');
check(/detectPressedRowAfterTouch/.test(detector) && /detectTemporarilyMissingPressedRowAfterTouch/.test(detector), 'seleção cobre frame pressionado e frame N-1');
const samePageBody = detector.match(/boolean\s+samePage\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*\}\s*\n\s*float\s+pageDistance/)?.[1] ?? '';
check(!/return\s+true\s*;/.test(samePageBody), 'detector não contém bypass amplo de página');
check(!/replace\s*\(\s*["']Soja["']\s*,\s*["']Sojo["']\s*\)/.test(serviceCode), 'serviço não inverte Soja/Sojo');

const out = '/tmp/hf164-text-selection-integrity-classes';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const javaFiles = [
  'GtoMoneyValue.java',
  'GtoManualRouteSelectionPolicy.java',
  'GtoFreightReviewPolicy.java',
  'GtoFreightTextGuard.java',
  'GtoAcceptedFreightFieldPolicy.java',
  'GtoDestinationTextAuthorityPolicy.java',
  'GtoCityTextResolver.java',
  'GtoFreightFieldEvidencePolicy.java',
  'GtoFreightListTextAuthorityPolicy.java',
  'GtoCargoConsensusPolicy.java',
  'GtoCargoAuthorityPolicy.java',
  'GtoFreightSelectionPolicy.java',
].map((name) => path.join(javaRoot, name));
const compile = spawnSync('javac', ['-encoding', 'UTF-8', '-d', out, ...javaFiles, testPath], { encoding: 'utf8' });
check(compile.status === 0, `fixture Java HF164 compila${compile.stderr ? `: ${compile.stderr.trim()}` : ''}`);
const run = spawnSync('java', ['-cp', out, 'com.nvu.operacional.GtoHf164TextAuthorityAndSelectionTest'], { encoding: 'utf8' });
if (run.stdout) process.stdout.write(run.stdout);
if (run.stderr) process.stderr.write(run.stderr);
check(run.status === 0, 'fixture Java HF164 passa integralmente');
console.log(`HF164 text/selection integrity check: ${passed} checks passed`);

function detectorCodeForNoBroadBypass(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}
