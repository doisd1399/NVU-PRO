import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const site = "https://stirring-pavlova-ca6808.netlify.app";
const channel = "production-358";
const root = path.resolve(new URL(".", import.meta.url).pathname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const webVersion = String(packageJson.version || "").trim();
const expected = {
  webVersion,
  nativeChannel: channel,
  nativeVersionCode: 358,
  bundleId: `${channel}-${webVersion}`,
  runtimeRevision: "R3.34-PC-WEB-AUTH-ARCHITECTURE-MODULAR",
};

const artifactDir = path.join(root, `release-artifacts-production-358-${webVersion}`);
const remoteZip = `/tmp/nvu-public-bundle-${webVersion}.zip`;
const reportPath = path.join(artifactDir, "PUBLIC_VALIDATION.json");
const historicalChannels = [357];

const fail = (message) => {
  console.error(`PUBLIC OTA VALIDATION FAIL: ${message}`);
  process.exit(1);
};

const curlText = (url) => {
  const result = spawnSync(
    "curl",
    ["-fsSL", "--retry", "5", "--retry-all-errors", "--retry-delay", "2", "-w", "\\n%{http_code}", url],
    { encoding: "utf8" },
  );
  if (result.status !== 0) fail(`${url} não pôde ser consultada: ${result.stderr || "erro curl"}`);
  const output = String(result.stdout || "");
  const marker = output.lastIndexOf("\n");
  const body = marker >= 0 ? output.slice(0, marker) : output;
  const status = Number(marker >= 0 ? output.slice(marker + 1).trim() : 0);
  if (status !== 200) fail(`${url} retornou HTTP ${status || "indisponível"}`);
  return body;
};

const getJson = async (url) => {
  const text = curlText(url);
  try {
    return { json: JSON.parse(text) };
  } catch {
    fail(`${url} não retornou JSON válido`);
  }
};

const sameOriginHttps = (value) => {
  const parsed = new URL(value);
  return parsed.protocol === "https:" && parsed.origin === site;
};

const manifestUrl = `${site}/ota/${channel}/manifest.json`;
const { json: build } = await getJson(`${site}/nvu-build.json`);
const { json: manifest } = await getJson(manifestUrl);

if (String(build.version) !== expected.webVersion) fail(`nvu-build.version=${build.version}`);
if (String(build.runtimeRevision) !== expected.runtimeRevision) fail("runtimeRevision do build público divergente");
if (build.otaEnabled !== true) fail("nvu-build.otaEnabled não está true");
if (String(build.otaManifestUrl || "") !== manifestUrl) fail("nvu-build.otaManifestUrl divergente");
if (String(manifest.webVersion) !== expected.webVersion) fail("webVersion do manifesto divergente");
if (String(manifest.nativeChannel) !== expected.nativeChannel) fail("nativeChannel divergente");
if (Number(manifest.nativeVersionCode) !== expected.nativeVersionCode) fail("nativeVersionCode divergente");
if (String(manifest.bundleId) !== expected.bundleId) fail("bundleId divergente");
if (String(manifest.runtimeRevision) !== expected.runtimeRevision) fail("runtimeRevision do manifesto divergente");
if (!/^[a-f0-9]{64}$/i.test(String(manifest.checksum || ""))) fail("checksum do manifesto ausente ou inválido");
if (!manifest.signature || String(manifest.signature).length < 32) fail("assinatura ausente ou curta");
if (!sameOriginHttps(String(manifest.downloadUrl))) fail("downloadUrl não é HTTPS same-origin");
if (String(manifest.downloadUrl) !== `${site}/ota/${channel}/nvu-live-update-${expected.webVersion}.zip`) {
  fail("downloadUrl não corresponde ao bundle esperado");
}

const statusResult = spawnSync(
  "curl",
  ["-sS", "--http1.1", "-L", "--retry", "8", "--retry-all-errors", "--retry-delay", "2", "-o", "/dev/null", "-w", "\\n%{http_code}", manifest.downloadUrl],
  { encoding: "utf8" },
);
const bundleStatus = Number(String(statusResult.stdout || "").trim());
if (statusResult.status !== 0 || bundleStatus !== 200) fail(`bundle remoto retornou HTTP ${bundleStatus || "indisponível"}`);
const downloadResult = spawnSync(
  "curl",
  ["-fL", "--http1.1", "--retry", "8", "--retry-all-errors", "--retry-delay", "2", "-C", "-", "-o", remoteZip, manifest.downloadUrl],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
if (downloadResult.status !== 0) fail(`download resiliente do bundle falhou: ${downloadResult.stderr || downloadResult.stdout}`);
const bundleBytes = fs.readFileSync(remoteZip);
const remoteChecksum = crypto.createHash("sha256").update(bundleBytes).digest("hex");
if (remoteChecksum !== String(manifest.checksum).toLowerCase()) fail(`checksum remoto=${remoteChecksum}`);

const zipTest = spawnSync("unzip", ["-tq", remoteZip], { encoding: "utf8" });
if (zipTest.status !== 0) fail(`unzip -tq falhou: ${zipTest.stderr || zipTest.stdout}`);

const historical = {};
for (const historicalChannel of historicalChannels) {
  const url = `${site}/ota/production-${historicalChannel}/manifest.json`;
  curlText(url);
  historical[historicalChannel] = { status: 200, ok: true };
}

const result = {
  validatedAt: new Date().toISOString(),
  site,
  manifestUrl,
  build: {
    version: build.version,
    runtimeRevision: build.runtimeRevision,
    buildId: build.buildId,
    otaEnabled: build.otaEnabled,
    otaManifestUrl: build.otaManifestUrl,
  },
  manifest: {
    bundleId: manifest.bundleId,
    webVersion: manifest.webVersion,
    nativeChannel: manifest.nativeChannel,
    nativeVersionCode: manifest.nativeVersionCode,
    runtimeRevision: manifest.runtimeRevision,
    downloadUrl: manifest.downloadUrl,
    checksum: manifest.checksum,
    signaturePresent: Boolean(manifest.signature),
    signatureRequired: Boolean(manifest.signatureRequired),
  },
  bundle: {
    httpStatus: bundleStatus,
    bytes: bundleBytes.length,
    sha256: remoteChecksum,
    zipIntegrity: true,
  },
  historical,
};
fs.mkdirSync(artifactDir, { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);
console.log("PUBLIC OTA VALIDATION PASS");
console.log(`build=${build.version}; runtime=${build.runtimeRevision}`);
console.log(`manifest=${manifest.bundleId}; native=${manifest.nativeChannel}/${manifest.nativeVersionCode}`);
console.log(`bundleBytes=${bundleBytes.length}; sha256=${remoteChecksum}; zipIntegrity=true`);
console.log(`historical=${historicalChannels.map((item) => `${item}:200`).join(",")}`);
console.log(`report=${reportPath}`);
