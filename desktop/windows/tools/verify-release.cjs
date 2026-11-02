#!/usr/bin/env node
// Re-verifies a release folder (or a downloaded copy of it) against release-manifest.json:
//   size and SHA-256 of every artifact, NSIS CRC + Authenticode container, 7-Zip test of the installer, and (on Windows) the
//   operating system's own Authenticode verdict. Run it again after signing and again on the file that was actually downloaded.
// Exit codes: 0 verified · 1 mismatch/corruption · 78 --require-signed and the installer is not validly signed.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fingerprint } = require('./release-manifest.cjs');
const { verifyNsisInstaller } = require('./nsis-integrity.cjs');
const { verifySignature } = require('./sign.cjs');
const { nsisCapable7z } = require('./sevenzip.cjs');

async function verifyRelease(dir, { requireSigned = false, requireSevenZip = false, log = () => {}, sevenZip } = {}) {
  const manifestFile = path.join(dir, 'release-manifest.json');
  if (!fs.existsSync(manifestFile)) throw Error('RELEASE_MANIFEST_MISSING');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')), checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, ...(detail ? { detail } : {}) }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? ' :: ' + detail : ''}`); return ok; };
  for (const artifact of manifest.artifacts.filter(a => a.role === 'installer')) {
    const file = path.join(dir, artifact.name);
    if (!check(`${artifact.name}: present`, fs.existsSync(file))) continue;
    const actual = fingerprint(file);
    check(`${artifact.name}: size ${artifact.bytes}`, actual.bytes === artifact.bytes, `actual ${actual.bytes}`);
    check(`${artifact.name}: SHA-256`, actual.sha256 === artifact.sha256, `actual ${actual.sha256}`);
    let nsis = null; try { nsis = verifyNsisInstaller(fs.readFileSync(file)); check(`${artifact.name}: NSIS CRC and certificate container`, true); } catch (error) { check(`${artifact.name}: NSIS CRC and certificate container`, false, error.message); }
    if (nsis) check(`${artifact.name}: signed state matches the manifest`, nsis.signed === (manifest.signing.status === 'signed'), `file signed=${nsis.signed}, manifest=${manifest.signing.status}`);
    if (sevenZip) { const r = spawnSync(sevenZip, ['t', file], { encoding: 'utf8', maxBuffer: 64 << 20 }); check(`${artifact.name}: 7-Zip archive test`, r.status === 0, (r.stdout || '').split('\n').slice(-4).join(' ')); }
    else if (requireSevenZip) check(`${artifact.name}: 7-Zip archive test`, false, 'no 7-Zip able to open NSIS installers (install 7-Zip or set NVU_7Z)');
    else { checks.push({ name: `${artifact.name}: 7-Zip archive test`, ok: true, skipped: true, detail: 'no NSIS-capable 7-Zip on this host: NOT verified' }); log(`SKIP ${artifact.name}: 7-Zip archive test (no NSIS-capable 7-Zip on this host: NOT verified)`); }
    if (nsis?.signed) {
      const verdict = verifySignature(file); check(`${artifact.name}: Authenticode (${verdict.checked})`, verdict.valid === true || verdict.trustEvaluated === false, `${verdict.status}`);
      manifest.verdict = verdict;
    }
  }
  const sums = path.join(dir, 'SHA256SUMS.txt');
  if (fs.existsSync(sums)) for (const line of fs.readFileSync(sums, 'utf8').split(/\r?\n/).filter(Boolean)) {
    const [hash, ...rest] = line.split(/\s+/), name = rest.join(' '); const file = path.join(dir, name);
    if (fs.existsSync(file)) check(`SHA256SUMS: ${name}`, fingerprint(file).sha256 === hash);
  }
  const signedOk = manifest.signing.status === 'signed' && manifest.verdict?.valid === true;
  if (requireSigned) check('required: installer validly signed (operating system verdict)', signedOk, manifest.signing.blocker || manifest.verdict?.status);
  return { ok: checks.every(c => c.ok), checks, signing: manifest.signing, version: manifest.version };
}
module.exports = { verifyRelease };
if (require.main === module) {
  (async () => {
    const dir = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || 'artifacts/windows'), requireSigned = process.argv.includes('--require-signed');
    let sevenZip = null; try { sevenZip = (await nsisCapable7z())?.path || null; } catch { /* reported as skipped (or failed with --require-7zip) */ }
    const result = await verifyRelease(dir, { requireSigned, requireSevenZip: process.argv.includes('--require-7zip'), log: console.log, sevenZip });
    console.log(JSON.stringify({ ok: result.ok, version: result.version, signing: result.signing.status, productionReady: result.signing.productionReady === true }));
    process.exitCode = result.ok ? 0 : (requireSigned && result.checks.at(-1)?.name.startsWith('required') ? 78 : 1);
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
