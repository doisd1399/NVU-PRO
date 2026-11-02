const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { crc32 } = require('node:zlib');
const { readAuthenticode, peHeaders } = require('./authenticode.cjs');

// NSIS Source/exehead/fileform.{c,h}: FirstHeader is scanned on 512-byte
// boundaries; normal CRC excludes the first 512 bytes and ends before fcrc.
// The first 512 bytes hold the PE header fields that Authenticode rewrites (checksum, certificate-table entry),
// which is why a signed NSIS installer keeps a valid NSIS CRC. The certificate table is appended AFTER the NSIS
// data (+ zero padding to 8 bytes); readAuthenticode() proves nothing else follows it.
// Scope: NSIS 3 installers, unsigned or with the Authenticode container produced by signtool/osslsigncode.
const signature = Buffer.from('efbeadde4e756c6c736f6674496e7374', 'hex');
function verifyNsisInstaller(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1024 || bytes.toString('ascii', 0, 2) !== 'MZ') throw Error('INSTALLER_INVALID_PE');
  try { peHeaders(bytes); } catch { throw Error('INSTALLER_INVALID_PE'); }
  let offset = -1;
  for (let candidate = 512; candidate <= bytes.length - 28; candidate += 512) {
    if (bytes.subarray(candidate + 4, candidate + 20).equals(signature) && (bytes.readUInt32LE(candidate) & ~15) === 0) { offset = candidate; break; }
  }
  if (offset < 0) throw Error('INSTALLER_NSIS_HEADER_MISSING');
  const flags = bytes.readUInt32LE(offset), headerLength = bytes.readUInt32LE(offset + 20), dataLength = bytes.readUInt32LE(offset + 24);
  if (flags & 4) throw Error('INSTALLER_CRC_DISABLED');
  const payloadEnd = offset + dataLength;
  if (!headerLength || dataLength < 32 || payloadEnd > bytes.length) throw Error('INSTALLER_LENGTH_MISMATCH');
  let authenticode;
  try { authenticode = readAuthenticode(bytes, payloadEnd); }
  catch (error) { throw Error(/^SIGNATURE_ABSENT_BUT_DATA_FOLLOWS_PAYLOAD$/.test(error.message) ? 'INSTALLER_LENGTH_MISMATCH' : 'INSTALLER_' + error.message); }
  const crcOffset = payloadEnd - 4;
  const expected = bytes.readUInt32LE(crcOffset), actual = crc32(bytes.subarray(512, crcOffset));
  if (expected !== actual) throw Error('INSTALLER_CRC_MISMATCH');
  return { bytes: bytes.length, firstHeaderOffset: offset, dataLength, crcEnabled: true, crc32: actual.toString(16).padStart(8, '0'),
    signed: authenticode.present, authenticode, sha256: createHash('sha256').update(bytes).digest('hex') };
}
module.exports = { verifyNsisInstaller };
if (require.main === module) {
  try { console.log(JSON.stringify(verifyNsisInstaller(fs.readFileSync(process.argv[2])), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
