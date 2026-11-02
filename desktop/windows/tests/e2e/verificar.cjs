// Windows-only: Verificar-NVU.ps1 exactly as a person runs it, against the real installer and manifest of this build.
//   node verificar.cjs --dir <folder with NVU-PRO-Setup-*-x64.exe and release-manifest.json> --out <dir> [--expect unsigned|signed] [--script <Verificar-NVU.ps1>]
// Covers: the right-click "Executar com o PowerShell" shape on Windows PowerShell 5.1, the -File form on 5.1 and on PowerShell 7,
// missing manifest, missing installer and a downloaded file that was altered (one byte more, one byte flipped).
// Only ASCII fragments of the messages are asserted, because a redirected Windows PowerShell 5.1 writes the OEM code page.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { newReport, arg } = require('./lib.cjs');
const { windowsPowerShellEnv } = require('../../core/powershell-env.cjs');

const dir = path.resolve(arg('dir', '')), out = path.resolve(arg('out', 'artifacts/e2e')), expect = arg('expect', 'unsigned');
const scriptSource = path.resolve(arg('script', path.join(__dirname, '../../installer/Verificar-NVU.ps1')));
const signed = expect === 'signed';
const verdict = signed ? { code: 0, signature: /Assinatura digital: Valid/ } : { code: 3, signature: /Assinatura digital: NotSigned/ };

function find(root, test) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) { const hit = find(full, test); if (hit) return hit; }
    else if (test(entry.name)) return full;
  }
  return null;
}
const installerSource = find(dir, name => /^NVU-PRO-Setup-.*-x64\.exe$/.test(name));
const manifestSource = find(dir, name => name === 'release-manifest.json');
if (!installerSource || !manifestSource) { console.error(`installer or manifest not found under ${dir}`); process.exit(2); }

const work = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'nvu-verificar-'));
const installer = path.join(work, path.basename(installerSource)), manifest = path.join(work, 'release-manifest.json'), script = path.join(work, 'Verificar-NVU.ps1');
fs.copyFileSync(installerSource, installer); fs.copyFileSync(manifestSource, manifest); fs.copyFileSync(scriptSource, script);
const originalSize = fs.statSync(installer).size;

function run(exe, args, env, input = '') {
  const result = spawnSync(exe, args, { encoding: 'utf8', timeout: 180000, windowsHide: true, env, input, cwd: work });
  return { code: result.status, out: `${result.stdout || ''}${result.stderr || ''}`, error: result.error ? String(result.error.message) : '' };
}
const ps51 = (args, input) => run('powershell.exe', ['-NoProfile', ...args], windowsPowerShellEnv(), input);
const ps7 = (args, input) => run('pwsh', ['-NoProfile', ...args], process.env, input);
const fileForm = (...extra) => ['-ExecutionPolicy', 'Bypass', '-File', script, '-NoPause', ...extra];
function must(label, condition, result) {
  if (!condition) throw Error(`${label}\n--- exit ${result.code} ${result.error}\n${result.out.slice(0, 1500)}`);
}
const report = newReport(`verificar-${expect}`);

(async () => {
  await report.step('Right-click "Executar com o PowerShell" (Windows PowerShell 5.1, execution policy lowered for the process only, no -NoPause): size and SHA-256 match, signature verdict shown, the window does not hang', () => {
    const command = `if((Get-ExecutionPolicy) -ne 'AllSigned') { Set-ExecutionPolicy -Scope Process Bypass }; & '${script}'; exit $LASTEXITCODE`;
    const r = ps51(['-Command', command], '\r\n');
    must('verdict', r.code === verdict.code && /OK: tamanho e SHA-256 conferem/.test(r.out) && verdict.signature.test(r.out), r);
    return { exit: r.code, signedExpected: signed };
  });
  await report.step('Windows PowerShell 5.1, -File -NoPause (automation form): same verdict and exit code', () => {
    const r = ps51(fileForm());
    must('verdict', r.code === verdict.code && /OK: tamanho e SHA-256 conferem/.test(r.out) && verdict.signature.test(r.out), r);
    if (signed) must('signer shown', /Editor: CN=/.test(r.out), r);
    return { exit: r.code };
  });
  await report.step('PowerShell 7, -File -NoPause: same verdict and exit code', () => {
    const r = ps7(fileForm());
    must('verdict', r.code === verdict.code && /OK: tamanho e SHA-256 conferem/.test(r.out) && verdict.signature.test(r.out), r);
    return { exit: r.code };
  });
  await report.step('release-manifest.json missing: only a warning, the SHA-256 is still shown', () => {
    fs.renameSync(manifest, `${manifest}.off`);
    try {
      const r = ps51(fileForm());
      must('warning', r.code === verdict.code && /Aviso: release-manifest\.json n/.test(r.out) && /SHA-256 : [0-9a-f]{64}/.test(r.out), r);
      return { exit: r.code };
    } finally { fs.renameSync(`${manifest}.off`, manifest); }
  });
  await report.step('Installer not found: clear message and exit code 2', () => {
    const r = ps51(fileForm('-Installer', path.join(work, 'nao-existe.exe')));
    must('not found', r.code === 2 && /Instalador n/.test(r.out), r);
    return { exit: r.code };
  });
  await report.step('Downloaded file with one extra byte (incomplete/altered download): refused, exit code 1', () => {
    fs.appendFileSync(installer, Buffer.from([0]));
    const r = ps51(fileForm());
    must('size mismatch', r.code === 1 && /FALHA: o tamanho n/.test(r.out) && !/OK: tamanho/.test(r.out), r);
    return { exit: r.code };
  });
  await report.step('Downloaded file with one byte flipped (same size): refused by the SHA-256, exit code 1', () => {
    fs.truncateSync(installer, originalSize);
    const fd = fs.openSync(installer, 'r+'), one = Buffer.alloc(1);
    try { fs.readSync(fd, one, 0, 1, 4096); one[0] ^= 0xff; fs.writeSync(fd, one, 0, 1, 4096); } finally { fs.closeSync(fd); }
    const r = ps7(fileForm());
    must('hash mismatch', r.code === 1 && /FALHA: o SHA-256 n/.test(r.out) && !/OK: tamanho/.test(r.out), r);
    return { exit: r.code };
  });
  fs.rmSync(work, { recursive: true, force: true });
  report.save(path.join(out, `verificar-${expect}.json`)); process.exitCode = report.ok ? 0 : 1;
})().catch(error => { console.error(error); report.ok = false; report.save(path.join(out, `verificar-${expect}.json`)); process.exitCode = 1; });
