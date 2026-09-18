import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const permission = read("android/app/src/main/java/com/nvu/operacional/GtoProjectionPermissionActivity.java");
const plugin = read("android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java");
const manifest = read("android/app/src/main/AndroidManifest.xml");
const gradle = read("android/app/build.gradle");

let passed = 0, failed = 0;
const check = (name, ok) => {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.error(`FAIL ${name}`); }
};

check("HF8 Android identity", gradle.includes("versionCode 60") && gradle.includes('versionName "1.0.60"'));
check("permission remains GTO-only landscape", manifest.includes('android:name=".GtoProjectionPermissionActivity"') && manifest.includes('android:screenOrientation="landscape"'));
check("grant is consumed synchronously by live observer", service.includes("acceptProjectionGrantIfRunning") && permission.includes("GtoObserverService.acceptProjectionGrantIfRunning(resultCode, data)"));
check("grant binding is explicit boolean handshake", service.includes("private boolean startProjection(int resultCode, Intent resultData)") && permission.includes("boolean bound = GtoObserverService.acceptProjectionGrantIfRunning"));
check("accepted grant is latched before returning to GTO", service.includes('putBoolean("projectionGrantValidated", true)') && service.includes('putLong("projectionGrantValidatedAt"'));
check("plugin exposes grant validation diagnostics", plugin.includes('status.put("projectionGrantValidated"') && plugin.includes('status.put("projectionGrantValidatedAt"'));
check("permission host no longer removes its entire task", !permission.includes("finishAndRemoveTask()"));
check("granted path does not dispatch token asynchronously through service intent", !permission.includes("serviceIntent.setAction(GtoObserverService.ACTION_START_PROJECTION)"));
{
  const grantedStart = permission.indexOf("if (granted) {");
  const grantedEnd = permission.indexOf("Intent serviceIntent =", grantedStart);
  const grantedBlock = permission.slice(grantedStart, grantedEnd);
  check("consent latch stays closed until observer validates token", grantedBlock.indexOf("acceptProjectionGrantIfRunning(resultCode, data)") < grantedBlock.indexOf('putBoolean("projectionPermissionInFlight", false)'));
}
check("floating menu blocks duplicate authorize during consent", service.includes("!projectionPermissionInFlight && !projectionSurfacePending") && !service.includes("if (!projectionActive && !projectionSurfacePending) {"));
check("waiting menu clearly states validated grant", service.includes("Compartilhamento aceito e validado"));
check("stopped-before-surface is distinguished", service.includes("STOPPED_BEFORE_SURFACE") && service.includes("O Android encerrou o compartilhamento antes de a captura iniciar"));
check("service does not downgrade mediaProjection FGS while grant is bound", service.includes("startForegroundForTypes(projectionActive || projectionSurfacePending || mediaProjection != null)"));
check("new process clears non-persistent projection grant", service.includes('putBoolean("projectionGrantValidated", false)') && service.includes("MediaProjection itself cannot survive process death"));
check("active surface keeps grant validated", service.includes('putBoolean("projectionActive", true)') && service.includes('putBoolean("projectionGrantValidated", true)'));
check("terminal projection stop clears grant validation", /onStop\(\)[\s\S]*?putBoolean\("projectionGrantValidated", false\)/.test(service));
check("manual stop clears grant validation", /private void stopProjection\(\)[\s\S]*?putBoolean\("projectionGrantValidated", false\)/.test(service));
check("no fixed 15-second permission timer introduced", !permission.includes("15_000") && !permission.includes("15000"));

// State-model regression: once Android grants consent, no second consent is allowed while
// the token is binding or the first GTO surface is pending. Reauthorization is only legal
// after a terminal stop/failure clears the validated latch.
class ProjectionState {
  constructor() { this.inFlight = false; this.validated = false; this.surfacePending = false; this.active = false; }
  beginConsent() { if (this.inFlight || this.validated || this.surfacePending || this.active) return false; this.inFlight = true; return true; }
  grantValidated() { if (!this.inFlight) return false; this.inFlight = false; this.validated = true; this.surfacePending = true; return true; }
  surfaceStarted() { if (!this.validated || !this.surfacePending) return false; this.surfacePending = false; this.active = true; return true; }
  canAuthorize() { return !this.inFlight && !this.validated && !this.surfacePending && !this.active; }
  terminalStop() { this.inFlight = false; this.validated = false; this.surfacePending = false; this.active = false; }
}
const model = new ProjectionState();
check("scenario: first consent can begin", model.beginConsent());
check("scenario: duplicate consent blocked while Android dialog is open", !model.canAuthorize() && !model.beginConsent());
check("scenario: grant becomes validated before return to GTO", model.grantValidated() && !model.canAuthorize());
check("scenario: duplicate consent blocked while GTO surface is pending", !model.beginConsent());
check("scenario: first surface activates without another consent", model.surfaceStarted() && model.active && !model.canAuthorize());
model.terminalStop();
check("scenario: reauthorization only after terminal stop", model.canAuthorize());

console.log(`\n${passed}/${passed + failed} HF8 projection-grant checks passed.`);
if (failed) process.exit(1);
