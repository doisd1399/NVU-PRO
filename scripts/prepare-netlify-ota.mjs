import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const args = process.argv.slice(2);
const readArg = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : fallback;
};
const readValueArg = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1].trim() : fallback;
};

const siteOutput = readArg("--site-output", path.join(root, ".netlify-ota-site"));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const bundlePath = readArg(
  "--bundle",
  path.join(root, "release-artifacts-ota", `nvu-live-update-${packageJson.version}.zip`),
);
const manifestUrl = readValueArg("--manifest-url", String(process.env.NVU_OTA_MANIFEST_URL || "").trim());
const privateKeyPath = path.resolve(
  String(process.env.NVU_OTA_PRIVATE_KEY_PATH || "").trim(),
);
const buildManifest = JSON.parse(
  fs.readFileSync(path.join(root, "dist", "nvu-build.json"), "utf8"),
);
const buildGradle = fs.readFileSync(
  path.join(root, "android/app/build.gradle"),
  "utf8",
);
const versionCode = Number(buildGradle.match(/versionCode\s+(\d+)/)?.[1] || 0);
const channel = `production-${versionCode}`;
const bundleId = `${channel}-${packageJson.version}`;
const bundleFileName = `nvu-live-update-${packageJson.version}.zip`;
const relativeBundlePath = `ota/${channel}/${bundleFileName}`;
const fail = (message) => {
  console.error(`NETLIFY OTA PREPARE FAIL: ${message}`);
  process.exit(1);
};

if (!fs.existsSync(path.join(root, "dist"))) fail("dist ausente; execute npm run build.");
if (!fs.existsSync(bundlePath)) fail(`bundle ausente: ${bundlePath}`);
if (!versionCode) fail("versionCode Android ausente.");
if (!/^https:\/\//.test(manifestUrl)) fail("--manifest-url deve ser HTTPS.");
if (!fs.existsSync(privateKeyPath)) fail("chave privada OTA não encontrada fora do projeto.");

const bundleBuffer = fs.readFileSync(bundlePath);
const checksum = crypto.createHash("sha256").update(bundleBuffer).digest("hex");
const signer = crypto.createSign("sha256");
for (let offset = 0; offset < bundleBuffer.length; offset += 64 * 1024 * 1024) {
  signer.update(bundleBuffer.subarray(offset, offset + 64 * 1024 * 1024));
}
signer.end();
const signature = signer.sign(crypto.createPrivateKey(fs.readFileSync(privateKeyPath))).toString("base64");
const siteOrigin = new URL(manifestUrl).origin;
const downloadUrl = `${siteOrigin}/${relativeBundlePath}`;

fs.rmSync(siteOutput, { recursive: true, force: true });
fs.mkdirSync(siteOutput, { recursive: true });
fs.cpSync(path.join(root, "dist"), siteOutput, { recursive: true });
for (const name of ["server.cjs", "server.cjs.map"]) {
  fs.rmSync(path.join(siteOutput, name), { force: true });
}
const otaDir = path.join(siteOutput, "ota", channel);
fs.mkdirSync(otaDir, { recursive: true });
fs.copyFileSync(bundlePath, path.join(otaDir, bundleFileName));

const otaManifest = {
  artifactType: "zip",
  bundleId,
  webVersion: String(packageJson.version),
  buildId: String(buildManifest.buildId || ""),
  runtimeRevision: String(packageJson.gtoWebRuntimeRevision || ""),
  nativeChannel: channel,
  nativeVersionCode: versionCode,
  downloadUrl,
  checksum,
  signature,
  signatureRequired: true,
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(
  path.join(otaDir, "manifest.json"),
  `${JSON.stringify(otaManifest, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(siteOutput, "nvu-ota-index.json"),
  `${JSON.stringify({
    channel,
    manifestUrl,
    bundleId,
    webVersion: packageJson.version,
    nativeVersionCode: versionCode,
    runtimeRevision: packageJson.gtoWebRuntimeRevision,
    signatureRequired: true,
    generatedAt: otaManifest.generatedAt,
  }, null, 2)}\n`,
);

console.log("NETLIFY OTA PREPARE PASS");
console.log(`siteOutput=${path.relative(root, siteOutput)}`);
console.log(`manifest=${path.relative(root, path.join(otaDir, "manifest.json"))}`);
console.log(`bundle=${path.relative(root, path.join(otaDir, bundleFileName))}`);
console.log(`channel=${channel}`);
console.log(`bundleId=${bundleId}`);
console.log(`checksum=${checksum}`);
console.log("privateKey=used-only-in-memory; not copied");
