import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const embedded = path.join(root, "android/app/src/main/assets/public");

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const expectedOtaEnabled = String(
  process.env.VITE_NVU_SELF_HOSTED_OTA_ENABLE ||
    process.env.NVU_SELF_HOSTED_OTA_ENABLE ||
    packageJson.selfHostedOtaEnabled ||
    "false",
).trim().toLowerCase() === "true";
const expectedOtaManifestUrl = String(
  process.env.VITE_NVU_OTA_MANIFEST_URL ||
    process.env.NVU_OTA_MANIFEST_URL ||
    packageJson.otaManifestUrl ||
    "",
).trim();
const buildManifestPath = path.join(dist, "nvu-build.json");
let manifestVersion = "";
if (fs.existsSync(buildManifestPath)) {
  try {
    manifestVersion = String(JSON.parse(fs.readFileSync(buildManifestPath, "utf8")).version || "");
  } catch {
    console.error("Falha ao ler dist/nvu-build.json. Execute PREPARAR-ANDROID-WINDOWS.bat novamente.");
    process.exit(1);
  }
}
if (!manifestVersion || manifestVersion !== String(packageJson.version || "")) {
  console.error(
    `Build Web obsoleto ou ausente: dist=${manifestVersion || "ausente"}, projeto=${packageJson.version || "desconhecido"}.`,
  );
  console.error("Execute PREPARAR-ANDROID-WINDOWS.bat antes de gerar o APK.");
  process.exit(1);
}

function walk(directory, prefix = "") {
  if (!fs.existsSync(directory)) return [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const distFiles = walk(dist);
const embeddedFiles = walk(embedded);
const capacitorGeneratedFiles = new Set(["cordova.js", "cordova_plugins.js"]);
const comparableEmbeddedFiles = embeddedFiles.filter(
  (file) => !capacitorGeneratedFiles.has(file),
);
const missingCapacitorFiles = [...capacitorGeneratedFiles].filter(
  (file) => !embeddedFiles.includes(file),
);
const compressedModel = "tessdata/eng.traineddata.gz";
const androidModel = "tessdata/eng.traineddata";
const missing = distFiles.filter((file) => {
  if (file === compressedModel && embeddedFiles.includes(androidModel)) return false;
  return !comparableEmbeddedFiles.includes(file);
});
const stale = comparableEmbeddedFiles.filter((file) => !distFiles.includes(file));
const duplicateAndroidModel = embeddedFiles.includes(compressedModel)
  && embeddedFiles.includes(androidModel);
function isExpectedImmutableNativeManifest(file) {
  if (file !== "nvu-build.json") return false;
  try {
    const webManifest = JSON.parse(fs.readFileSync(path.join(dist, file), "utf8"));
    const nativeManifest = JSON.parse(fs.readFileSync(path.join(embedded, file), "utf8"));
    const comparableWeb = { ...webManifest };
    const comparableNative = { ...nativeManifest };
    delete comparableWeb.otaEnabled;
    delete comparableWeb.otaManifestUrl;
    delete comparableWeb.nativeBundleImmutable;
    delete comparableNative.otaEnabled;
    delete comparableNative.otaManifestUrl;
    delete comparableNative.nativeBundleImmutable;
    return JSON.stringify(comparableWeb) === JSON.stringify(comparableNative)
      && nativeManifest.otaEnabled === expectedOtaEnabled
      && nativeManifest.otaManifestUrl === (expectedOtaEnabled ? expectedOtaManifestUrl : "")
      && nativeManifest.nativeBundleImmutable === !expectedOtaEnabled;
  } catch {
    return false;
  }
}

const changed = distFiles.filter(
  (file) => comparableEmbeddedFiles.includes(file)
    && digest(path.join(dist, file)) !== digest(path.join(embedded, file))
    && !isExpectedImmutableNativeManifest(file),
);

if (missing.length || stale.length || changed.length || missingCapacitorFiles.length || duplicateAndroidModel) {
  console.error("Falha de paridade nos assets Web embarcados.");
  if (missing.length) console.error("Ausentes:", missing.join(", "));
  if (stale.length) console.error("Obsoletos:", stale.join(", "));
  if (changed.length) console.error("Divergentes:", changed.join(", "));
  if (missingCapacitorFiles.length) {
    console.error("Gerados pelo Capacitor ausentes:", missingCapacitorFiles.join(", "));
  }
  if (duplicateAndroidModel) {
    console.error(
      "Modelo OCR duplicado no Android: execute cap sync antes de prepare:cap-assets para remover o .gz.",
    );
  }
  process.exit(1);
}

console.log(
  `✓ Fallback WebView alinhado ao dist (${distFiles.length} arquivos, SHA-256 verificado; `
    + `${capacitorGeneratedFiles.size} arquivos de bridge Capacitor presentes; `
    + "modelo OCR gzip substituído pelo equivalente descompactado no Android).",
);
