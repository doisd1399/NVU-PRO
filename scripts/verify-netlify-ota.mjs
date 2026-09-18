import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : fallback;
};
const siteDir = arg("--site-dir", path.join(root, ".netlify-ota-site"));
const publicKeyPath = path.resolve(
  process.env.NVU_OTA_PUBLIC_KEY_PATH || "/home/ubuntu/work/nvu-ota-keys/public.pem",
);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const packageJson = JSON.parse(read("package.json"));
const buildGradle = read("android/app/build.gradle");
const versionCode = Number(buildGradle.match(/versionCode\s+(\d+)/)?.[1] || 0);
const channel = `production-${versionCode}`;
const manifestPath = path.join(siteDir, "ota", channel, "manifest.json");
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  : null;
const fail = (message) => {
  console.error(`NETLIFY OTA VERIFY FAIL: ${message}`);
  process.exit(1);
};
const pass = (message) => console.log(`NETLIFY OTA VERIFY PASS: ${message}`);

if (!fs.existsSync(siteDir)) fail(`site directory ausente: ${siteDir}`);
if (!manifest) fail(`manifesto ausente: ${path.relative(root, manifestPath)}`);
if (!versionCode) fail("versionCode ausente");
if (manifest.artifactType !== "zip") fail("artifactType deve ser zip");
if (String(manifest.nativeVersionCode) !== String(versionCode)) fail("versionCode do manifesto divergente");
if (manifest.nativeChannel !== channel) fail("canal do manifesto divergente");
if (manifest.runtimeRevision !== packageJson.gtoWebRuntimeRevision) fail("runtimeRevision divergente");
if (manifest.webVersion !== packageJson.version) fail("webVersion divergente");
if (!manifest.bundleId || !/^[A-Za-z0-9._-]{1,120}$/.test(manifest.bundleId)) fail("bundleId inválido");
if (!/^https:\/\//.test(String(manifest.downloadUrl || ""))) fail("downloadUrl não é HTTPS");
if (!/^[a-f0-9]{64}$/i.test(String(manifest.checksum || ""))) fail("checksum inválido");
if (!String(manifest.signature || "").trim()) fail("signature ausente");
if (!fs.existsSync(publicKeyPath)) fail("chave pública não encontrada");

const bundleName = path.basename(new URL(manifest.downloadUrl).pathname);
const bundlePath = path.join(siteDir, "ota", channel, bundleName);
if (!fs.existsSync(bundlePath)) fail(`bundle ausente: ${path.relative(root, bundlePath)}`);
const bundleBuffer = fs.readFileSync(bundlePath);
const checksum = crypto.createHash("sha256").update(bundleBuffer).digest("hex");
if (checksum.toLowerCase() !== String(manifest.checksum).toLowerCase()) fail("checksum não corresponde ao ZIP");
const signatureValid = crypto.verify(
  "sha256",
  bundleBuffer,
  crypto.createPublicKey(fs.readFileSync(publicKeyPath)),
  Buffer.from(String(manifest.signature), "base64"),
);
if (!signatureValid) fail("assinatura RSA não valida o ZIP");

const zipList = spawnSync("unzip", ["-Z1", bundlePath], { encoding: "utf8" });
if (zipList.status !== 0) fail("ZIP OTA inválido");
for (const forbidden of [
  "google-services.json",
  "local.properties",
  "android/",
  "keystore",
  ".env",
  "server.cjs",
]) {
  if (zipList.stdout.split("\n").some((entry) => entry.includes(forbidden))) {
    fail(`entrada proibida no bundle: ${forbidden}`);
  }
}
for (const forbidden of ["android", "functions", "local.properties", "google-services.json", ".env"]) {
  if (fs.existsSync(path.join(siteDir, forbidden))) fail(`entrada proibida no site: ${forbidden}`);
}
if (!fs.existsSync(path.join(siteDir, "nvu-build.json"))) fail("nvu-build.json ausente no site");

pass(`site local-first pronto para canal ${channel}`);
pass(`bundle assinado e checksum válido: ${manifest.bundleId}`);
pass("site não contém projeto Android nem configurações protegidas");
