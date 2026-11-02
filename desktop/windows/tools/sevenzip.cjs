// A 7-Zip that can OPEN NSIS installers. On Linux/macOS the 7za bundled with electron-builder can. On Windows that bundled
// 7za.exe is the reduced console build WITHOUT the NSIS handler ("Cannot open the file as archive"), so the full 7z.exe is
// needed (GitHub's Windows images and most PCs have it under Program Files). Returns null when none is available: callers must
// then say so explicitly ("not verified") instead of failing or pretending the payload was compared.
const fs = require('node:fs');
const path = require('node:path');

async function nsisCapable7z({ env = process.env, platform = process.platform, exists = fs.existsSync, bundled = async () => require('app-builder-lib/out/toolsets/7zip').getPath7za() } = {}) {
  if (env.NVU_7Z && exists(env.NVU_7Z)) return { path: env.NVU_7Z, source: 'NVU_7Z' };
  if (platform !== 'win32') return { path: await bundled(), source: 'bundled-7za' };
  for (const root of [env.ProgramFiles, env.ProgramW6432, env['ProgramFiles(x86)']].filter(Boolean)) {
    const candidate = path.win32.join(root, '7-Zip', '7z.exe');
    if (exists(candidate)) return { path: candidate, source: 'installed-7z' };
  }
  return null;
}
module.exports = { nsisCapable7z };
