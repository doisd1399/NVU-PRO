import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const expectedOtaManifestUrl = String(
  process.env.VITE_NVU_OTA_MANIFEST_URL || packageJson.otaManifestUrl || "",
).trim();
const expectedOtaEnabled =
  String(
    process.env.VITE_NVU_SELF_HOSTED_OTA_ENABLE ||
      packageJson.selfHostedOtaEnabled ||
      false,
  ).trim().toLowerCase() === "true";

const requiredFiles = [
  ["nvu-build.json", 50],
  ["tessdata/eng.traineddata.gz", 1_000_000],
  ["tesseract/worker.min.js", 50_000],
  ["tesseract/core/tesseract-core.wasm.js", 1_000_000],
  ["tesseract/core/tesseract-core.wasm", 1_000_000],
  ["tesseract/core/tesseract-core-simd.wasm.js", 1_000_000],
  ["tesseract/core/tesseract-core-simd.wasm", 1_000_000],
  ["tesseract/core/tesseract-core-lstm.wasm.js", 1_000_000],
  ["tesseract/core/tesseract-core-lstm.wasm", 1_000_000],
  ["tesseract/core/tesseract-core-simd-lstm.wasm.js", 1_000_000],
  ["tesseract/core/tesseract-core-simd-lstm.wasm", 1_000_000],
];

for (const [relativePath, minBytes] of requiredFiles) {
  const filePath = resolve(dist, relativePath);
  let info;
  try {
    info = await stat(filePath);
  } catch {
    throw new Error(`[NVU WEB RELEASE] arquivo obrigatório ausente: dist/${relativePath}`);
  }

  if (!info.isFile() || info.size < minBytes) {
    throw new Error(
      `[NVU WEB RELEASE] arquivo inválido: dist/${relativePath} (${info.size} bytes; mínimo ${minBytes}).`,
    );
  }
}

const manifest = JSON.parse(
  await readFile(resolve(dist, "nvu-build.json"), "utf8"),
);
if (manifest.version !== packageJson.version) {
  throw new Error(
    `[NVU WEB RELEASE] versão divergente: manifesto=${manifest.version}, package=${packageJson.version}.`,
  );
}
if (manifest.source !== "nvu-web" || !manifest.buildId || !manifest.generatedAt) {
  throw new Error("[NVU WEB RELEASE] manifesto nvu-build.json incompleto.");
}
if (manifest.runtimeRevision !== packageJson.gtoWebRuntimeRevision) {
  throw new Error(
    `[NVU WEB RELEASE] revisão divergente: manifesto=${manifest.runtimeRevision}, package=${packageJson.gtoWebRuntimeRevision}.`,
  );
}
if (manifest.capacitorRuntime !== packageJson.capacitorRuntime) {
  throw new Error(
    `[NVU WEB RELEASE] runtime divergente: manifesto=${manifest.capacitorRuntime}, package=${packageJson.capacitorRuntime}.`,
  );
}
if (manifest.otaEnabled !== expectedOtaEnabled) {
  throw new Error(
    `[NVU WEB RELEASE] otaEnabled divergente: manifesto=${manifest.otaEnabled}, esperado=${expectedOtaEnabled}.`,
  );
}
if (expectedOtaEnabled) {
  if (!expectedOtaManifestUrl || manifest.otaManifestUrl !== expectedOtaManifestUrl) {
    throw new Error(
      `[NVU WEB RELEASE] URL OTA ausente ou divergente: manifesto=${manifest.otaManifestUrl || ""}, esperado=${expectedOtaManifestUrl}.`,
    );
  }
  const otaUrl = new URL(expectedOtaManifestUrl);
  if (otaUrl.protocol !== "https:") {
    throw new Error("[NVU WEB RELEASE] manifesto OTA deve usar HTTPS.");
  }
}

console.log(
  `[NVU WEB RELEASE] aprovado: versão ${manifest.version}, OCR local e manifesto presentes no dist.`,
);
