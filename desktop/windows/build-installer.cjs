// Cross-host installer build: WriteUninstaller runs on the user's Windows at install time.
// No Windows executable needs to run on the build host; Wine is not a build prerequisite.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows');
const config = require('./package.json');
const { verifyNsisInstaller } = require('./tools/nsis-integrity.cjs');
const { verifyPlugin } = require('./tools/plugin-integrity.cjs');
function run(file, args, env = process.env) {
  const r = spawnSync(file, args, { stdio: 'inherit', env, shell: false, cwd: __dirname });
  if (r.error || r.status !== 0) throw r.error || Error(`Build failed (${r.status}): ${path.basename(file)}`);
}
const escape = s => s.replace(/\$/g, '$$$$').replace(/"/g, '$\\"');
function filesIn(dir, relative = '') {
  return fs.readdirSync(path.join(dir, relative), { withFileTypes: true }).flatMap(e => {
    const name = path.join(relative, e.name); if (e.isSymbolicLink()) throw Error('INSTALLER_SYMLINK_NOT_ALLOWED');
    return e.isDirectory() ? filesIn(dir, name) : [name];
  });
}
async function build() {
  verifyPlugin(path.join(__dirname, 'plugin/bin/nvu_scs_telemetry.dll'));
  run(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'), '--win', '--x64', '--dir', '--publish', 'never']);
  const out = path.resolve(__dirname, '../../artifacts/windows'), unpacked = path.join(out, 'win-unpacked');
  const files = filesIn(unpacked);
  if (!files.includes('NVU PRO.exe') || !files.includes(path.join('resources', 'app.asar'))) throw Error('INSTALLER_CONTENT_INCOMPLETE');
  const filename = `NVU-PRO-Windows-${config.version}-x64-Setup.exe`, output = path.join(out, filename);
  const dirs = new Set(files.map(f => path.dirname(f)).filter(d => d !== '.'));
  for (const d of [...dirs]) { let parent = path.dirname(d); while (parent !== '.') { dirs.add(parent); parent = path.dirname(parent); } }
  const win = name => escape(name.split(path.sep).join('\\'));
  const deletes = files.map(f => `  Delete "$INSTDIR\\${win(f)}"`).join('\n');
  const removeDirs = [...dirs].sort((a, b) => b.length - a.length).map(d => `  RMDir "$INSTDIR\\${win(d)}"`).join('\n');
  const script = String.raw`Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
Name "NVU PRO Windows"
OutFile "${escape(output)}"
InstallDir "$LOCALAPPDATA\Programs\NVU PRO"
InstallDirRegKey HKCU "Software\NVU\Windows" "InstallDir"
!include "MUI2.nsh"
!include "x64.nsh"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"
Function .onInit
  ${'${IfNot}'} ${'${RunningX64}'}
    MessageBox MB_OK "A NVU PRO requer Windows x64."
    Abort
  ${'${EndIf}'}
FunctionEnd
Section "NVU PRO"
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "${escape(unpacked)}/*"
  WriteUninstaller "$INSTDIR\Uninstall NVU.exe"
  CreateDirectory "$SMPROGRAMS\NVU PRO"
  CreateShortcut "$SMPROGRAMS\NVU PRO\NVU PRO.lnk" "$INSTDIR\NVU PRO.exe"
  CreateShortcut "$DESKTOP\NVU PRO.lnk" "$INSTDIR\NVU PRO.exe"
  WriteRegStr HKCU "Software\NVU\Windows" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NVUPROWindows" "DisplayName" "NVU PRO Windows"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NVUPROWindows" "DisplayVersion" "${config.version}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NVUPROWindows" "Publisher" "NVU"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NVUPROWindows" "UninstallString" '$\"$INSTDIR\Uninstall NVU.exe$\"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NVUPROWindows" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NVUPROWindows" "NoRepair" 1
SectionEnd
Section "Uninstall"
  SetShellVarContext current
  IfFileExists "$INSTDIR\resources\app.asar" 0 keepFiles
${deletes}
${removeDirs}
  Delete "$INSTDIR\Uninstall NVU.exe"
  RMDir "$INSTDIR"
keepFiles:
  Delete "$DESKTOP\NVU PRO.lnk"
  Delete "$SMPROGRAMS\NVU PRO\NVU PRO.lnk"
  RMDir "$SMPROGRAMS\NVU PRO"
  DeleteRegKey HKCU "Software\NVU\Windows"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NVUPROWindows"
SectionEnd
`;
  const file = path.join(out, 'installer.generated.nsi'); fs.writeFileSync(file, script);
  const tool = await getMakeNsisPath('1.2.1');
  let exe = tool.path, env = { ...process.env, ...(tool.env || {}) };
  if (process.platform === 'win32' && exe.endsWith('.cmd')) {
    const base = path.dirname(exe), candidates = ['windows/makensis.exe', 'windows/Bin/makensis.exe', 'Bin/makensis.exe'];
    exe = candidates.map(p => path.join(base, p)).find(p => fs.existsSync(p));
    if (!exe) throw Error('NSIS_WINDOWS_BINARY_NOT_FOUND');
    env.NSISDIR = path.join(base, 'windows');
  }
  run(exe, [process.platform === 'win32' ? '/V2' : '-V2', file], env);
  const size = fs.statSync(output).size;
  if (size < 10 * 1024 * 1024) throw Error('INSTALLER_OUTPUT_INCOMPLETE');
  const integrity = verifyNsisInstaller(fs.readFileSync(output));
  fs.writeFileSync(`${output}.integrity.json`, JSON.stringify(integrity, null, 2) + '\n');
  fs.writeFileSync(`${output}.sha256`, `${createHash('sha256').update(fs.readFileSync(output)).digest('hex')}  ${filename}\n`);
  console.log(`WINDOWS_INSTALLER_BUILT: ${filename} (${size} bytes), unsigned`);
}
build().catch(error => { console.error(error.message); process.exitCode = 1; });
