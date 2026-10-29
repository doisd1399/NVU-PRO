import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const packageJson = JSON.parse(read("package.json"));
const config = read("capacitor.config.ts");
const buildGradle = read("android/app/build.gradle");
const manager = read("src/lib/otaManager.ts");
const facade = read("src/lib/liveUpdate.ts");
const main = read("src/main.tsx");
const recovery = read("src/lib/deployRecovery.ts");
const status = read("src/components/common/LiveUpdateStatus.tsx");
const app = read("src/App.tsx");
const viteConfig = read("vite.config.ts");
const buildManifestWriter = read("scripts/write-build-manifest.mjs");
const fail = (message) => { console.error(`OTA POLICY FAIL: ${message}`); process.exit(1); };
const pass = (message) => console.log(`OTA POLICY PASS: ${message}`);

const otaEnabled = packageJson.selfHostedOtaEnabled === true;
const nativeVersion = (buildGradle.match(/versionName\s+["']([^"']+)["']/) || [])[1] || "unknown";
const nativeVersionCode = (buildGradle.match(/versionCode\s+(\d+)/) || [])[1] || "unknown";
if (otaEnabled) fail(`Android ${nativeVersion} deve permanecer local-first; OTA está desabilitada no candidato.`);
if (String(packageJson.otaManifestUrl || "").trim() !== "") fail("otaManifestUrl deve ficar vazio com OTA desabilitada.");
if (/staging-(?:358|378|384)\//.test(read("package.json"))) fail("referência a canal OTA de staging encontrada no package.json.");
if (!config.includes('autoUpdateStrategy: "none"')) fail("autoUpdateStrategy deve ser none.");
if (!/webDir:\s*["']dist["']/.test(config)) fail("webDir deve ser dist.");
if (!buildGradle.includes('resValue "string", "capawesome_live_update_default_channel", "production-" + versionCode')) fail("canal nativo deve derivar do versionCode em production.");
if (!manager.includes("NATIVE_OPERATIONAL_BUNDLE_IMMUTABLE") || !manager.includes("!OTA_ENABLED")) fail("OTAManager deve ser no-op quando OTA estiver desabilitada.");
if (/checkSelfHostedLiveUpdate/.test(recovery) || /checkSelfHostedLiveUpdate/.test(app) || /checkSelfHostedLiveUpdate/.test(status) || /checkSelfHostedLiveUpdate/.test(main)) fail("não pode haver segunda autoridade OTA.");
if (!viteConfig.includes("VITE_NVU_SELF_HOSTED_OTA_ENABLE") || !viteConfig.includes("VITE_NVU_OTA_MANIFEST_URL")) fail("build deve registrar explicitamente a política OTA.");
if (!buildManifestWriter.includes("otaEnabled") || !buildManifestWriter.includes("nativeBundleImmutable")) fail("manifesto precisa registrar imutabilidade do bundle nativo.");
for (const pattern of [/BEGIN (?:RSA )?PRIVATE KEY/, /CAPAWESOME_LIVE_UPDATE_PRIVATE_KEY\s*=/, /NVU_OTA_PRIVATE_KEY\s*=/]) {
  if (pattern.test(config) || pattern.test(manager) || pattern.test(facade)) fail("chave privada OTA não pode entrar no código do APK.");
}
pass(`APK candidate ${nativeVersion}: OTA DESABILITADA e bundle local-first`);
pass(`canal nativo de produção derivado do versionCode (production-${nativeVersionCode}); canal não será publicado nesta etapa`);
pass("OTAManager permanece sem iniciar atualização remota");
pass("manifesto deve marcar nativeBundleImmutable=true com OTA desligada");
