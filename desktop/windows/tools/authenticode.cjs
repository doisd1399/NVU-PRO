// Authenticode container layout for PE files (installer, application, plugin).
// This module checks STRUCTURE only: where the certificate table lives and that nothing unaccounted-for follows it.
// Cryptographic validity and trust of the signature are decided by Windows (Get-AuthenticodeSignature / signtool verify /pa)
// or osslsigncode; this file never claims that a signature is trusted.
const WIN_CERT_HEADER = 8;
const certificateTypes = { 0x0001: 'X509', 0x0002: 'PKCS_SIGNED_DATA', 0x0003: 'RESERVED', 0x0004: 'TS_STACK_SIGNED' };

function peHeaders(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 512 || bytes.toString('ascii', 0, 2) !== 'MZ') throw Error('PE_INVALID');
  const pe = bytes.readUInt32LE(0x3c);
  if (pe < 0x40 || pe > bytes.length - 24 || bytes.toString('binary', pe, pe + 4) !== 'PE\0\0') throw Error('PE_INVALID');
  const optional = pe + 24, magic = bytes.readUInt16LE(optional);
  if (magic !== 0x10b && magic !== 0x20b) throw Error('PE_OPTIONAL_HEADER_INVALID');
  const directories = optional + (magic === 0x20b ? 112 : 96), count = bytes.readUInt32LE(directories - 4);
  return { pe, optional, magic, directories, count, checksumAt: optional + 64 };
}
/** Returns the Security data directory: a FILE offset (not an RVA) and a byte size. */
function securityDirectory(bytes) {
  const h = peHeaders(bytes);
  if (h.count < 5) return { offset: 0, size: 0 };
  const at = h.directories + 4 * 8;
  if (at + 8 > bytes.length) throw Error('PE_OPTIONAL_HEADER_INVALID');
  return { offset: bytes.readUInt32LE(at), size: bytes.readUInt32LE(at + 4), entryAt: at };
}
/**
 * Describes the WIN_CERTIFICATE table and proves it is the last thing in the file.
 * `payloadEnd` (optional) is the end of any overlay that precedes the signature (the NSIS data); up to 7 zero bytes of padding are allowed.
 */
function readAuthenticode(bytes, payloadEnd) {
  const dir = securityDirectory(bytes);
  if (!dir.size && !dir.offset) {
    if (payloadEnd !== undefined && payloadEnd !== bytes.length) throw Error('SIGNATURE_ABSENT_BUT_DATA_FOLLOWS_PAYLOAD');
    return { present: false, certificates: [] };
  }
  if (!dir.size || !dir.offset) throw Error('SIGNATURE_DIRECTORY_INCONSISTENT');
  if (dir.offset % 8 !== 0) throw Error('SIGNATURE_MISALIGNED');
  if (dir.offset + dir.size !== bytes.length) throw Error(dir.offset + dir.size > bytes.length ? 'SIGNATURE_TRUNCATED' : 'SIGNATURE_FOLLOWED_BY_EXTRA_DATA');
  if (payloadEnd !== undefined) {
    if (dir.offset < payloadEnd) throw Error('SIGNATURE_OVERLAPS_PAYLOAD');
    if (dir.offset - payloadEnd >= 8) throw Error('SIGNATURE_PRECEDED_BY_UNKNOWN_DATA');
    if (bytes.subarray(payloadEnd, dir.offset).some(b => b !== 0)) throw Error('SIGNATURE_PADDING_NOT_ZERO');
  }
  const certificates = [];
  for (let at = dir.offset; at < dir.offset + dir.size;) {
    if (at + WIN_CERT_HEADER > dir.offset + dir.size) throw Error('SIGNATURE_ENTRY_TRUNCATED');
    const length = bytes.readUInt32LE(at), revision = bytes.readUInt16LE(at + 4), type = bytes.readUInt16LE(at + 6);
    if (length < WIN_CERT_HEADER + 1 || at + length > dir.offset + dir.size) throw Error('SIGNATURE_ENTRY_LENGTH_INVALID');
    if (revision !== 0x0200 && revision !== 0x0100) throw Error('SIGNATURE_REVISION_UNSUPPORTED');
    if (!certificateTypes[type]) throw Error('SIGNATURE_TYPE_UNSUPPORTED');
    certificates.push({ offset: at, bytes: length, revision: '0x' + revision.toString(16).padStart(4, '0'), type: certificateTypes[type] });
    at += Math.ceil(length / 8) * 8;
  }
  if (!certificates.length || !certificates.some(c => c.type === 'PKCS_SIGNED_DATA')) throw Error('SIGNATURE_PKCS7_MISSING');
  return { present: true, offset: dir.offset, bytes: dir.size, certificates };
}
module.exports = { peHeaders, securityDirectory, readAuthenticode };
