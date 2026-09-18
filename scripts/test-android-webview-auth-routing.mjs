import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const authSource = fs.readFileSync(
  path.join(root, "src/services/googleAuthService.ts"),
  "utf8",
);
const loginSource = fs.readFileSync(path.join(root, "src/pages/Login.tsx"), "utf8");

const checks = [
  [
    "detects Android WebView separately from browser Chrome",
    authSource.includes("function isAndroidWebView()") &&
      authSource.includes("Version\\/4\\.0") &&
      authSource.includes("Mobile"),
  ],
  [
    "uses native Android runtime for provider selection",
    authSource.includes("const environment: GoogleAuthEnvironment = isNativeAndroidRuntime()"),
  ],
  [
    "does not preload GIS inside Android WebView",
    authSource.includes("if (!isNativeAppRuntime())"),
  ],
  [
    "restores native session through the shared service",
    authSource.includes("restoreNativeGoogleSession") &&
      authSource.includes("FirebaseAuthentication.getCurrentUser"),
  ],
  [
    "keeps explicit login in the Login page behind the shared boundary",
    loginSource.includes("signInWithGoogleAccount()"),
  ],
  [
    "does not use signInWithPopup in the current Web source",
    !authSource.includes("signInWithPopup") && !loginSource.includes("signInWithPopup"),
  ],
];

for (const [name, passed] of checks) {
  if (!passed) {
    console.error(`FAIL ${name}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${name}`);
  }
}

if (!process.exitCode) {
  console.log(`android-webview-auth-routing: PASS ${checks.length}/${checks.length}`);
}
