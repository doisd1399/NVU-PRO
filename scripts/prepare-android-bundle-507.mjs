import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const capacitorCli = path.resolve(path.dirname(require.resolve('@capacitor/cli')), '../bin/capacitor');
// Invoke the installed CLI in this project explicitly. A linked node_modules
// must not make npm exec select a different project's native output directory.
for (const args of [
  [capacitorCli, 'copy', 'android'],
  ['scripts/prepare-capacitor-assets.mjs'],
  ['scripts/verify-capacitor-assets.mjs'],
  ['scripts/verify-capacitor-local.mjs'],
]) {
  const result = spawnSync(process.execPath, args, {
    cwd: root, env: process.env, stdio: 'inherit', timeout: 120000,
  });
  if (result.error || result.status !== 0) {
    if (result.error) console.error(result.error.message);
    process.exit(result.status || 1);
  }
}
console.log('ANDROID_BUNDLE_507_PASS: generated tree cleaned; program assets, OCR and local runtime verified');
