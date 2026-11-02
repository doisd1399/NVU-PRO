const fs = require('node:fs');
const { createHash } = require('node:crypto');
function verifyPlugin(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 512 || bytes.toString('ascii', 0, 2) !== 'MZ') throw Error('PLUGIN_BINARY_INVALID');
  const pe = bytes.readUInt32LE(0x3c);
  if (pe > bytes.length - 24 || bytes.toString('binary', pe, pe + 4) !== 'PE\0\0' || bytes.readUInt16LE(pe + 4) !== 0x8664 || !(bytes.readUInt16LE(pe + 22) & 0x2000)) throw Error('PLUGIN_X64_DLL_REQUIRED');
  const sections = bytes.readUInt16LE(pe + 6), table = pe + 24 + bytes.readUInt16LE(pe + 20);
  if (!sections || sections > 96 || table + sections * 40 > bytes.length) throw Error('PLUGIN_BINARY_INCOMPLETE');
  for (let i = 0; i < sections; i++) {
    const at = table + i * 40, length = bytes.readUInt32LE(at + 16), offset = bytes.readUInt32LE(at + 20);
    if (length && (!offset || offset + length > bytes.length)) throw Error('PLUGIN_BINARY_INCOMPLETE');
  }
  if (!['scs_telemetry_init', 'scs_telemetry_shutdown'].every(name => bytes.includes(Buffer.from(name + '\0')))) throw Error('PLUGIN_EXPORTS_REQUIRED');
  return { bytes: bytes.length, machine: 'x64', sha256: createHash('sha256').update(bytes).digest('hex') };
}
module.exports = { verifyPlugin };
