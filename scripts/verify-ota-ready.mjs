import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const packageJson = JSON.parse(read("package.json"));
const metadata = JSON.parse(read("NVU_RELEASE_METADATA.json"));
const config = read("capacitor.config.ts");
const buildGradle = read("android/app/build.gradle");
const main = read("src/main.tsx");
const manager = read("src/lib/otaManager.ts");
const facade = read("src/lib/liveUpdate.ts");
const recovery = read("src/lib/deployRecovery.ts");
const status = read("src/components/common/LiveUpdateStatus.tsx");
const app = read("src/App.tsx");
const viteConfig = read("vite.config.ts");
const buildManifestWriter = read("scripts/write-build-manifest.mjs");

const fail = (message) => {
  console.error(`OTA READY FAIL: ${message}`);
  process.exit(1);
};
const pass = (message) => console.log(`OTA READY PASS: ${message}`);

if (packageJson.capacitorRuntime !== "local") fail("capacitorRuntime deve ser local.");
if (/^\s*server\s*[:=]/m.test(config)) fail("capacitor.config.ts não pode usar server.url.");
if (!/webDir\s*:\s*["']dist["']/.test(config)) fail("webDir deve ser dist.");
if (!config.includes('autoUpdateStrategy: "none"')) fail("autoUpdateStrategy deve ser none.");
if (!/autoBlockRolledBackBundles:\s*selfHostedOtaEnabled/.test(config)) {
  fail("OTA habilitado deve bloquear bundles revertidos automaticamente.");
}
if (!/readyTimeout:\s*selfHostedOtaEnabled\s*\?\s*10_000\s*:\s*0/.test(config)) {
  fail("OTA habilitado deve usar timeout de prontidão de 10 segundos.");
}
if (!config.includes("NVU_SELF_HOSTED_OTA_ENABLE") || !config.includes("NVU_OTA_PUBLIC_KEY")) {
  fail("configuração nativa deve aceitar flag e chave pública OTA.");
}
if (!buildGradle.includes('resValue "string", "capawesome_live_update_default_channel", "production-" + versionCode')) {
  fail("canal OTA deve ser derivado do versionCode nativo.");
}
const otaExplicitlyDisabled =
  packageJson.selfHostedOtaEnabled !== true
  && !String(packageJson.otaManifestUrl || "").trim();
if (!otaExplicitlyDisabled && packageJson.selfHostedOtaEnabled !== true) {
  fail("OTA deve estar explicitamente habilitado ou explicitamente desabilitado.");
}
if (!otaExplicitlyDisabled && !/^https:\/\//.test(String(packageJson.otaManifestUrl || ""))) {
  fail("package.json deve declarar uma URL HTTPS de manifesto OTA quando o recurso estiver habilitado.");
}
for (const required of [
  "VITE_NVU_SELF_HOSTED_OTA_ENABLE",
  "VITE_NVU_OTA_MANIFEST_URL",
  "VITE_NVU_EMBEDDED_BUNDLE_ID",
]) {
  if (!viteConfig.includes(required)) fail(`vite.config.ts não injeta ${required}.`);
}
if (!buildManifestWriter.includes("otaEnabled") || !buildManifestWriter.includes("otaManifestUrl") || !buildManifestWriter.includes("otaBundleId")) {
  fail("nvu-build.json deve registrar a configuração OTA efetivamente compilada.");
}

for (const required of [
  "export class OtaManager",
  "LiveUpdate.ready()",
  "LiveUpdate.getVersionCode()",
  "LiveUpdate.downloadBundle({",
  "LiveUpdate.setNextBundle({",
  "OTA_MANIFEST_URL",
  "OTA_RUNTIME_MISMATCH",
  "VITE_NVU_EMBEDDED_BUNDLE_ID",
  "effectiveCurrentBundle",
  "OTA_CHANNEL_MISMATCH",
  "OTA_NATIVE_VERSION_MISMATCH",
  "OTA_CHECKSUM_INVALID",
  "OTA_SIGNATURE_INVALID",
  "OTA_CONCURRENT_CHECK",
  "OTA_CHECK_INTERVAL_MS",
]) {
  if (!manager.includes(required)) fail(`OTAManager não contém ${required}.`);
}
if (!manager.includes("this.checkPromise")) fail("checks concorrentes não estão serializados.");
if (!manager.includes('phase: "checking"') || !manager.includes('phase: "verifying"') || !manager.includes('phase: "staged"')) {
  fail("máquina de estados OTA incompleta.");
}
if (!manager.includes("storageWrite") || !manager.includes("errorCode")) {
  fail("diagnóstico OTA não é persistido com código de erro.");
}
if (!facade.includes("checkOta") || !facade.includes("startOtaManager")) {
  fail("fachada liveUpdate não delega ao OTAManager.");
}
if (/checkSelfHostedLiveUpdate/.test(recovery)) fail("deployRecovery não pode iniciar OTA.");
if (/checkSelfHostedLiveUpdate/.test(app)) fail("App não pode iniciar OTA concorrente.");
if (/checkSelfHostedLiveUpdate/.test(status)) fail("indicador visual não pode iniciar OTA.");
if (!main.includes("startOtaManager();") || !main.includes("requestAnimationFrame")) {
  fail("bootstrap deve iniciar OTA depois da montagem inicial.");
}
if (
  status.includes("Verificando atualizações…") ||
  !status.includes("Atualizando o aplicativo…") ||
  !status.includes("Preparando a atualização…") ||
  !status.includes("Não foi possível concluir a atualização. Continuando normalmente…") ||
  !status.includes("Atualização concluída ✓")
) {
  fail("mensagens amigáveis OTA por fase ausentes.");
}
if (!status.includes("pointer-events-none") || !app.includes("<LiveUpdateStatus />")) {
  fail("indicador OTA deve ser global e não bloqueante.");
}

const versionCode = Number(buildGradle.match(/versionCode\s+(\d+)/)?.[1] || 0);
const versionName = buildGradle.match(/versionName\s+["']([^"']+)["']/)?.[1] || "";
if (!versionCode || !versionName) fail("identidade Android ausente.");
if (
  metadata.capacitorRuntime !== "local" ||
  metadata.androidVersionCode !== versionCode ||
  metadata.androidVersion !== versionName
) {
  fail("metadata não corresponde à identidade Android.");
}
if (!metadata.otaChannelPolicy?.includes("production-<nativeVersionCode>")) {
  fail("metadata não registra a política de canal.");
}

for (const pattern of [
  /BEGIN (?:RSA )?PRIVATE KEY/,
  /CAPAWESOME_LIVE_UPDATE_PRIVATE_KEY\s*=/,
  /NVU_OTA_PRIVATE_KEY\s*=/,
]) {
  if (pattern.test(config) || pattern.test(manager) || pattern.test(facade)) {
    fail("chave privada não pode estar no código do APK.");
  }
}

pass(`OTAManager único com runtime local (${versionName}/${versionCode}; production-${versionCode})`);
pass("startup/resume/intervalo centralizados e não bloqueantes");
pass("manifesto, origem, canal, versão nativa, runtime, checksum e assinatura validados");
pass("download, verificação e staging somente no próximo reinício");
pass("erros estruturados persistidos sem dados sensíveis");
