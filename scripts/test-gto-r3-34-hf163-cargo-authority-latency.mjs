import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const javaRoot = path.join(root, 'android/app/src/main/java/com/nvu/operacional');
const servicePath = path.join(javaRoot, 'GtoObserverService.java');
const syncPath = path.join(javaRoot, 'GtoAutoTripSync.java');
const statusPath = path.join(javaRoot, 'GtoFreightFieldStatusPolicy.java');
const authorityPath = path.join(javaRoot, 'GtoCargoAuthorityPolicy.java');
const testPath = path.join(root, 'scripts/java-tests/com/nvu/operacional/GtoHf163CargoAuthorityTest.java');

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  passed += 1;
  console.log(`PASS: ${message}`);
}
function read(file) {
  return fs.readFileSync(file, 'utf8');
}
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

const service = read(servicePath);
const serviceCode = withoutComments(service);
const authority = read(authorityPath);
const sync = read(syncPath);
const status = read(statusPath);

check(fs.existsSync(authorityPath), 'política source-bound da Carga existe');
check(/resolvePauseCargo\s*\(/.test(authority), 'a autoridade Pause da Carga é uma função pura');
check(/LIST_SAME_ROW_PRESERVED_OVER_PAUSE_OCR/.test(authority), 'divergência Soja/Sojo preserva a Lista e vira diagnóstico');
check(/pauseReads\s*>=\s*2/.test(authority), 'Pause sem autoridade same-row exige duas leituras');
check(!/replace\s*\(\s*["']Sojo["']\s*,\s*["']Soja["']\s*\)/.test(withoutComments(authority)), 'não há substituição ortográfica global Sojo→Soja');
check(!/replaceAll\s*\([^;]*(Sojo|Soja)/.test(withoutComments(authority)), 'a política não usa regex para corrigir grafia de Carga');

const mergeNeedle = /FreightOption\s+reconciledSameRow\s*=\s*mergeVerifiedPreciseWithStable\s*\(\s*selected\s*,\s*stableSamePage\s*\)/s;
const directNeedle = /canPromoteHumanBackedSelectedRowDirectly\s*\(\s*reconciledSameRow\s*,\s*stableSamePage\s*,\s*knownDestinationVerification\s*\)/s;
check(mergeNeedle.test(serviceCode), 'a seleção reconcilia a candidata com a baseline before direct promotion');
check(directNeedle.test(serviceCode), 'a promoção direta usa a candidata reconciliada');
check(serviceCode.search(mergeNeedle) >= 0 && serviceCode.search(mergeNeedle) < serviceCode.search(directNeedle), 'merge same-row ocorre antes da barreira final da Lista');
check(/cargoListSameRowAuthority\s*=\s*true/.test(serviceCode), 'a autoridade same-row da Carga é marcada somente após evidência da Lista');
check(/selectedCargoListSameRowAuthority/.test(serviceCode) && /reviewCargoListSameRowAuthority/.test(serviceCode), 'a autoridade da Carga atravessa seleção, revisão e restauração');
check(/cargoListSameRowAuthority/.test(sync), 'o lock durável projeta a autoridade same-row da Carga');
check(/cargoListSameRowAuthority/.test(serviceCode.match(/private FreightOption freightReviewFromPrefs\(\)[\s\S]*?\n    private /)?.[0] ?? ''), 'a restauração do draft lê autoridade same-row');
check(/resolvePauseCargo\s*\(/.test(serviceCode) && /pauseCargoRawOcr/.test(serviceCode), 'Pause resolve autoridade e preserva OCR divergente apenas para diagnóstico');
check(/current\.cargoListSameRowAuthority[\s\S]*?sameLiteral\(current\.cargo, pause\.cargo\)/.test(serviceCode), 'Pause bloqueia sobrescrita de Carga same-row divergente');
check(/PAUSE_PROMPT_DELAY_MS\s*=\s*320L/.test(service), 'atraso inicial do prompt foi reduzido para debounce curto');
check(/PAUSE_OCR_INTERVAL_MS\s*=\s*180L/.test(service), 'intervalo do OCR Pause foi reduzido com serialização mantida');
check(/PAUSE_SCREEN_CONFIRM_FRAMES\s*=\s*1/.test(service), 'primeira superfície Pause confirmada não aguarda frame redundante');
check(/lastPauseOcrAt\s*=\s*0L/.test(service), 'remoção de overlay não cobra novo intervalo artificial');
check(/f\.cargoSelectedRowEvidence\s*\|\|\s*f\.cargoListSameRowAuthority/.test(service), 'status diagnóstico considera somente evidência da Carga');
check(/selectedCargoListSameRowAuthority/.test(service) && /\.remove\("selectedCargoListSameRowAuthority"\)/.test(service), 'autoridade same-row é removida na troca/limpeza do frete');
check(/\.remove\("reviewCargoListSameRowAuthority"\)/.test(service), 'autoridade same-row é removida na limpeza da revisão');
check(!/replace\s*\(\s*["']Soja["']\s*,\s*["']Sojo["']\s*\)/.test(serviceCode), 'serviço não inverte Soja/Sojo por substituição textual');
check(/GtoCargoAuthorityPolicy\.resolvePauseCargo/.test(serviceCode), 'o serviço não decide grafia de Carga fora da política de autoridade');
check(/GtoCargoAuthorityPolicy\.valid\(savedCargo\)/.test(serviceCode), 'restauração de Carga exige texto válido e identidade same-session/same-row');
check(/savedSameSession/.test(serviceCode) && /savedSameRow/.test(serviceCode), 'restauração verifica sessão e linha antes de reutilizar Carga');
check(status.includes('requiredWithEvidence') && status.includes('selectedRowEvidence'), 'status puro aceita evidência da mesma linha explicitamente');

const out = '/tmp/hf163-cargo-authority-gate-classes';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const javaFiles = [
  'GtoMoneyValue.java',
  'GtoFreightTextGuard.java',
  'GtoManualRouteSelectionPolicy.java',
  'GtoFreightReviewPolicy.java',
  'GtoFreightFieldEvidencePolicy.java',
  'GtoFreightListTextAuthorityPolicy.java',
  'GtoCargoConsensusPolicy.java',
  'GtoCargoAuthorityPolicy.java',
  'GtoFreightFieldStatusPolicy.java',
].map((name) => path.join(javaRoot, name));
const compile = spawnSync('javac', ['-encoding', 'UTF-8', '-d', out, ...javaFiles, testPath], { encoding: 'utf8' });
check(compile.status === 0, `fixture Java HF163 compila${compile.stderr ? `: ${compile.stderr.trim()}` : ''}`);
const run = spawnSync('java', ['-cp', out, 'com.nvu.operacional.GtoHf163CargoAuthorityTest'], { encoding: 'utf8' });
if (run.stdout) process.stdout.write(run.stdout);
check(run.status === 0, 'fixture Java HF163 passa integralmente');
console.log(`HF163 cargo authority/latency check: ${passed} checks passed`);
