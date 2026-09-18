import https from "node:https";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFile(resolve(root, path), "utf8");
const readJson = async (path) => JSON.parse(await read(path));
const fail = (message) => {
  console.error(`HF144 FAIL: ${message}`);
  process.exit(1);
};
const pass = (message) => console.log(`HF144 PASS: ${message}`);
const getJson = (url) => new Promise((resolveJson, reject) => {
  const request = https.get(url, { headers: { "cache-control": "no-cache" } }, (response) => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => { body += chunk; });
    response.on("end", () => {
      const status = Number(response.statusCode || 0);
      if (status < 200 || status >= 300) {
        reject(new Error(`HTTP ${status}`));
        return;
      }
      try {
        resolveJson(JSON.parse(body));
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
  });
  request.on("error", reject);
  request.setTimeout(20_000, () => request.destroy(new Error("timeout")));
});

const packageJson = await readJson("package.json");
const packageRevision = String(packageJson.gtoWebRuntimeRevision || "").trim();
const runtimeMode = String(packageJson.capacitorRuntime || "").trim();
if (!packageRevision) fail("package.json não declara gtoWebRuntimeRevision.");
if (runtimeMode !== "local" && runtimeMode !== "remote") {
  fail("package.json deve declarar capacitorRuntime=local ou remote.");
}

const runtimeSource = await read("src/lib/gtoRuntimeRevision.ts");
const runtimeMatch = runtimeSource.match(/GTO_WEB_RUNTIME_REVISION\s*=\s*["']([^"']+)["']/);
const runtimeRevision = runtimeMatch?.[1]?.trim() || "";
if (packageRevision !== runtimeRevision) {
  fail("package.json e gtoRuntimeRevision.ts não têm a mesma revisão Web.");
}

const manifestSource = await read("scripts/write-build-manifest.mjs");
if (!manifestSource.includes("runtimeRevision: String(packageJson.gtoWebRuntimeRevision")) {
  fail("nvu-build.json não deriva runtimeRevision da autoridade do pacote.");
}

const requiredMarkers = [
  ["src/services/gtoWorkLauncher.ts", "buildGtoOperationContext(context)"],
  ["src/services/gtoWorkLauncher.ts", "status: \"web-runtime-mismatch\""],
  ["src/pages/driver/Dashboard.tsx", "webRuntimeRevision: GTO_WEB_RUNTIME_REVISION"],
  ["src/pages/driver/Dashboard.tsx", "result.status === \"web-runtime-mismatch\""],
  ["src/components/GtoObserverSetup.tsx", "buildGtoOperationContext(context)"],
  [
    "android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java",
    `EXPECTED_WEB_RUNTIME_REVISION = "${packageRevision}"`,
  ],
  [
    "android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java",
    'status.put("webRuntimeCompatible"',
  ],
  ["android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java", '"webRuntimeRevision"'],
];
for (const [path, marker] of requiredMarkers) {
  if (!(await read(path)).includes(marker)) {
    fail(`${path} não contém o contrato esperado: ${marker}`);
  }
}

const capacitorConfig = await read("capacitor.config.ts");
const localManifest = await readJson("dist/nvu-build.json");
if (String(localManifest.runtimeRevision || "").trim() !== packageRevision) {
  fail("dist/nvu-build.json não tem a runtimeRevision esperada.");
}
if (String(localManifest.version || "").trim() !== String(packageJson.version || "").trim()) {
  fail("dist/nvu-build.json não tem a versão esperada.");
}
if (String(localManifest.capacitorRuntime || "").trim() !== runtimeMode) {
  fail(`dist/nvu-build.json não declara capacitorRuntime=${runtimeMode}.`);
}

const remoteConfig = await readJson("capacitor.remote.json");
const remoteUrl = String(remoteConfig.url || "").trim();
if (runtimeMode === "remote") {
  if (!remoteConfig.enabled || !remoteUrl) {
    fail("runtime remote exige capacitor.remote.json habilitado com URL.");
  }
  if (!/server\s*:\s*loadRemoteServer\(\)/.test(capacitorConfig)) {
    fail("capacitor.config.ts não aponta para loadRemoteServer().");
  }
  if (!/webDir\s*:\s*["']dist["']/.test(capacitorConfig)) {
    fail("capacitor.config.ts deve manter webDir=dist para a preparação do Android.");
  }
  try {
    if (new URL(remoteUrl).protocol !== "https:") {
      fail("URL remota não usa HTTPS.");
    }
  } catch {
    fail("URL remota inválida.");
  }
} else {
  if (/server\s*:/.test(capacitorConfig) || !/webDir\s*:\s*["']dist["']/.test(capacitorConfig)) {
    fail("capacitor.config.ts local está apontando para runtime remoto ou webDir inválido.");
  }
  const fallbackManifest = await readJson("android/app/src/main/assets/public/nvu-build.json");
  if (String(fallbackManifest.runtimeRevision || "").trim() !== packageRevision) {
    fail("fallback Android não tem a runtimeRevision esperada.");
  }
  if (String(fallbackManifest.capacitorRuntime || "").trim() !== "local") {
    fail("fallback Android não declara capacitorRuntime local.");
  }
}

if (process.argv.includes("--live")) {
  if (runtimeMode !== "remote") fail("--live só pode ser usado no modo remote.");
  const manifestUrl = `${remoteUrl.replace(/\/$/, "")}/nvu-build.json`;
  let remoteManifest;
  try {
    remoteManifest = await getJson(manifestUrl);
  } catch (error) {
    fail(`não foi possível consultar o manifesto remoto (${error?.message || "erro de rede"}).`);
  }
  if (String(remoteManifest.runtimeRevision || "").trim() !== packageRevision) {
    fail("deploy Web remoto está stale: runtimeRevision diferente da fonte/bridge.");
  }
  if (String(remoteManifest.version || "").trim() !== String(packageJson.version || "").trim()) {
    fail("deploy Web remoto está stale: versão diferente do package.json.");
  }
  if (String(remoteManifest.capacitorRuntime || "").trim() !== "remote") {
    fail("deploy Web remoto não declara capacitorRuntime=remote.");
  }
  pass(`deploy remoto alinhado em ${packageRevision}`);
}

pass(`contrato Web/bridge alinhado em ${packageRevision} no modo ${runtimeMode}`);
console.log("HF144: runtime Web/bridge parity checks passed");
