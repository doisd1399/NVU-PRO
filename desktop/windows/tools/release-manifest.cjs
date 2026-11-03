// Facts about a release artifact, computed from the FINAL bytes (after signing). Used by the builder to write
// release-manifest.json and by verify-release.cjs to check it again later, on this machine or on the person's PC.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { verifyNsisInstaller } = require('./nsis-integrity.cjs');
const { readAuthenticode } = require('./authenticode.cjs');

function fingerprint(file) {
  const hash = createHash('sha256'), fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(1 << 20); let bytes = 0;
  try { for (let n; (n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0;) { hash.update(buffer.subarray(0, n)); bytes += n; } } finally { fs.closeSync(fd); }
  return { bytes, sha256: hash.digest('hex') };
}
/** Everything that can be said about a file WITHOUT trusting a signature: size, hash, container layout. */
function describeArtifact(file, role) {
  const base = { name: path.basename(file), role, ...fingerprint(file) };
  if (/\.(exe|dll)$/i.test(file)) {
    const bytes = fs.readFileSync(file);
    try { const a = readAuthenticode(bytes); base.signature = { present: a.present, certificates: a.certificates.length }; } catch (error) { base.signature = { present: false, layoutError: error.message }; }
    if (role === 'installer') base.nsis = (({ crcEnabled, crc32, firstHeaderOffset, dataLength, signed }) => ({ crcEnabled, crc32, firstHeaderOffset, dataLength, signed }))(verifyNsisInstaller(bytes));
  }
  return base;
}
module.exports = { fingerprint, describeArtifact };
