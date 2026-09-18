import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { gunzip as gunzipCallback } from "node:zlib";
import { promisify } from "node:util";
import { resolve } from "node:path";

const gunzip = promisify(gunzipCallback);

const root = process.cwd();
const workerSource = resolve(root, "node_modules/tesseract.js/dist/worker.min.js");
const coreSourceCandidates = [
  resolve(root, "node_modules/tesseract.js-core"),
  resolve(root, "node_modules/tesseract.js/node_modules/tesseract.js-core"),
  // pnpm may place transitive packages in the virtual store's hoisted node_modules.
  resolve(root, "node_modules/.pnpm/node_modules/tesseract.js-core"),
];
const publicRoot = resolve(root, "public/tesseract");
const publicTessdataRoot = resolve(root, "public/tessdata");
const compressedLangSource = resolve(publicTessdataRoot, "eng.traineddata.gz");
const uncompressedLangTarget = resolve(publicTessdataRoot, "eng.traineddata");
const workerTarget = resolve(publicRoot, "worker.min.js");
const coreTargetDir = resolve(publicRoot, "core");

const requiredCoreFiles = [
  "tesseract-core.wasm.js",
  "tesseract-core-simd.wasm.js",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
];

const isFile = async (path) => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

const assertFile = async (path, label, minBytes = 1024) => {
  if (!(await isFile(path))) {
    throw new Error(
      `[NVU OCR] ${label} não encontrado em ${path}. Execute npm install antes de iniciar/buildar o projeto.`,
    );
  }

  const info = await stat(path);
  if (info.size < minBytes) {
    throw new Error(
      `[NVU OCR] ${label} inválido/vazio em ${path} (${info.size} bytes). Reinstale as dependências antes do build.`,
    );
  }
};

const resolveCoreSourceDir = async () => {
  for (const candidate of coreSourceCandidates) {
    if (await isFile(resolve(candidate, requiredCoreFiles[0]))) return candidate;
  }

  throw new Error(
    "[NVU OCR] tesseract.js-core não foi encontrado no node_modules. Execute npm install e tente novamente.",
  );
};

await assertFile(workerSource, "worker do Tesseract.js");
await assertFile(compressedLangSource, "modelo de idioma gzip", 500_000);
await mkdir(publicTessdataRoot, { recursive: true });
await writeFile(uncompressedLangTarget, await gunzip(await readFile(compressedLangSource)));
await assertFile(uncompressedLangTarget, "modelo de idioma descompactado", 500_000);
const coreSourceDir = await resolveCoreSourceDir();
for (const fileName of requiredCoreFiles) {
  await assertFile(resolve(coreSourceDir, fileName), `core OCR ${fileName}`);
}

await mkdir(coreTargetDir, { recursive: true });
await copyFile(workerSource, workerTarget);
await assertFile(workerTarget, "worker local publicado");

// Copy all generated core runtime files so Tesseract.js can select the best
// WASM/SIMD build supported by each device without reaching a CDN.
const coreEntries = await readdir(coreSourceDir, { withFileTypes: true });
for (const entry of coreEntries) {
  if (!entry.isFile() || !/^tesseract-core.*\.(?:js|wasm)$/.test(entry.name)) continue;
  const sourcePath = resolve(coreSourceDir, entry.name);
  const targetPath = resolve(coreTargetDir, entry.name);
  await assertFile(sourcePath, `core OCR ${entry.name}`);
  await copyFile(sourcePath, targetPath);
  await assertFile(targetPath, `core OCR local ${entry.name}`);
}

console.log("[NVU OCR] recursos locais do Tesseract preparados em public/tesseract");
