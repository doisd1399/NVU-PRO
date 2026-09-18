import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const packageJson = JSON.parse(read("package.json"));
const wrapper = read("src/services/googleAuthService.ts");
const login = read("src/pages/Login.tsx");
const registerCompany = read("src/pages/RegisterCompany.tsx");
const recruitment = read("src/pages/RecruitmentApply.tsx");
const appContext = read("src/context/AppContext.tsx");
const runtimeRevision = read("src/lib/gtoRuntimeRevision.ts");
const plugin = read("android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java");
const mainActivity = read("android/app/src/main/java/com/nvu/operacional/MainActivity.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const capacitorConfig = read("capacitor.config.ts");
const localManifest = JSON.parse(read("dist/nvu-build.json"));
const fallbackManifestPath = path.join(root, "android/app/src/main/assets/public/nvu-build.json");
const fallbackManifest = fs.existsSync(fallbackManifestPath)
  ? JSON.parse(fs.readFileSync(fallbackManifestPath, "utf8"))
  : null;
const allCallers = [login, registerCompany, recruitment, appContext];
const revision = String(packageJson.gtoWebRuntimeRevision || "");
const runtimeMode = String(packageJson.capacitorRuntime || "");
const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
const versionTail = Number((versionName.match(/^1\.0\.(\d+)$/) || [])[1] || 0);

const checks = [];
const check = (name, ok) => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};

const directNativeImport = /@capacitor-firebase\/authentication/;
const directNativeCall = /FirebaseAuthentication\.(signInWithGoogle|signOut)\(/;

check("single Google auth wrapper exists", wrapper.includes("export async function signInWithGoogleAccount") && wrapper.includes('nativePluginName = "FirebaseAuthentication"'));
check("wrapper checks actual Capacitor plugin availability", wrapper.includes("Capacitor.isPluginAvailable(nativePluginName)"));
check("wrapper falls back to Firebase Web popup", wrapper.includes("signInWithWebPopup") && wrapper.includes("signInWithPopup(auth"));
check("wrapper converts native not-implemented to diagnostic error", wrapper.includes("not implemented") && wrapper.includes("isPluginRegistrationError(error)") && wrapper.includes("throw new Error(NATIVE_GOOGLE_PLUGIN_UNAVAILABLE)"));
check("wrapper keeps native token exchange when plugin is available", wrapper.includes("FirebaseAuthentication.signInWithGoogle()") && wrapper.includes("signInWithCredential") && wrapper.includes("idToken"));
check("Login uses only the shared wrapper", login.includes("signInWithGoogleAccount()") && !directNativeImport.test(login) && !directNativeCall.test(login));
check("RegisterCompany uses only the shared wrapper", registerCompany.includes("signInWithGoogleAccount()") && !directNativeImport.test(registerCompany) && !directNativeCall.test(registerCompany));
check("RecruitmentApply uses only the shared wrapper", recruitment.includes("signInWithGoogleAccount()") && !directNativeImport.test(recruitment) && !directNativeCall.test(recruitment));
check("logout uses the shared availability-safe wrapper", appContext.includes("signOutNativeGoogleIfAvailable()") && !directNativeImport.test(appContext) && !directNativeCall.test(appContext));
check("no direct FirebaseAuthentication caller remains outside wrapper", allCallers.every((source) => !directNativeImport.test(source) && !directNativeCall.test(source)));
check("native GTO bridge remains registered separately", plugin.includes('@CapacitorPlugin(name = "GtoObserver")'));
check("FirebaseAuthentication has explicit Android registration guard", mainActivity.includes("FirebaseAuthenticationPlugin.class") && mainActivity.includes('getPlugin("FirebaseAuthentication") == null') && mainActivity.includes("getBridge().registerPlugin(FirebaseAuthenticationPlugin.class)"));
const firebaseAuthDependencyDeclared = Boolean(packageJson.dependencies?.["@capacitor-firebase/authentication"]);
const firebaseAuthArtifactInstalled = fs.existsSync(path.join(root, "node_modules/@capacitor-firebase/authentication"));
const firebaseAuthLocked = fs.existsSync(path.join(root, "package-lock.json"))
  && read("package-lock.json").includes('"node_modules/@capacitor-firebase/authentication"');
check("FirebaseAuthentication native artifact is declared and reproducible", firebaseAuthDependencyDeclared
  && (firebaseAuthArtifactInstalled || firebaseAuthLocked));
check("Web and native handshake share current revision", runtimeRevision.includes(revision) && plugin.includes(revision) && /^R3\.34-PC-HF\d+$/.test(revision));
check("Android candidate is installable above the affected 1.0.229", versionCode > 229 && versionTail > 229);
const nativeTry = wrapper.slice(wrapper.indexOf("  try {"));
check("Android native branch never opens Web popup", wrapper.includes("if (!Capacitor.isNativePlatform())") && wrapper.includes("return signInWithWebPopup();") && !nativeTry.includes("return signInWithWebPopup();"));

const remoteRuntimeOk = runtimeMode === "remote"
  && /server\s*:\s*loadRemoteServer\(\)/.test(capacitorConfig)
  && /webDir\s*:\s*["']dist["']/.test(capacitorConfig)
  && localManifest.capacitorRuntime === "remote";
const localRuntimeOk = runtimeMode === "local"
  && !/server\s*:/.test(capacitorConfig)
  && /webDir\s*:\s*["']dist["']/.test(capacitorConfig)
  && localManifest.capacitorRuntime === "local"
  && fallbackManifest?.capacitorRuntime === "local";
check("APK Web runtime mode is explicit and compatible with Google auth", remoteRuntimeOk || localRuntimeOk);
check("workflow is current revision/version and release-only", (workflow.includes(revision) || workflow.includes(revision.replace("R3.34-PC-", "R3.34 "))) && workflow.includes(versionName) && workflow.includes("assembleRelease") && !workflow.includes("assembleDebug"));
check("plugin regression gate is registered in verify:release", String(packageJson.scripts?.["verify:release"] || "").includes("test:gto-r3.34-hf151-google-auth-plugin-safe"));

const failed = checks.filter(({ ok }) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF151 Google-auth checks passed.`);
if (failed.length) process.exit(1);
