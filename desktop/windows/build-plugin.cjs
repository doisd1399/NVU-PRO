const { spawnSync } = require('node:child_process');
const path = require('node:path');
const dir = path.join(__dirname, 'plugin');
const configure = process.platform === 'win32' ? ['-A','x64'] : process.env.NVU_WINDOWS_CROSS === '1' ? ['-DCMAKE_TOOLCHAIN_FILE='+path.join(dir,'mingw-x64.cmake')] : null;
if(!configure)throw Error('Use Windows com Build Tools C++, ou NVU_WINDOWS_CROSS=1 com CMake/MinGW x64 POSIX.');
for (const args of [['-S', dir, '-B', path.join(dir, 'build'), ...configure], ['--build', path.join(dir, 'build'), '--config', 'Release']]) {
  const r = spawnSync('cmake', args, { stdio: 'inherit', shell: false }); if (r.status !== 0) process.exit(r.status || 1);
}
const fs = require('node:fs');
const nested = path.join(dir, 'bin/Release/nvu_scs_telemetry.dll');
if (fs.existsSync(nested)) fs.copyFileSync(nested, path.join(dir, 'bin/nvu_scs_telemetry.dll'));
