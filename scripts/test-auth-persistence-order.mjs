import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const firebase = fs.readFileSync(path.join(root, "src/lib/firebase.ts"), "utf8");
const googleAuth = fs.readFileSync(path.join(root, "src/services/googleAuthService.ts"), "utf8");
const appContext = fs.readFileSync(path.join(root, "src/context/AppContext.tsx"), "utf8");

const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

assert(firebase.includes("authPersistenceReady: Promise<boolean>"), "Firebase persistence promise is not explicit");
assert(firebase.includes("setPersistence(\n  auth,\n  browserLocalPersistence"), "browserLocalPersistence is not configured");

const restoreStart = googleAuth.indexOf("export async function restoreNativeGoogleSession");
const restoreEnd = googleAuth.indexOf("\n}\n\n/**", restoreStart);
const restoreBlock = googleAuth.slice(restoreStart, restoreEnd);
assert(restoreStart >= 0 && restoreEnd > restoreStart, "native restore function not found");
assert(restoreBlock.indexOf("await authPersistenceReady") >= 0, "native restore does not await Web persistence");
assert(restoreBlock.indexOf("await authPersistenceReady") < restoreBlock.indexOf("await auth.authStateReady()"), "authStateReady runs before Web persistence");
assert(restoreBlock.indexOf("if (auth.currentUser) return auth.currentUser") > restoreBlock.indexOf("await auth.authStateReady()"), "Web Auth is not the first authority after hydration");

const listenerAttach = appContext.indexOf("\n    attachAuthListener();");
const nativeRestore = appContext.indexOf("const nativeSessionRestore = restoreNativeGoogleSession()");
assert(nativeRestore >= 0 && listenerAttach >= 0 && listenerAttach < nativeRestore, "auth listener is not attached before native restore");
assert(appContext.includes("clearAllPrivateClientCaches();"), "explicit cache cleanup contract missing");

if (failures.length > 0) {
  console.error(`auth-persistence-order: FAIL ${failures.length}`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("auth-persistence-order: PASS 10 checks");
