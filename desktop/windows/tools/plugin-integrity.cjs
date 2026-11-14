const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { readAuthenticode } = require('./authenticode.cjs');

const REQUIRED_EXPORTS = ['scs_telemetry_init', 'scs_telemetry_shutdown'];
// Runtime libraries a player's PC may not have: the plugin must be self-contained (static CRT / static libstdc++).
const FORBIDDEN_IMPORTS = /^(vcruntime|msvcp|concrt|vcomp|ucrtbase|api-ms-win-crt|libstdc\+\+|libgcc|libwinpthread)/i;

/** Export names and imported DLL names (lower case) of a PE32+ file, read from the real export and import directories. */
function readPeTables(bytes) {
  const incomplete = () => Error('PLUGIN_BINARY_INCOMPLETE');
  const u16 = at => { if (at < 0 || at + 2 > bytes.length) throw incomplete(); return bytes.readUInt16LE(at); };
  const u32 = at => { if (at < 0 || at + 4 > bytes.length) throw incomplete(); return bytes.readUInt32LE(at); };
  const pe = u32(0x3c), sections = u16(pe + 6), optional = pe + 24, table = optional + u16(pe + 20);
  if (u16(optional) !== 0x20b) throw Error('PLUGIN_X64_DLL_REQUIRED');
  const directories = optional + 112;   // PE32+: export = entry 0, import = entry 1 (8 bytes each)
  const toOffset = rva => {
    for (let i = 0; i < sections; i++) {
      const at = table + i * 40, virtualSize = u32(at + 8), virtualAddress = u32(at + 12), rawSize = u32(at + 16), rawPointer = u32(at + 20);
      if (rva >= virtualAddress && rva < virtualAddress + Math.max(virtualSize, rawSize)) return rawPointer + (rva - virtualAddress);
    }
    throw incomplete();
  };
  const text = offset => { const end = bytes.indexOf(0, offset); if (offset < 0 || end < 0) throw incomplete(); return bytes.toString('latin1', offset, end); };
  const exports = [], imports = [];
  const exportRva = u32(directories), importRva = u32(directories + 8);
  if (exportRva) {
    const at = toOffset(exportRva), count = u32(at + 24), names = toOffset(u32(at + 32));
    for (let i = 0; i < count; i++) exports.push(text(toOffset(u32(names + i * 4))));
  }
  if (importRva) {
    for (let at = toOffset(importRva); ; at += 20) {
      const nameRva = u32(at + 12);
      if (!nameRva) break;
      imports.push(text(toOffset(nameRva)).toLowerCase());
    }
  }
  return { exports, imports };
}

/** Structural checks of the x64 plugin DLL. With `version`, the binary must also carry the matching "[NVU PRO x.y.z]" log marker. */
function verifyPlugin(file, { version } = {}) {
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
  const { exports, imports } = readPeTables(bytes);
  if (!REQUIRED_EXPORTS.every(name => exports.includes(name))) throw Error('PLUGIN_EXPORTS_REQUIRED');
  const dynamic = imports.filter(name => FORBIDDEN_IMPORTS.test(name));
  if (dynamic.length) throw Error(`PLUGIN_RUNTIME_DEPENDENCY:${dynamic.join(',')}`);
  if (version && !bytes.includes(Buffer.from(`[NVU PRO ${version}]`))) throw Error('PLUGIN_VERSION_MARKER_MISSING');
  const authenticode = readAuthenticode(bytes);
  return { bytes: bytes.length, machine: 'x64', signed: authenticode.present, sha256: createHash('sha256').update(bytes).digest('hex'), exports, imports };
}
module.exports = { verifyPlugin, readPeTables };
