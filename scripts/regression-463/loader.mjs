import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve as pathResolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

// Offline audit only: production libraries are replaced with explicit doubles.
const stub = (name) => new URL(name, import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (specifier === 'firebase/firestore') return { url: stub('mock-firestore.mjs'), shortCircuit: true };
  if (specifier === 'react') return { url: stub('mock-react.mjs'), shortCircuit: true };
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const candidate = specifier.startsWith('/') ? pathToFileURL(specifier) : new URL(specifier, context.parentURL);
    let file = fileURLToPath(candidate);
    if (file.endsWith('/src/lib/firebase') || file.endsWith('/src/lib/firebase.ts')) {
      return { url: stub('mock-firebase.mjs'), shortCircuit: true };
    }
    if (!existsSync(file)) {
      for (const ext of ['.ts', '.mts', '.js', '.mjs']) {
        if (existsSync(file + ext)) { file += ext; break; }
      }
    }
    if (/\.(ts|mts)$/.test(file) && existsSync(file)) {
      return { url: pathToFileURL(pathResolve(file)).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (/\.(ts|mts)$/.test(url)) {
    return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
  }
  return next(url, context);
}
