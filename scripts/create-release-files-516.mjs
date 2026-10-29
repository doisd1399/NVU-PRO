// Create integrity map after npm run build and before Capacitor asset sync.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const dist = resolve(root, 'dist');
const build = JSON.parse(await readFile(resolve(dist, 'nvu-build.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(root, 'reports/source-manifest-516.json'), 'utf8'));
if (build.version !== '2.3.192' || manifest.release !== '1.0.516') throw Error('516_VERSION_MISMATCH');
const getSha = (buf) => createHash('sha256').update(buf).digest('hex');
const walk = async (path) => {
  let names = [];
  for (const item of await readdir(path, { withFileTypes: true })) {
    const full = resolve(path, item.name);
    if (item.isDirectory()) names.push(...await walk(full));
    else if (item.isFile() && !item.name.startsWith('release-files-')) names.push(full);
  }
  return names;
};
const files = {};
for (const file of (await walk(dist)).sort()) files[relative(dist, file).replaceAll('\\', '/')] = getSha(await readFile(file));
if (Object.keys(files).length < 120) throw Error('516_INCOMPLETE_DIST');
const out = {
  release: '1.0.516',
  webVersion: '2.3.192',
  sourceManifestSHA256: getSha(await readFile(resolve(root, 'reports/source-manifest-516.json'))),
  buildId: build.buildId,
  files,
};
await writeFile(resolve(dist, 'release-files-516.json'), JSON.stringify(out, null, 2) + '\n');
console.log('RELEASE_516_DIST_HASHES_PASS', Object.keys(files).length);
