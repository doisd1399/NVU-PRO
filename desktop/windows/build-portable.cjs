const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip');
const asar = require('@electron/asar');
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
    fs.writeFileSync(path.join(stage, appFolder, 'LEIA-ME.txt'), `NVU PRO Windows ${config.version} — versão sem instalação\r\n\r\nExtraia TODO o ZIP para uma pasta do seu usuário. Abra NVU PRO.exe dentro dessa pasta, mantendo todos os arquivos e a pasta resources juntos.\r\nEntre com a conta Google que já usa na NVU. O cliente OAuth Desktop acompanha esta edição.\r\nFeche o simulador, use PRO → Simuladores → Preparar simulador e reabra o jogo. Preserve dados e pendências.\r\nSem botão flutuante. Ctrl+N abre/oculta o assistente. Todas as ações usam mouse. Sol/lua altera o tema. A camada aberta recebe o mouse na área útil do monitor; oculte para retornar aos controles do jogo. Avisos no topo não tomam o foco.\r\nA sessão e as pendências continuam em %APPDATA%\\NVU PRO. Esta edição usa os mesmos dados da aplicação instalada.\r\nSem assinatura digital enquanto não houver certificado configurado.\r\n`);
    await zip(`NVU-PRO-Windows-${config.version}-x64-Portable.zip`, appFolder, 5);
    fs.writeFileSync(path.join(out, 'zip-delivery.json'), JSON.stringify({ version: config.version, note: 'Secondary artifact. The main deliverable is NVU-PRO-Setup-<version>-x64.exe.', files: zipFiles }, null, 2) + '\n');
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
build().catch(error => { console.error(error.message); process.exitCode = 1; });
