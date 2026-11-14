// Elevation is requested ONLY when writing to the chosen game folder is refused for the current user.
// The elevated process is this same application started with --nvu-elevated-plugin=<request>. It trusts nothing in the request except
// "which game" and "which folder": the plugin bytes come from the elevated process' OWN package (plugin folder next to the application) and must match the
// packaged manifest AND the hash the requester computed; the destination is re-derived and re-validated; links, foreign
// plugins and any other file name are refused. The result travels as the exit code only (no file is written for the
// requester to read), and the requester re-verifies the destination afterwards without privileges.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { sha, installPlugin, removePlugin, DLL } = require('./plugin-install.cjs');
const { NvuError } = require('./errors.cjs');
const { windowsPowerShellEnv } = require('./powershell-env.cjs');

const EXIT = Object.freeze({ OK: 0, BAD_REQUEST: 20, NOT_GAME: 21, SOURCE: 22, FOREIGN: 23, REDIRECTED: 24, WRITE: 25, VERIFY: 26, RESOURCES: 27, HASH: 28, UNEXPECTED: 29, DECLINED: 1223 });
const MAX_REQUEST = 4096;
function encodeRequest({ key, root, action = 'install' }, { expectedSha256, version }) {
  return Buffer.from(JSON.stringify({ v: 1, key, root, action, expectedSha256, version })).toString('base64');
}
function decodeRequest(b64) {
  if (typeof b64 !== 'string' || !b64 || b64.length > MAX_REQUEST || !/^[A-Za-z0-9+/=]+$/.test(b64)) return null;
  let request; try { request = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); } catch { return null; }
  if (!request || request.v !== 1 || !['ets2', 'ats'].includes(request.key) || !['install', 'remove'].includes(request.action)) return null;
  if (typeof request.root !== 'string' || !request.root || request.root.length > 1024 || request.root.includes('\0')) return null;
  if (request.action === 'install' && !/^[a-f0-9]{64}$/.test(request.expectedSha256 || '')) return null;
  if (request.version !== undefined && request.version !== null && !/^\d+\.\d+\.\d+$/.test(String(request.version))) return null;
  return { key: request.key, root: request.root, action: request.action, expectedSha256: request.expectedSha256, version: request.version || null };
}
const exitFor = error => {
  switch (error?.code) {
    case 'NVU-P010': return EXIT.NOT_GAME; case 'NVU-P030': return EXIT.FOREIGN; case 'NVU-P040': return EXIT.REDIRECTED;
    case 'NVU-P060': return EXIT.SOURCE; case 'NVU-P080': return EXIT.VERIFY; case 'NVU-P050': case 'NVU-P070': return EXIT.WRITE;
    default: return EXIT.UNEXPECTED;
  }
};
/** Runs inside the elevated process. Never throws; returns the exit code. */
function runElevatedPlugin(b64, { pluginDir, fsImpl = fs, log = () => {} }) {
  const request = decodeRequest(b64);
  if (!request) return EXIT.BAD_REQUEST;
  try {
    if (request.action === 'remove') { removePlugin({ root: request.root, key: request.key, fsImpl }); return EXIT.OK; }
    const dll = path.join(pluginDir, DLL), manifestFile = path.join(pluginDir, 'nvu_scs_telemetry.manifest.json');
    let manifest; try { manifest = JSON.parse(fsImpl.readFileSync(manifestFile, 'utf8')); } catch { return EXIT.RESOURCES; }
    let bytes; try { bytes = fsImpl.readFileSync(dll); } catch { return EXIT.RESOURCES; }
    const digest = sha(bytes);
    if (digest !== manifest.sha256 || digest !== request.expectedSha256) return EXIT.HASH;
    installPlugin({ root: request.root, key: request.key, dll, expectedSha256: digest, version: manifest.version, fsImpl });
    return EXIT.OK;
  } catch (error) { log(error); return error instanceof NvuError ? exitFor(error) : EXIT.UNEXPECTED; }
}
/** Starts the elevated process through the Windows consent prompt (UAC). Resolves with { ok, exitCode, declined }. */
async function requestElevation({ exe, args, run = exec, platform = process.platform }) {
  if (platform !== 'win32') throw new NvuError('NVU-P052', 'Elevação só existe no Windows.');
  const script = "$ErrorActionPreference='Stop'; try { $p = Start-Process -FilePath $env:NVU_ELEVATE_EXE -ArgumentList @($env:NVU_ELEVATE_ARG1,$env:NVU_ELEVATE_ARG2 | Where-Object { $_ }) -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode } "
    + "catch { if ($_.Exception.NativeErrorCode -eq 1223 -or $_.Exception.Message -match 'cancel') { exit 1223 }; Write-Error $_.Exception.Message; exit 1 }";
  const [first, second = ''] = args;
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 120000, encoding: 'utf8',
      env: windowsPowerShellEnv(process.env, { NVU_ELEVATE_EXE: exe, NVU_ELEVATE_ARG1: first, NVU_ELEVATE_ARG2: second }) });
    return { ok: true, exitCode: 0, declined: false };
  } catch (error) {
    const code = typeof error.code === 'number' ? error.code : EXIT.UNEXPECTED;
    return { ok: false, exitCode: code, declined: code === EXIT.DECLINED, stderr: String(error.stderr || '').slice(0, 300) };
  }
}
const messageFor = exitCode => ({ [EXIT.NOT_GAME]: 'NVU-P010', [EXIT.FOREIGN]: 'NVU-P030', [EXIT.REDIRECTED]: 'NVU-P040', [EXIT.SOURCE]: 'NVU-P060', [EXIT.RESOURCES]: 'NVU-P060', [EXIT.HASH]: 'NVU-P060',
  [EXIT.VERIFY]: 'NVU-P080', [EXIT.WRITE]: 'NVU-P070', [EXIT.DECLINED]: 'NVU-P051' })[exitCode] || 'NVU-P052';
module.exports = { EXIT, encodeRequest, decodeRequest, runElevatedPlugin, requestElevation, messageFor };
