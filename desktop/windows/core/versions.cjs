// What is REALLY running: application, web bundle and plugin. Nothing here is inferred from a folder or file name.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const readJson = (file, fsImpl = fs) => { try { return JSON.parse(fsImpl.readFileSync(file, 'utf8')); } catch { return null; } };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function webBuild(webDir, fsImpl = fs) {
  const info = readJson(path.join(webDir, 'nvu-build.json'), fsImpl);
  let indexPresent = false; try { indexPresent = fsImpl.statSync(path.join(webDir, 'index.html')).isFile(); } catch { /* reported below */ }
  return { directory: webDir, indexPresent, version: info?.version || null, buildId: info?.buildId || null, generatedAt: info?.generatedAt || null,
    runtimeRevision: info?.runtimeRevision || null, ok: indexPresent && !!info?.version };
}
/** The plugin that ships INSIDE this application, checked against the manifest written by the build (after signing). */
function pluginPackage(dll, manifestFile, expectedVersion, fsImpl = fs) {
  const out = { file: dll, present: false, bytes: 0, sha256: null, version: null, expectedVersion, manifest: null, consistent: false, problem: null };
  let bytes; try { bytes = fsImpl.readFileSync(dll); } catch { out.problem = 'PLUGIN_BINARY_MISSING'; return out; }
  out.present = true; out.bytes = bytes.length; out.sha256 = sha256(bytes);
  if (bytes.subarray(0, 2).toString() !== 'MZ') { out.problem = 'PLUGIN_BINARY_INVALID'; return out; }
  const manifest = readJson(manifestFile, fsImpl);
  if (!manifest) { out.problem = 'PLUGIN_MANIFEST_MISSING'; return out; }
  out.manifest = { version: manifest.version, sha256: manifest.sha256, bytes: manifest.bytes, signed: manifest.signed === true };
  out.version = manifest.version;
  if (manifest.sha256 !== out.sha256 || manifest.bytes !== out.bytes) out.problem = 'PLUGIN_MANIFEST_MISMATCH';
  else if (manifest.version !== expectedVersion) out.problem = 'PLUGIN_VERSION_MISMATCH';
  else out.consistent = true;
  return out;
}
function collectVersions({ app, process: proc = process, webDir, plugin, pkg, packaged }) {
  return {
    app: { name: pkg.name, productName: 'NVU PRO', version: app.getVersion(), packaged, executable: proc.execPath, resources: proc.resourcesPath || null,
      electron: proc.versions?.electron || null, chrome: proc.versions?.chrome || null, node: proc.versions?.node || null, platform: proc.platform, arch: proc.arch },
    web: webBuild(webDir),
    plugin: { expectedVersion: pkg.nvu?.pluginVersion || null, expectedSha256: plugin?.sha256 || null, packaged: plugin ? { present: plugin.present, version: plugin.version, consistent: plugin.consistent, problem: plugin.problem, signed: plugin.manifest?.signed === true } : null },
    generatedAt: new Date().toISOString(),
  };
}
module.exports = { readJson, sha256, webBuild, pluginPackage, collectVersions };
