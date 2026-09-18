import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const gradle = read("android/app/build.gradle");
const main = read("android/app/src/main/java/com/nvu/operacional/MainActivity.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const plugin = read("android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const gateway = read("android/app/src/main/java/com/nvu/operacional/GtoFirebaseRuntime.java");
const packageJson = JSON.parse(read("package.json"));
const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
const versionTail = Number((versionName.match(/^1\.0\.(\d+)$/) || [])[1] || 0);

const checks = [];
const check = (name, ok) => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};

const directFirebaseCall = /Firebase(?:Auth|Functions)\.getInstance\(\)/;
const nativeSources = [main, sync, plugin, service];

check("HF150 Android identity is above the crashing 1.0.226 build", versionCode > 226 && versionTail > 226);
check("single Firebase runtime gateway exists", gateway.includes("class GtoFirebaseRuntime") && gateway.includes("FirebaseApp.getApps") && gateway.includes("static FirebaseAuth auth") && gateway.includes("static FirebaseFunctions functions"));
check("gateway treats missing Firebase configuration as unavailable", gateway.includes("return null") && gateway.includes("catch (RuntimeException") && gateway.includes("isConfigured"));
check("MainActivity never calls FirebaseAuth directly during lifecycle", !directFirebaseCall.test(main) && main.includes("GtoFirebaseRuntime.currentUser(this)"));
check("native sync never calls FirebaseAuth directly outside gateway", !directFirebaseCall.test(sync) && sync.includes("GtoFirebaseRuntime.currentUser(context)"));
check("status/card paths never call FirebaseAuth directly outside gateway", !directFirebaseCall.test(plugin) && !directFirebaseCall.test(service));
check("all native Firebase access is routed through the gateway", nativeSources.every((source) => !directFirebaseCall.test(source)) && sync.includes("GtoFirebaseRuntime.functions(context"));
check("missing Firebase Functions preserves the sealed queue", sync.includes("FIREBASE_UNAVAILABLE") && sync.includes("a viagem foi preservada") && sync.includes("continue;"));
check("auth recovery listener is not attached without a configured app", sync.includes("FirebaseAuth auth = GtoFirebaseRuntime.auth(context)") && sync.includes("if (auth == null) return;") && sync.includes("auth.addAuthStateListener"));
check("Release requires protected google-services configuration", read("android/app/build.gradle").includes("google-services.json é obrigatório para o APK Release") && read("android/app/build.gradle").includes("releaseTaskRequested"));
check("Firebase remains available when valid configuration exists", gateway.includes("return FirebaseAuth.getInstance()") && gateway.includes("return FirebaseFunctions.getInstance(region)"));
check("crash regression gate is registered in verify:release", String(packageJson.scripts?.["verify:release"] || "").includes("test:gto-r3.34-hf150-firebase-startup-safe"));

const failed = checks.filter(({ ok }) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF150 Firebase-startup checks passed.`);
if (failed.length) process.exit(1);
