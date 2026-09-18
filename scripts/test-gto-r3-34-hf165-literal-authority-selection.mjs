import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const javaRoot = path.join(root, 'android/app/src/main/java/com/nvu/operacional');
const servicePath = path.join(javaRoot, 'GtoObserverService.java');
const syncPath = path.join(javaRoot, 'GtoAutoTripSync.java');
const authorityPath = path.join(javaRoot, 'GtoCargoAuthorityPolicy.java');
const consensusPath = path.join(javaRoot, 'GtoCargoConsensusPolicy.java');
const guardPath = path.join(javaRoot, 'GtoFreightTextGuard.java');
const certifiedPath = path.join(javaRoot, 'GtoCertifiedFreight.java');
const pausePath = path.join(javaRoot, 'GtoPauseScreenDetectionPolicy.java');
const fixturePath = path.join(root, 'scripts/java-tests/com/nvu/operacional/GtoHf165LiteralFreightIntegrityTest.java');

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
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

const service = read(servicePath);
const serviceCode = code(service);
const sync = read(syncPath);
const authority = read(authorityPath);
const consensus = read(consensusPath);
const guard = read(guardPath);
const certified = read(certifiedPath);
const pause = read(pausePath);

check(/sameLiteralText\s*\(/.test(guard), 'guard possui comparação literal explícita');
check(/sameLiteralText\s*\(/.test(consensus), 'consenso da Carga usa igualdade literal');
check(/sameLiteralText\s*\(/.test(authority), 'autoridade da Carga usa igualdade literal');
check(/return\s+new\s+Resolution\("",\s*false,\s*false,\s*"PAUSE_PENDING"\)/.test(authority), 'candidato Pause pendente não vira valor operacional');
check(!/replace\s*\(\s*["']Sojo["']\s*,\s*["']Soja["']/.test(code(authority)), 'não existe correção ortográfica Sojo→Soja');
check(/resolvePauseCargo\s*\(/.test(serviceCode) && /if\s*\(!cargoResolution\.accepted\)\s*return\s+null/.test(serviceCode), 'Pause bloqueia Carga não confirmada');
check(/pauseCargoRawOcr/.test(serviceCode) && /cargoResolution\.conflict\s*\|\|\s*!cargoResolution\.accepted/.test(serviceCode), 'OCR divergente fica somente no diagnóstico');
check(/mergeVerifiedPreciseWithStable\s*\(\s*selected\s*,\s*stableSamePage\s*\)/s.test(serviceCode), 'Lista reconcilia a linha tocada com a baseline da mesma linha');
check(/hasCompleteSameRowIndependentEvidence\s*\(\s*selected\s*,\s*stableSamePage\s*\)/s.test(serviceCode), 'autoridade completa exige prova independente dos campos');
check(/directSelectedRowEvidence/.test(serviceCode) && /cargoListSameRowAuthority/.test(serviceCode), 'promoção e Carga usam marcadores distintos');
check(/LIST_CARGO_SAME_ROW/.test(serviceCode), 'proveniência de Carga same-row é preservada separadamente');
check(/reviewCargoSource/.test(serviceCode) && /LIST_SAME_ROW/.test(serviceCode), 'revisão restaura a fonte da Carga');
check(/selectedCargoSelectedRowEvidence/.test(serviceCode), 'seleção persiste evidência de Carga');
check(/preciseSelectionOcrGeneration\+\+/.test(serviceCode) && /pendingSelectionTransaction\.close\(\)/.test(serviceCode), 'novo toque invalida OCR/transação anterior');
check(/candidate\.optString\("origin",\s*""\)/.test(sync) && /existingOrigin\.isEmpty\(\)/.test(sync), 'lock não reescreve Origem já preenchida');
check(/clean\(candidate\.optString\("destination",\s*""\)\)\.isEmpty\(\)/.test(sync), 'lock só recompõe Destino quando vazio');
check(/cargoSourceBoundEvidence/.test(sync) && /LIST_CARGO_SAME_ROW/.test(sync), 'lock reconhece apenas evidência source-bound da Carga');
check(/cargoSelectedRowEvidence/.test(sync) && /selectedCargoSelectedRowEvidence/.test(sync), 'snapshot e restauração transportam evidência da Carga');
check(/cargoSelectedRowEvidence/.test(certified) && /evidenceFingerprint/.test(certified), 'selo inclui proveniência no payload/fingerprint');
check(/return\s+""\s*;/.test(code(pause)), 'Pause retorna pendência sem rótulo bruto');
check(!/return\s+normalized\.substring/.test(code(pause)), 'Pause não registra substring normalizada');
check(/resetTransientFreightSelectionState\s*\(/.test(serviceCode), 'seleção inicia reset transacional');
check(!/return\s+true\s*;/.test((code(read(path.join(javaRoot, 'GtoFastVisualDetector.java'))).match(/boolean\s+samePage\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*\}\s*\n\s*float\s+pageDistance/) || [])[1] || ''), 'samePage não possui bypass amplo');

const out = '/tmp/hf165-literal-authority-classes';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const javaFiles = [
  'GtoMoneyValue.java',
  'GtoFreightTextGuard.java',
  'GtoManualRouteSelectionPolicy.java',
  'GtoFreightReviewPolicy.java',
  'GtoCargoConsensusPolicy.java',
  'GtoCargoAuthorityPolicy.java',
].map((name) => path.join(javaRoot, name));
const compile = spawnSync('javac', ['-encoding', 'UTF-8', '-d', out, ...javaFiles, fixturePath], { encoding: 'utf8' });
check(compile.status === 0, `fixture Java HF165 compila${compile.stderr ? `: ${compile.stderr.trim()}` : ''}`);
const run = spawnSync('java', ['-cp', out, 'com.nvu.operacional.GtoHf165LiteralFreightIntegrityTest'], { encoding: 'utf8' });
if (run.stdout) process.stdout.write(run.stdout);
if (run.stderr) process.stderr.write(run.stderr);
check(run.status === 0, 'fixture Java HF165 passa integralmente');
console.log(`HF165 literal authority/selection check: ${passed} checks passed`);
