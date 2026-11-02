// Builds the SCS telemetry plugin (MSVC on Windows, MinGW-w64 cross build elsewhere) and writes its manifest.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('./package.json');
const { writePluginManifest } = require('./tools/plugin-manifest.cjs');
const dir = path.join(__dirname, 'plugin');
const version = pkg.nvu?.pluginVersion;
if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw Error('package.json nvu.pluginVersion must be x.y.z');
const configure = process.platform === 'win32' ? ['-A', 'x64'] : process.env.NVU_WINDOWS_CROSS === '1' ? ['-DCMAKE_TOOLCHAIN_FILE=' + path.join(dir, 'mingw-x64.cmake')] : null;
if (!configure) throw Error('Use Windows com Build Tools C++, ou NVU_WINDOWS_CROSS=1 com CMake/MinGW x64 POSIX.');
for (const args of [['-S', dir, '-B', path.join(dir, 'build'), ...configure, `-DNVU_PLUGIN_VERSION=${version}`], ['--build', path.join(dir, 'build'), '--config', 'Release']]) {
  const r = spawnSync('cmake', args, { stdio: 'inherit', shell: false }); if (r.status !== 0) process.exit(r.status || 1);
}
const nested = path.join(dir, 'bin/Release/nvu_scs_telemetry.dll');
if (fs.existsSync(nested)) fs.copyFileSync(nested, path.join(dir, 'bin/nvu_scs_telemetry.dll'));
const toolchain = process.platform === 'win32' ? 'MSVC (Visual Studio generator, static CRT)' : 'MinGW-w64 posix (cross build, static libgcc/libstdc++)';
const { manifest } = writePluginManifest(path.join(dir, 'bin/nvu_scs_telemetry.dll'), { toolchain });
console.log(`PLUGIN_BUILT ${manifest.version} sha256=${manifest.sha256} bytes=${manifest.bytes}`);
