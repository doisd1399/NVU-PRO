import fs from "node:fs";
import https from "node:https";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const readJson = (file) => JSON.parse(read(file));
const fail = (message) => {
  console.error(`Remote runtime FAIL: ${message}`);
  process.exit(1);
};
const pass = (message) => console.log(`Remote runtime PASS: ${message}`);
const getJson = (url) => new Promise((resolve, reject) => {
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
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
  });
  request.on("error", reject);
  request.setTimeout(20_000, () => request.destroy(new Error("timeout")));
});

const remoteConfig = readJson("capacitor.remote.json");
const packageJson = readJson("package.json");
const capacitorConfig = read("capacitor.config.ts");
const runtimeSource = read("src/lib/gtoRuntimeRevision.ts");
const pluginSource = read(
  "android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java",
);

if (packageJson.capacitorRuntime !== "remote") {
  fail("package.json deve declarar capacitorRuntime=remote.");
}

const remoteUrl = String(remoteConfig?.url || "").trim();
if (remoteConfig?.enabled !== true || !remoteUrl) {
  fail("capacitor.remote.json deve habilitar o runtime remoto e informar a URL.");
}

let parsedUrl;
try {
  parsedUrl = new URL(remoteUrl);
} catch {
  fail("A URL remota do Capacitor é inválida.");
}
if (parsedUrl.protocol !== "https:") {
  fail("A URL remota do Capacitor precisa usar HTTPS.");
}

if (!/server\s*:\s*loadRemoteServer\(\)/.test(capacitorConfig)) {
  fail("capacitor.config.ts não está consumindo loadRemoteServer().");
}
if (!/webDir\s*:\s*["']dist["']/.test(capacitorConfig)) {
  fail("capacitor.config.ts deve manter webDir=dist para a preparação do projeto nativo.");
}

const packageRevision = String(packageJson.gtoWebRuntimeRevision || "").trim();
const runtimeRevision =
  runtimeSource.match(/GTO_WEB_RUNTIME_REVISION\s*=\s*["']([^"']+)["']/)?.[1]?.trim() || "";
if (!packageRevision || packageRevision !== runtimeRevision) {
  fail("package.json e gtoRuntimeRevision.ts estão desalinhados.");
}
if (!pluginSource.includes(`EXPECTED_WEB_RUNTIME_REVISION = "${packageRevision}"`)) {
  fail("A bridge Android não espera a mesma revisão Web.");
}

const validateManifest = (manifest, source) => {
  if (String(manifest?.version || "").trim() !== String(packageJson.version || "").trim()) {
    fail(`${source} está em versão diferente do package.json.`);
  }
  if (String(manifest?.runtimeRevision || "").trim() !== packageRevision) {
    fail(`${source} não declara runtimeRevision=${packageRevision}.`);
  }
  if (String(manifest?.capacitorRuntime || "").trim() !== "remote") {
    fail(`${source} não declara capacitorRuntime=remote.`);
  }
};

if (process.argv.includes("--build")) {
  const localManifestPath = path.join(root, "dist/nvu-build.json");
  if (!fs.existsSync(localManifestPath)) {
    fail("dist/nvu-build.json ausente; execute npm run build antes do gate remoto.");
  }
  validateManifest(readJson("dist/nvu-build.json"), "dist/nvu-build.json");
}

if (process.argv.includes("--live")) {
  const manifestUrl = `${remoteUrl.replace(/\/$/, "")}/nvu-build.json`;
  let remoteManifest;
  try {
    remoteManifest = await getJson(manifestUrl);
  } catch (error) {
    fail(`não foi possível consultar o manifesto remoto (${error?.message || "erro de rede"}).`);
  }
  validateManifest(remoteManifest, "manifesto Netlify");
  pass(`deploy Netlify alinhado em ${packageRevision}`);
}

pass(`Capacitor Android configurado para Web remota exclusiva: ${parsedUrl.origin}`);
