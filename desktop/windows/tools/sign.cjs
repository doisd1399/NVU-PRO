// Authenticode signing with a LEGITIMATE certificate or signing service. Nothing here can create trust: without credentials
// the result is "unsigned" with the exact reason, and nothing downstream may call the artifact signed.
//
// Credentials come only from the environment (GitHub/Azure secrets, CI vault), never from files in the repository, and are
// never written to logs or to the command line of a child process when avoidable:
//   NVU_SIGN_PFX_BASE64 + NVU_SIGN_PFX_PASSWORD      code-signing certificate (OV/EV) as PFX
//   NVU_SIGN_PFX_FILE   + NVU_SIGN_PFX_PASSWORD      same, from a file kept outside the repository
//   NVU_SIGN_COMMAND_JSON                            JSON array run per file, "{file}" is replaced (SignPath, DigiCert KeyLocker, Azure Trusted Signing CLI…)
//   NVU_SIGN_TIMESTAMP_URL                           RFC 3161 server (default http://timestamp.digicert.com); a signature without timestamp is NOT production-ready
// SHA-256 file and timestamp digests are always used.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');

const DEFAULT_TIMESTAMP = 'http://timestamp.digicert.com';
function signingConfig(env = process.env) {
  const timestamp = env.NVU_SIGN_TIMESTAMP_URL || DEFAULT_TIMESTAMP;
  const allowUntimestamped = env.NVU_SIGN_TEST_NO_TIMESTAMP === '1';
  if (env.NVU_SIGN_COMMAND_JSON) {
    let command; try { command = JSON.parse(env.NVU_SIGN_COMMAND_JSON); } catch { return { mode: 'none', reason: 'SIGNING_COMMAND_INVALID' }; }
    if (!Array.isArray(command) || !command.length || !command.every(x => typeof x === 'string') || !command.some(x => x.includes('{file}'))) return { mode: 'none', reason: 'SIGNING_COMMAND_INVALID' };
    return { mode: 'command', command, timestamp, allowUntimestamped };
  }
  if ((env.NVU_SIGN_PFX_BASE64 || env.NVU_SIGN_PFX_FILE) && env.NVU_SIGN_PFX_PASSWORD !== undefined) return { mode: 'pfx', timestamp, allowUntimestamped };
  return { mode: 'none', reason: 'SIGNING_CREDENTIALS_MISSING' };
}
function findSigntool(env = process.env, fsImpl = fs) {
  if (env.NVU_SIGNTOOL) return env.NVU_SIGNTOOL;
  const roots = [env['ProgramFiles(x86)'], env.ProgramFiles].filter(Boolean).map(r => path.join(r, 'Windows Kits', '10', 'bin'));
  for (const root of roots) {
    let versions = []; try { versions = fsImpl.readdirSync(root).filter(v => /^10\./.test(v)).sort().reverse(); } catch { continue; }
    for (const v of versions) { const candidate = path.join(root, v, 'x64', 'signtool.exe'); if (fsImpl.existsSync(candidate)) return candidate; }
  }
  return null;
}
const tmpFile = suffix => path.join(os.tmpdir(), `nvu-sign-${randomBytes(8).toString('hex')}${suffix}`);

/** Signs each file in place. Returns one result per file; never throws for "no credentials". */
function signFiles(files, { env = process.env, platform = process.platform, run = spawnSync, log = () => {}, fsImpl = fs } = {}) {
  const config = signingConfig(env);
  if (config.mode === 'none') return files.map(file => ({ file, signed: false, reason: config.reason }));
  if (!config.allowUntimestamped && !/^https?:\/\//.test(config.timestamp)) return files.map(file => ({ file, signed: false, reason: 'SIGNING_TIMESTAMP_REQUIRED' }));
  const cleanup = [];
  const results = [];
  try {
    let pfx = env.NVU_SIGN_PFX_FILE, password = env.NVU_SIGN_PFX_PASSWORD;
    if (config.mode === 'pfx' && !pfx) { pfx = tmpFile('.pfx'); fsImpl.writeFileSync(pfx, Buffer.from(env.NVU_SIGN_PFX_BASE64, 'base64'), { mode: 0o600 }); cleanup.push(pfx); }
    let thumbprint = null;
    if (config.mode === 'pfx' && platform === 'win32') {
      // Import into the user's store and sign by thumbprint: the password never appears on a command line.
      const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$p=ConvertTo-SecureString $env:NVU_SIGN_PFX_PASSWORD -AsPlainText -Force; (Import-PfxCertificate -FilePath $env:NVU_SIGN_PFX_PATH -CertStoreLocation Cert:\\CurrentUser\\My -Password $p).Thumbprint"],
        { encoding: 'utf8', env: { ...env, NVU_SIGN_PFX_PASSWORD: password, NVU_SIGN_PFX_PATH: pfx }, windowsHide: true });
      thumbprint = String(r.stdout || '').trim().split(/\s+/).pop();
      if (r.status !== 0 || !/^[0-9A-F]{40}$/i.test(thumbprint)) return files.map(file => ({ file, signed: false, reason: 'SIGNING_CERTIFICATE_IMPORT_FAILED' }));
      cleanup.push(() => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Remove-Item Cert:\\CurrentUser\\My\\${thumbprint} -ErrorAction SilentlyContinue`], { windowsHide: true }));
    }
    let passFile = null;
    if (config.mode === 'pfx' && platform !== 'win32') { passFile = tmpFile('.pass'); fsImpl.writeFileSync(passFile, password, { mode: 0o600 }); cleanup.push(passFile); }
    const signtool = platform === 'win32' && config.mode === 'pfx' ? findSigntool(env, fsImpl) : null;
    for (const file of files) {
      let result;
      if (config.mode === 'command') {
        const [cmd, ...args] = config.command.map(x => x.replaceAll('{file}', file));
        result = run(cmd, args, { encoding: 'utf8', env, windowsHide: true });
        results.push(result.status === 0 ? { file, signed: true, tool: path.basename(cmd) } : { file, signed: false, reason: 'SIGNING_COMMAND_FAILED', exitCode: result.status });
      } else if (platform === 'win32') {
        if (!signtool) { results.push({ file, signed: false, reason: 'SIGNTOOL_NOT_FOUND' }); continue; }
        const args = ['sign', '/fd', 'SHA256', '/sha1', thumbprint, '/d', 'NVU PRO', ...(config.allowUntimestamped ? [] : ['/tr', config.timestamp, '/td', 'SHA256']), file];
        result = run(signtool, args, { encoding: 'utf8', windowsHide: true });
        results.push(result.status === 0 ? { file, signed: true, tool: 'signtool' } : { file, signed: false, reason: 'SIGNTOOL_FAILED', exitCode: result.status });
      } else {
        const out = `${file}.signed.tmp`;
        const args = ['sign', '-pkcs12', pfx, '-readpass', passFile, '-h', 'sha256', '-n', 'NVU PRO', ...(config.allowUntimestamped ? [] : ['-ts', config.timestamp]), '-in', file, '-out', out];
        result = run('osslsigncode', args, { encoding: 'utf8' });
        if (result.status === 0) { fsImpl.renameSync(out, file); results.push({ file, signed: true, tool: 'osslsigncode' }); }
        else { try { fsImpl.unlinkSync(out); } catch { /* nothing to clean */ } results.push({ file, signed: false, reason: 'OSSLSIGNCODE_FAILED', exitCode: result.status }); }
      }
      log(`${results.at(-1).signed ? 'signed' : 'NOT signed'} ${path.basename(file)}${results.at(-1).reason ? ' (' + results.at(-1).reason + ')' : ''}`);
    }
  } finally {
    for (const item of cleanup) { try { typeof item === 'function' ? item() : fsImpl.rmSync(item, { force: true }); } catch { /* best effort */ } }
  }
  return results;
}
/**
 * Asks the operating system. On Windows this is the real check (chain + timestamp); elsewhere only osslsigncode's check of the
 * signature bytes can be done, which is reported as such and is not a trust decision.
 */
function verifySignature(file, { platform = process.platform, run = spawnSync } = {}) {
  if (platform === 'win32') {
    const script = `$s = Get-AuthenticodeSignature -LiteralPath $env:NVU_VERIFY_FILE; [pscustomobject]@{ status=[string]$s.Status; statusMessage=$s.StatusMessage; signer=$s.SignerCertificate.Subject; thumbprint=$s.SignerCertificate.Thumbprint; notAfter=$s.SignerCertificate.NotAfter; timestamped=($null -ne $s.TimeStamperCertificate); timestamper=$s.TimeStamperCertificate.Subject } | ConvertTo-Json -Compress`;
    const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', env: { ...process.env, NVU_VERIFY_FILE: file }, windowsHide: true });
    if (r.status !== 0) return { checked: 'windows', valid: false, status: 'CheckFailed', detail: String(r.stderr || '').slice(0, 300) };
    const data = JSON.parse(r.stdout);
    return { checked: 'windows', valid: data.status === 'Valid', ...data };
  }
  const r = run('osslsigncode', ['verify', '-in', file], { encoding: 'utf8' });
  const text = `${r.stdout || ''}${r.stderr || ''}`;
  return { checked: 'osslsigncode-signature-bytes-only', valid: false, status: /Signature verification: ok/i.test(text) ? 'SignatureBytesOk_TrustNotEvaluated' : 'NotSignedOrInvalid', trustEvaluated: false };
}
module.exports = { signingConfig, signFiles, verifySignature, findSigntool, DEFAULT_TIMESTAMP };
if (require.main === module) {
  const files = process.argv.slice(2);
  const results = signFiles(files, { log: console.log });
  console.log(JSON.stringify(results.map(({ file, ...rest }) => ({ file: path.basename(file), ...rest })), null, 2));
  process.exitCode = results.every(r => r.signed) ? 0 : 78;
}
