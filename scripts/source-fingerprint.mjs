import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

async function sourceFiles(dir, prefix = '') {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) result.push(...await sourceFiles(resolve(dir, entry.name), `${name}/`));
    else if (entry.isFile()) result.push(name);
  }
  return result;
}

export async function computeSourceFingerprint(root) {
  const inputs = [
    'package.json', 'package-lock.json', 'capacitor.config.ts', 'vite.config.ts',
    ...await sourceFiles(resolve(root, 'src'), 'src/'),
  ].sort();
  const hash = createHash('sha256');
  for (const file of inputs) {
    hash.update(file).update('\0').update(await readFile(resolve(root, file))).update('\0');
  }
  return hash.digest('hex');
}
