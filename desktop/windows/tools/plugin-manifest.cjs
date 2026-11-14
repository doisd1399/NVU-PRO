// The plugin manifest travels next to the DLL (plugin/bin in the source tree, resources/plugin in the installed app).
// The application compares it with the DLL at start-up. Signing changes the DLL bytes, so the manifest is ALWAYS regenerated
// from the final bytes: write it after the last step that touches the file.
const fs = require('node:fs');
const path = require('node:path');
const { verifyPlugin } = require('./plugin-integrity.cjs');
const pkg = require('../package.json');
function writePluginManifest(dll, { toolchain = 'unknown', note } = {}) {
  const version = pkg.nvu.pluginVersion, info = verifyPlugin(dll, { version });
  const manifest = { name: 'nvu_scs_telemetry.dll', product: 'NVU PRO', version, sha256: info.sha256, bytes: info.bytes, machine: info.machine, signed: info.signed,
    sdk: { package: 'SCS Software Telemetry SDK 1.16', telemetryApi: '1.01' }, toolchain, builtAt: new Date().toISOString(), ...(note ? { note } : {}) };
  const file = path.join(path.dirname(dll), 'nvu_scs_telemetry.manifest.json');
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  return { file, manifest };
}
module.exports = { writePluginManifest };
if (require.main === module) { const r = writePluginManifest(path.resolve(process.argv[2]), { toolchain: process.argv[3] || 'unknown' }); console.log(JSON.stringify(r.manifest)); }
