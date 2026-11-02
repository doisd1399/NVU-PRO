const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip');
const asar = require('@electron/asar');
const { verifyNsisInstaller } = require('./tools/nsis-integrity.cjs');
const { verifyPlugin } = require('./tools/plugin-integrity.cjs');
const { copyVerifiedFile } = require('./tools/verified-copy.cjs');
const config = require('./package.json');
const root = path.resolve(__dirname, '../..'), out = path.join(root, 'artifacts/windows');
function run(exe, args, cwd) {
  const result = spawnSync(exe, args, { cwd, stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) throw result.error || Error('WINDOWS_ZIP_BUILD_FAILED');
}
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function filesIn(dir, prefix = '') {
  return fs.readdirSync(path.join(dir, prefix), { withFileTypes: true }).flatMap(entry => {
    const name = path.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw Error('WINDOWS_ZIP_SYMLINK_REJECTED');
    return entry.isDirectory() ? filesIn(dir, name) : [name];
  });
}
async function build() {
  verifyPlugin(path.join(__dirname, 'plugin/bin/nvu_scs_telemetry.dll'));
  const unpacked = path.join(out, 'win-unpacked'), archive = path.join(unpacked, 'resources/app.asar');
  assert.equal(JSON.parse(asar.extractFile(archive, 'package.json')).version, config.version, 'Rebuild the Windows application before packaging');
  for (const file of ['main.cjs', 'preload.cjs', ...['core', 'ui', 'config'].flatMap(dir => filesIn(path.join(__dirname, dir)).map(file => path.join(dir, file)))])
    assert.deepEqual(asar.extractFile(archive, file.split(path.sep).join('/')), fs.readFileSync(path.join(__dirname, file)), file);
  for (const file of filesIn(path.join(root, 'dist')))
    assert.deepEqual(fs.readFileSync(path.join(root, 'dist', file)), fs.readFileSync(path.join(unpacked, 'resources/web', file)), file);
  assert.deepEqual(fs.readFileSync(path.join(__dirname, 'plugin/bin/nvu_scs_telemetry.dll')), fs.readFileSync(path.join(unpacked, 'resources/plugin/nvu_scs_telemetry.dll')));
  const installer = path.join(out, `NVU-PRO-Windows-${config.version}-x64-Setup.exe`);
  const integrity = fs.existsSync(installer) ? verifyNsisInstaller(fs.readFileSync(installer)) : null;
  const seven = await getPath7za(), stage = fs.mkdtempSync(path.join(out, 'zip-stage-'));
  const zipFiles = [];
  async function zip(name, folder, compression) {
    const target = path.join(out, name), temporary = target + '.new.zip';
    fs.rmSync(temporary, { force: true });
    run(seven, ['a', '-tzip', `-mx=${compression}`, '-mmt=2', temporary, folder], stage);
    run(seven, ['t', temporary], stage);
    await copyVerifiedFile(temporary, target);
    run(seven, ['t', target], stage);
    fs.unlinkSync(temporary);
    fs.writeFileSync(target + '.sha256', `${digest(target)}  ${name}\n`);
    zipFiles.push({ name, bytes: fs.statSync(target).size, sha256: digest(target) });
  }
  try {
    const appFolder = `NVU-PRO-Windows-${config.version}`;
    fs.cpSync(unpacked, path.join(stage, appFolder), { recursive: true });
    fs.writeFileSync(path.join(stage, appFolder, 'LEIA-ME.txt'), `NVU PRO Windows ${config.version} — versão sem instalação\r\n\r\nExtraia TODO o ZIP para uma pasta do seu usuário. Abra NVU PRO.exe dentro dessa pasta, mantendo todos os arquivos e a pasta resources juntos.\r\nEntre com a conta Google que já usa na NVU. O cliente OAuth Desktop acompanha esta edição.\r\nEsta edição exige plugin 0.1.4. Feche o simulador, atualize o plugin em PRO → Simuladores e reabra o jogo. Preserve dados e pendências.\r\nSem botão flutuante. Ctrl+N abre/oculta o assistente. Todas as ações usam mouse. Sol/lua altera o tema. A camada aberta recebe o mouse na área útil do monitor; oculte para retornar aos controles do jogo. Avisos no topo não tomam o foco.\r\nA sessão e as pendências continuam em %APPDATA%\\NVU PRO. Esta edição usa os mesmos dados da aplicação instalada.\r\nCandidata a validação no Windows e nos jogos reais; sem assinatura digital.\r\n`);
    await zip(`NVU-PRO-Windows-${config.version}-x64-Portable.zip`, appFolder, 5);
    if (integrity) {
      const setupFolder = `NVU-Instalador-${config.version}`;
      fs.mkdirSync(path.join(stage, setupFolder));
      fs.copyFileSync(installer, path.join(stage, setupFolder, 'NVU-Setup.exe'));
      fs.writeFileSync(path.join(stage, setupFolder, 'SHA256.txt'), `${integrity.sha256}  NVU-Setup.exe\r\n`);
      fs.writeFileSync(path.join(stage, setupFolder, 'LEIA-ME.txt'), `NVU PRO Windows ${config.version}\r\n\r\nExtraia TODO o ZIP e execute NVU-Setup.exe.\r\nTamanho esperado do EXE: ${integrity.bytes} bytes.\r\nSHA-256: ${integrity.sha256}\r\n\r\nNo PowerShell, confira: Get-FileHash .\\NVU-Setup.exe -Algorithm SHA256\r\nO CRC interno do NSIS foi validado antes de criar este ZIP. Se a extração falhar, o download não está íntegro. Se o EXE extraído continuar dando erro, envie o arquivo efetivamente baixado ou o SHA-256 para diagnóstico.\r\nSem assinatura digital. Mantenha as verificações de segurança do Windows.\r\n`);
      await zip(`NVU-PRO-Windows-${config.version}-Instalador.zip`, setupFolder, 0);
    }
    fs.writeFileSync(path.join(out, 'zip-delivery.json'), JSON.stringify({ version: config.version, installer: integrity, files: zipFiles }, null, 2) + '\n');
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
build().catch(error => { console.error(error.message); process.exitCode = 1; });
