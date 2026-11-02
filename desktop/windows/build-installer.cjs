'use strict';
// Builds the ONE main Windows installer: NVU-PRO-Setup-<version>-x64.exe.
//   1. electron-builder → win-unpacked (icon + version resources, no signing by electron-builder itself)
//   2. checks of the unpacked tree against the sources (asar, web, plugin + manifest)
//   3. optional Authenticode signing of NVU PRO.exe and the plugin DLL, then the plugin manifest is regenerated from the signed bytes
//   4. NSIS compilation (installer/nvu.nsi), optional signing of the installer (and of the uninstaller on a Windows host)
//   5. verification of the FINAL file: NSIS CRC + Authenticode layout, payload extraction with 7-Zip and byte comparison with step 2
//   6. release-manifest.json + SHA256SUMS.txt computed from the final bytes
// It runs on Windows (CI) and on Linux; on Linux the uninstaller cannot be signed at build time and the result says so.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows');
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip');
const asar = require('@electron/asar');
const pkg = require('./package.json');
const { verifyNsisInstaller } = require('./tools/nsis-integrity.cjs');
const { verifyPlugin } = require('./tools/plugin-integrity.cjs');
const { writePluginManifest } = require('./tools/plugin-manifest.cjs');
const { signFiles, signingConfig, verifySignature } = require('./tools/sign.cjs');
const { describeArtifact, fingerprint } = require('./tools/release-manifest.cjs');

const version = pkg.version, pluginVersion = pkg.nvu.pluginVersion;
const root = path.resolve(__dirname, '../..'), out = path.resolve(__dirname, '../../artifacts/windows'), unpacked = path.join(out, 'win-unpacked');
const filename = `NVU-PRO-Setup-${version}-x64.exe`, output = path.join(out, filename);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function run(file, args, env = process.env, options = {}) {
  const r = spawnSync(file, args, { stdio: 'inherit', env, shell: false, cwd: __dirname, ...options });
  if (r.error || r.status !== 0) throw r.error || Error(`Build failed (${r.status}): ${path.basename(file)}`);
}
function filesIn(dir, relative = '') {
  return fs.readdirSync(path.join(dir, relative), { withFileTypes: true }).flatMap(entry => {
    const name = path.join(relative, entry.name); if (entry.isSymbolicLink()) throw Error('INSTALLER_SYMLINK_NOT_ALLOWED');
    return entry.isDirectory() ? filesIn(dir, name) : [name];
  });
}
const nsisEscape = s => s.replace(/\$/g, '$$$$').replace(/"/g, '$\\"');
const win = name => nsisEscape(name.split(path.sep).join('\\'));
const unicodeContains = (bytes, text) => bytes.includes(Buffer.from(text, 'utf16le'));

function checkUnpacked(files) {
  for (const required of ['NVU PRO.exe', path.join('resources', 'app.asar'), path.join('resources', 'web', 'index.html'), path.join('resources', 'plugin', 'nvu_scs_telemetry.dll'), path.join('resources', 'plugin', 'nvu_scs_telemetry.manifest.json')])
    if (!files.includes(required)) throw Error(`INSTALLER_CONTENT_INCOMPLETE: ${required}`);
  const archive = path.join(unpacked, 'resources/app.asar');
  assert.equal(JSON.parse(asar.extractFile(archive, 'package.json')).version, version, 'Rebuild the Windows application: app.asar has another version');
  for (const file of ['main.cjs', 'preload.cjs', ...['core', 'ui', 'config'].flatMap(dir => filesIn(path.join(__dirname, dir)).map(f => path.join(dir, f)))])
    assert.deepEqual(asar.extractFile(archive, file.split(path.sep).join('/')), fs.readFileSync(path.join(__dirname, file)), `app.asar differs from source: ${file}`);
  for (const file of filesIn(path.join(root, 'dist')))
    assert.deepEqual(fs.readFileSync(path.join(root, 'dist', file)), fs.readFileSync(path.join(unpacked, 'resources/web', file)), `web differs from dist: ${file}`);
  const exe = fs.readFileSync(path.join(unpacked, 'NVU PRO.exe'));
  assert(unicodeContains(exe, 'NVU PRO'), 'NVU PRO.exe carries no NVU version resources (ProductName)');
  assert(!unicodeContains(exe, 'ProductNameElectron'), 'NVU PRO.exe still identifies itself as Electron');
}
function checkPlugin(dir) {
  const dll = path.join(dir, 'nvu_scs_telemetry.dll'), manifest = JSON.parse(fs.readFileSync(path.join(dir, 'nvu_scs_telemetry.manifest.json'), 'utf8'));
  const info = verifyPlugin(dll, { version: pluginVersion });
  assert.equal(manifest.sha256, info.sha256, 'plugin manifest does not describe the DLL bytes'); assert.equal(manifest.bytes, info.bytes); assert.equal(manifest.version, pluginVersion);
  return { ...info, manifest };
}
async function extractAndCompare(installer, files) {
  const seven = await getPath7za(), target = fs.mkdtempSync(path.join(out, 'extract-'));
  try {
    const r = spawnSync(seven, ['x', '-y', `-o${target}`, installer], { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.status !== 0) throw Error(`INSTALLER_EXTRACTION_FAILED: ${(r.stderr || r.stdout || '').slice(0, 300)}`);
    // 7-Zip lists NSIS payloads either at the root or under $INSTDIR depending on the version.
    const base = fs.existsSync(path.join(target, 'NVU PRO.exe')) ? target : fs.existsSync(path.join(target, '$INSTDIR', 'NVU PRO.exe')) ? path.join(target, '$INSTDIR') : null;
    if (!base) throw Error('INSTALLER_PAYLOAD_MISSING: NVU PRO.exe');
    let compared = 0;
    for (const file of files) {
      const extracted = path.join(base, file), original = path.join(unpacked, file);
      if (!fs.existsSync(extracted)) throw Error(`INSTALLER_PAYLOAD_MISSING: ${file}`);
      if (fs.statSync(extracted).size !== fs.statSync(original).size || sha(fs.readFileSync(extracted)) !== sha(fs.readFileSync(original))) throw Error(`INSTALLER_PAYLOAD_DIFFERS: ${file}`);
      compared++;
    }
    return { filesCompared: compared };
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
}

async function build() {
  const t0 = Date.now(), log = message => console.log(`[installer] ${message}`);
  const config = signingConfig();
  const pluginSource = path.join(__dirname, 'plugin/bin');
  checkPlugin(pluginSource);
  fs.rmSync(unpacked, { recursive: true, force: true });
  const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }; for (const key of ['CSC_LINK', 'WIN_CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_KEY_PASSWORD']) delete env[key];
  run(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'), '--win', '--x64', '--dir', '--publish', 'never'], env);
  const files = filesIn(unpacked);
  checkUnpacked(files);
  log(`unpacked tree verified (${files.length} files)`);

  // ---- signing of our own binaries (before they are packed) ----
  const signing = { configured: config.mode !== 'none', mode: config.mode, reason: config.reason || null, files: [] };
  if (config.mode !== 'none') {
    const targets = [path.join(unpacked, 'NVU PRO.exe'), path.join(unpacked, 'resources/plugin/nvu_scs_telemetry.dll')];
    signing.files.push(...signFiles(targets, { log }).map(r => ({ ...r, file: path.relative(unpacked, r.file) })));
    // Signing changes the DLL bytes: the manifest the application checks at start-up is regenerated from the final bytes.
    writePluginManifest(path.join(unpacked, 'resources/plugin/nvu_scs_telemetry.dll'), { toolchain: JSON.parse(fs.readFileSync(path.join(pluginSource, 'nvu_scs_telemetry.manifest.json'), 'utf8')).toolchain, note: 'regenerated after Authenticode signing' });
    checkPlugin(path.join(unpacked, 'resources/plugin'));
  }

  // ---- installer ----
  const dirs = new Set(files.map(f => path.dirname(f)).filter(d => d !== '.'));
  for (const d of [...dirs]) { let parent = path.dirname(d); while (parent !== '.') { dirs.add(parent); parent = path.dirname(parent); } }
  const lines = [...files.map(f => `  Delete "$INSTDIR\\${win(f)}"`), ...[...dirs].sort((a, b) => b.length - a.length).map(d => `  RMDir "$INSTDIR\\${win(d)}"`)];
  const filesNsh = path.join(out, 'installer-files.nsh'); fs.writeFileSync(filesNsh, '﻿' + lines.join('\r\n') + '\r\n');
  const [maj, min, pat] = version.split('.');
  const defines = { VERSION: version, VERSION4: `${maj}.${min}.${pat}.0`, OUTFILE: output, UNPACKED: unpacked, ICON: path.join(__dirname, 'ui/icon.ico'), FILES_NSH: filesNsh };
  const tool = await getMakeNsisPath('1.2.1');
  let exe = tool.path, makeEnv = { ...process.env, ...(tool.env || {}) };
  if (process.platform === 'win32' && exe.endsWith('.cmd')) {
    const base = path.dirname(exe); exe = ['windows/makensis.exe', 'windows/Bin/makensis.exe', 'Bin/makensis.exe'].map(p => path.join(base, p)).find(p => fs.existsSync(p));
    if (!exe) throw Error('NSIS_WINDOWS_BINARY_NOT_FOUND'); makeEnv.NSISDIR = path.join(base, 'windows');
  }
  const flag = process.platform === 'win32' ? '/' : '-';
  const extra = [];
  // A signed uninstaller needs a Windows host: NSIS runs a temporary installer to produce it, then calls this hook.
  const signUninstaller = config.mode !== 'none' && process.platform === 'win32';
  if (signUninstaller) extra.push(`${flag}X!uninstfinalize '"${process.execPath}" "${path.join(__dirname, 'tools/sign.cjs')}" "%1"' = 0`);
  fs.rmSync(output, { force: true });
  run(exe, [`${flag}V2`, ...Object.entries(defines).map(([k, v]) => `${flag}D${k}=${v}`), ...extra, path.join(__dirname, 'installer/nvu.nsi')], makeEnv);
  assert(fs.existsSync(output) && fs.statSync(output).size > 10 * 1024 * 1024, 'INSTALLER_OUTPUT_INCOMPLETE');
  if (config.mode !== 'none') signing.files.push(...signFiles([output], { log }).map(r => ({ ...r, file: path.basename(r.file) })));
  signing.uninstallerSigned = signUninstaller;

  // ---- verification of the FINAL file ----
  const integrity = verifyNsisInstaller(fs.readFileSync(output));
  const payload = await extractAndCompare(output, files);
  log(`final installer verified: NSIS CRC ${integrity.crc32}, signed=${integrity.signed}, payload compared ${payload.filesCompared} files`);
  const final = { ...describeArtifact(output, 'installer'), payload, os: signing.configured && integrity.signed ? verifySignature(output) : null };
  const pluginFinal = checkPlugin(path.join(unpacked, 'resources/plugin'));
  const manifest = {
    product: 'NVU PRO', platform: 'windows-x64', version, pluginVersion, builtAt: new Date().toISOString(), buildMs: Date.now() - t0, host: `${process.platform}-${process.arch}`,
    commit: process.env.GITHUB_SHA || null, runId: process.env.GITHUB_RUN_ID || null,
    signing: { status: integrity.signed && signing.files.every(f => f.signed) ? 'signed' : 'unsigned', configured: signing.configured, reason: integrity.signed ? null : (signing.reason || 'SIGNING_NOT_PERFORMED'),
      uninstallerSigned: signing.uninstallerSigned, productionReady: false,
      blocker: integrity.signed ? null : 'Sem certificado de assinatura de código (OV/EV) ou serviço de assinatura configurado: o instalador NÃO é assinado e o Windows/SmartScreen mostrará editor desconhecido.',
      files: signing.files.map(({ file, signed, reason, tool }) => ({ file, signed, reason: reason || null, tool: tool || null })) },
    artifacts: [final, { name: 'nvu_scs_telemetry.dll', role: 'plugin', bytes: pluginFinal.bytes, sha256: pluginFinal.sha256, signed: pluginFinal.signed, version: pluginFinal.manifest.version }],
  };
  // "productionReady" is true only with an OS-verified, timestamped signature on every signable file.
  manifest.signing.productionReady = manifest.signing.status === 'signed' && final.os?.valid === true && final.os?.timestamped === true;
  fs.writeFileSync(path.join(out, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(`${output}.sha256`, `${final.sha256}  ${filename}\n`);
  fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), `${final.sha256}  ${filename}\n${pluginFinal.sha256}  resources/plugin/nvu_scs_telemetry.dll\n`);
  fs.writeFileSync(`${output}.integrity.json`, JSON.stringify({ ...integrity, payload }, null, 2) + '\n');
  fs.rmSync(filesNsh, { force: true });
  console.log(`WINDOWS_INSTALLER_BUILT: ${filename} (${final.bytes} bytes) sha256=${final.sha256} signing=${manifest.signing.status} productionReady=${manifest.signing.productionReady}`);
}
build().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
