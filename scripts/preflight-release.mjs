import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fail = (msg) => { console.error(`PREFLIGHT FAIL: ${msg}`); process.exit(1); };
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const pkg = JSON.parse(read("package.json"));
const metadata = JSON.parse(read("NVU_RELEASE_METADATA.json"));
if (pkg.version !== metadata.webVersion) fail(`package.json version ${pkg.version} != metadata.webVersion ${metadata.webVersion}`);
if (!/^\d+\.\d+\.\d+$/.test(metadata.androidVersion || "") || !Number.isInteger(metadata.androidVersionCode) || metadata.androidVersionCode < 1) fail("metadados de versão Android inválidos");
if (metadata.functionalRelease !== `NVU-PRO-RELIABILITY-${metadata.androidVersion}`) fail("metadado source release inválido");
if (metadata.otaEnabled !== false || metadata.otaManifestUrl !== "" || pkg.selfHostedOtaEnabled !== false) fail("OTA precisa permanecer desabilitada no candidato");
if (pkg.officialStableRelease !== false) fail("o candidato não pode ser rotulado como versão estável oficial");

const gradle = read("android/app/build.gradle");
for (const marker of [
  'applicationId "com.nvu.operacional"',
  `versionCode ${metadata.androidVersionCode}`,
  `versionName "${metadata.androidVersion}"`,
  '"production-" + versionCode',
  "verifyReleaseWebBundle",
  "v2SigningEnabled true",
  "enableV3Signing true",
]) if (!gradle.includes(marker)) fail(`build.gradle sem marcador: ${marker}`);
if (gradle.includes('applicationIdSuffix ".staging"')) fail("applicationIdSuffix de staging não pode estar presente no candidato");

const cap = read("capacitor.config.ts");
if (!/appId:\s*["']com\.nvu\.operacional["']/.test(cap)) fail("capacitor.config.ts não aponta para o app Android de produção");
if (!/webDir\s*:\s*["']dist["']/.test(cap)) fail("capacitor.config.ts não aponta webDir para dist");
if (!cap.includes(`production-${metadata.androidVersionCode}`)) fail("canal nativo não corresponde aos metadados de release");
const mainActivity = read("android/app/src/main/java/com/nvu/operacional/MainActivity.java");
if (!mainActivity.includes('BuildConfig.VERSION_CODE + ":" + BuildConfig.VERSION_NAME')) fail("MainActivity não deriva a chave do cache da versão real do APK");
if (!/buildConfig\s+true/.test(gradle)) fail("BuildConfig precisa estar habilitado para a chave do cache");

const googlePath = path.join(root, "android/app/google-services.json");
if (!fs.existsSync(googlePath) || !fs.statSync(googlePath).size) fail("google-services.json obrigatório ausente");
const google = JSON.parse(fs.readFileSync(googlePath, "utf8"));
const packages = (google.client || []).map((c) => c?.client_info?.android_client_info?.package_name).filter(Boolean);
if (google.project_info?.project_id !== "vtc-frota-log") fail("google-services.json não corresponde ao Firebase de produção esperado");
if (!packages.includes("com.nvu.operacional")) fail("google-services.json não contém com.nvu.operacional");
if (packages.some((id) => id !== "com.nvu.operacional")) fail("google-services.json contém package não autorizado no APK candidate");
const oauth = (google.client || []).flatMap((c) => c?.oauth_client || []);
if (!oauth.some((c) => c.client_type === 1 && c.android_info?.package_name === "com.nvu.operacional" && c.android_info?.certificate_hash?.replace(/:/g, "").toLowerCase() === "0b4355b115d8038bb6f10788493a71a02f8035c8")) fail("OAuth Android/package/SHA-1 da keystore release não está alinhado no Firebase de produção");
if (!oauth.some((c) => c.client_type === 3)) fail("OAuth web client ausente em google-services.json");

const firebaseClient = read("src/lib/firebase.ts");
if (!firebaseClient.includes('projectId: "vtc-frota-log"') || !firebaseClient.includes('storageBucket: "vtc-frota-log.firebasestorage.app"')) fail("configuração canônica Web/Firebase não corresponde ao projeto de produção");
if (!firebaseClient.includes('firebaseConfig.projectId === "demo-nvu-v36-4-staging"')) fail("conexão com Firebase Emulator deve aceitar somente o projeto demo explícito");
if (!firebaseClient.includes("requestedProjectId !== canonicalFirebaseConfig.projectId")) fail("override de projectId não está protegido");
const googleAuth = read("src/services/googleAuthService.ts");
if (!googleAuth.includes("451561168694-9nldqgb2edr91j2flrl0m7305dd6gbj5.apps.googleusercontent.com")) fail("OAuth Web Client ID original não restaurado");

const assets = path.join(root, "android/app/src/main/assets/public");
if (fs.existsSync(assets)) {
  const stale = fs.readdirSync(assets).filter((n) => ![".gitkeep"].includes(n));
  if (stale.length) fail(`assets/public deve estar limpo antes do build; encontrado: ${stale.join(", ")}`);
}
for (const generatedDir of ["dist", "android/.gradle", "android/build", "android/app/build"]) {
  if (fs.existsSync(path.join(root, generatedDir))) fail(`output/cache antigo presente antes do Release: ${generatedDir}`);
}
const apkOutput = path.join(root, "dist-apk");
if (fs.existsSync(apkOutput) && fs.readdirSync(apkOutput).length) fail("dist-apk deve estar vazio antes do Release");
for (const file of [
  "scripts/verify-android-source-integrity.mjs",
  "scripts/verify-release-web-source.mjs",
  "scripts/verify-android-apk-integrity.mjs",
  "scripts/test-diagnostic-visibility-428.mts",
  "scripts/test-currency-and-history-contract.ts",
  "scripts/test-operation-close-pending-guard-runtime.ts",
  "scripts/test-operation-close-pending-guard.mjs",
  "scripts/test-operation-completion-queue-cleanup.ts",
  "scripts/test-operation-completion-native-cleanup.mts",
  "scripts/verify-source-516.py",
  "scripts/verify-release-516.mjs",
  "scripts/android-release.sh",
  "BUILD_ARTIFACT_PROTECTION.md",
  ".gitignore",
]) if (!fs.existsSync(path.join(root, file))) fail(`arquivo obrigatório ausente: ${file}`);

const releaseScript = read("scripts/android-release.sh");
const orderedReleaseStages = [
  "npm ci",
  "npm --prefix functions ci",
  "npm --prefix functions run build",
  "npm run verify:release-516",
  "npx --no-install cap sync android",
  "npm run prepare:cap-assets",
  "npm run verify:cap-assets",
  "npm run verify:cap-local",
  "./gradlew clean testReleaseUnitTest assembleRelease --no-daemon",
  "node scripts/verify-android-apk-integrity.mjs",
];
let previousIndex = -1;
for (const stage of orderedReleaseStages) {
  const currentIndex = releaseScript.indexOf(stage);
  if (currentIndex < 0) fail(`android-release.sh sem etapa: ${stage}`);
  if (currentIndex <= previousIndex) fail(`ordem inválida no android-release.sh: ${stage}`);
  previousIndex = currentIndex;
}
if (/^\s*(?:firebase\s+deploy|gcloud\s+(?:functions|run|app)\s+deploy|netlify\s+deploy)\b/im.test(releaseScript)) fail("script Release não pode executar deploy/publicação");
if (!releaseScript.includes("Verified using v3 scheme")) fail("script não exige assinatura APK v3");
if (!releaseScript.includes('\"$AAPT\" dump badging')) fail("script não valida applicationId/version do APK");
if (!releaseScript.includes('APK_NAME="NVU-PRO-${NVU_RELEASE_VERSION_NAME}-RELEASE.apk"')) fail("nome do APK precisa acompanhar os metadados do release");
if (!releaseScript.includes("versionCode='$NVU_RELEASE_VERSION_CODE'") || !releaseScript.includes("versionName='$NVU_RELEASE_VERSION_NAME'")) fail("script não compara a versão do APK com os metadados do release");

const apkIntegrity = read("scripts/verify-android-apk-integrity.mjs");
if (!apkIntegrity.includes('path.join(root, "dist-apk")')) fail("verificador do APK não aponta para dist-apk/");
if (apkIntegrity.includes('path.join(root, "..", "dist-apk")')) fail("verificador mantém caminho legado de APK");
const gitignore = read(".gitignore");
for (const marker of ["android/app/google-services.json", "*.jks", "*.keystore", "dist-apk/", "*.apk", "*.aab", "*.apks", "**/build/"]) if (!gitignore.includes(marker)) fail(`.gitignore sem proteção: ${marker}`);

console.log(`PREFLIGHT PASS: release NVU PRO ${metadata.androidVersion}/${metadata.androidVersionCode}, applicationId production, Firebase/OAuth prod alinhados, OTA off, certificado esperado e pipeline local sem deploy.`);
