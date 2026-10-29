import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const apkDir = path.join(root, "dist-apk");
const apks = fs.existsSync(apkDir) ? fs.readdirSync(apkDir).filter((f) => f.endsWith(".apk")) : [];
if (!apks.length && !process.argv[2]) {
  console.error("APK INTEGRITY FAIL: nenhum APK encontrado em dist-apk/");
  process.exit(1);
}
const apk = process.argv[2] ? path.resolve(root, process.argv[2]) : path.join(apkDir, apks[0]);
const listing = execFileSync("unzip", ["-l", apk], { encoding: "utf8" });
const requiredFiles = ["assets/public/nvu-build.json", "assets/public/index.html"];
for (const file of requiredFiles) {
  if (!listing.includes(file)) {
    console.error(`APK INTEGRITY FAIL: ${file} ausente`);
    process.exit(1);
  }
}

const tmp = path.join(root, ".apk-integrity-tmp");
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
execFileSync("unzip", ["-q", apk, "assets/public/*"], { cwd: tmp });

const manifest = JSON.parse(fs.readFileSync(path.join(tmp, "assets/public/nvu-build.json"), "utf8"));
if (manifest.nativeBundleImmutable !== true || manifest.otaEnabled !== false || manifest.otaManifestUrl !== "") {
  console.error("APK INTEGRITY FAIL: manifesto do APK não está local-first/imutável.");
  process.exit(1);
}
if (!/^[a-f0-9]{64}$/.test(manifest.sourceSha256 || "")) {
  console.error("APK INTEGRITY FAIL: hash da fonte Web ausente.");
  process.exit(1);
}

function filesUnder(dir) {
  const result = [];
  const walk = (current, prefix = "") => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      // Build tooling may leave dot-prefixed temporary OCR files in Web assets;
      // aapt intentionally omits them from the APK and they are not resources.
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(current, entry.name);
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) walk(absolute, relative);
      else result.push(relative);
    }
  };
  walk(dir);
  return result.sort();
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const sourcePublic = path.join(root, "android/app/src/main/assets/public");
const apkPublic = path.join(tmp, "assets/public");
const sourceFiles = filesUnder(sourcePublic);
const apkFiles = filesUnder(apkPublic);
if (sourceFiles.length !== apkFiles.length || sourceFiles.some((file, index) => file !== apkFiles[index])) {
  console.error("APK INTEGRITY FAIL: conjunto de arquivos assets/public diverge do APK");
  process.exit(1);
}
for (const file of sourceFiles) {
  const sourceHash = sha256(path.join(sourcePublic, file));
  const apkHash = sha256(path.join(apkPublic, file));
  if (sourceHash !== apkHash) {
    console.error(`APK INTEGRITY FAIL: hash divergente em assets/public/${file}`);
    process.exit(1);
  }
}

const distDir = path.join(root, "dist");
const distFiles = filesUnder(distDir);
const generatedBridgeFiles = new Set(["cordova.js", "cordova_plugins.js"]);
const compressedOcrModel = "tessdata/eng.traineddata.gz";
const androidOcrModel = "tessdata/eng.traineddata";
const comparableSourceFiles = sourceFiles.filter((file) => !generatedBridgeFiles.has(file) && file !== androidOcrModel);
const sourceComparableSet = new Set(comparableSourceFiles);
const distMissing = distFiles.filter((file) => {
  if ((file === compressedOcrModel || file === androidOcrModel)
      && (sourceFiles.includes(compressedOcrModel) || sourceFiles.includes(androidOcrModel))) return false;
  return !sourceComparableSet.has(file);
});
const sourceStale = comparableSourceFiles.filter((file) => !distFiles.includes(file));
if (distMissing.length || sourceStale.length) {
  console.error("APK INTEGRITY FAIL: assets/public diverge do dist");
  if (distMissing.length) console.error(`Ausentes no assets/public: ${distMissing.join(", ")}`);
  if (sourceStale.length) console.error(`Obsoletos no assets/public: ${sourceStale.join(", ")}`);
  process.exit(1);
}
for (const file of distFiles) {
  if ((file === compressedOcrModel || file === androidOcrModel)
      && (sourceFiles.includes(compressedOcrModel) || sourceFiles.includes(androidOcrModel))) continue;
  if (sha256(path.join(distDir, file)) !== sha256(path.join(sourcePublic, file))) {
    console.error(`APK INTEGRITY FAIL: dist/assets hash divergente em ${file}`);
    process.exit(1);
  }
}

const javascriptFiles = apkFiles.filter((file) => file.endsWith(".js"));
const javascriptText = javascriptFiles
  .map((file) => fs.readFileSync(path.join(apkPublic, file), "utf8"))
  .join("\n");
const markers = [
  "Suspensão operacional",
  "Suspender conta",
  "Reativar conta",
  "Remover da frota",
  "Responsável pela empresa",
  "Atualiza Authentication, Firestore e sessões",
];
const missing = markers.filter((marker) => !javascriptText.includes(marker));
if (missing.length) {
  console.error(`APK INTEGRITY FAIL: marcadores Senior ausentes: ${missing.join(", ")}`);
  process.exit(1);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`APK INTEGRITY PASS ${path.basename(apk)}; files=${apkFiles.length}; otaEnabled=${manifest.otaEnabled}; nativeBundleImmutable=${manifest.nativeBundleImmutable}`);
