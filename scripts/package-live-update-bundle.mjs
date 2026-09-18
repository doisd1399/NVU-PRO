import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const dist = path.join(root, "dist");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const buildManifestPath = path.join(dist, "nvu-build.json");
const outputArgIndex = process.argv.indexOf("--output");
const output = outputArgIndex >= 0 && process.argv[outputArgIndex + 1]
  ? path.resolve(process.argv[outputArgIndex + 1])
  : path.join(root, "release-artifacts-ota", `nvu-live-update-${packageJson.version}.zip`);

const fail = (message) => {
  console.error(`OTA BUNDLE FAIL: ${message}`);
  process.exit(1);
};

if (!fs.existsSync(dist)) fail("dist ausente; execute npm run build antes de empacotar.");
if (!fs.existsSync(buildManifestPath)) fail("dist/nvu-build.json ausente.");

const manifest = JSON.parse(fs.readFileSync(buildManifestPath, "utf8"));
if (String(manifest.version || "") !== String(packageJson.version || "")) {
  fail("dist/nvu-build.json não corresponde à versão do package.json.");
}
if (String(manifest.runtimeRevision || "") !== String(packageJson.gtoWebRuntimeRevision || "")) {
  fail("runtimeRevision do bundle não corresponde ao contrato do projeto.");
}
if (String(manifest.capacitorRuntime || "") !== "local") {
  fail("bundle OTA deve ser produzido a partir do runtime local.");
}

const forbidden = ["google-services.json", "local.properties"];
for (const name of forbidden) {
  if (fs.existsSync(path.join(dist, name))) fail(`arquivo proibido encontrado em dist: ${name}`);
}

const versionCode = Number(
  fs.readFileSync(path.join(root, "android/app/build.gradle"), "utf8")
    .match(/versionCode\s+(\d+)/)?.[1] || 0,
);
if (!versionCode) fail("versionCode Android ausente.");

const staging = path.join(root, ".ota-staging", `nvu-live-update-${packageJson.version}`);
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });
fs.cpSync(dist, staging, { recursive: true });
for (const name of ["server.cjs", "server.cjs.map"]) {
  fs.rmSync(path.join(staging, name), { force: true });
}
fs.writeFileSync(
  path.join(staging, "nvu-ota-manifest.json"),
  `${JSON.stringify({
    artifactType: "zip",
    webVersion: packageJson.version,
    runtimeRevision: packageJson.gtoWebRuntimeRevision,
    nativeChannel: `production-${versionCode}`,
    nativeVersionCode: versionCode,
    signatureRequired: true,
    autoUpdateDefault: false,
  }, null, 2)}\n`,
);

fs.rmSync(output, { force: true });
fs.mkdirSync(path.dirname(output), { recursive: true });
const zipResult = spawnSync(
  "zip",
  ["-qr", output, "."],
  { cwd: staging, stdio: "inherit" },
);
if (zipResult.status !== 0) fail("zip não conseguiu criar o bundle OTA.");
fs.rmSync(path.join(root, ".ota-staging"), { recursive: true, force: true });
console.log(`OTA BUNDLE PASS: ${path.relative(root, output)}`);
console.log(`channel=production-${versionCode}`);
console.log(`runtimeRevision=${packageJson.gtoWebRuntimeRevision}`);
console.log("signatureRequired=true; bundle não publicado automaticamente");
