import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const permission = read("android/app/src/main/java/com/nvu/operacional/GtoProjectionPermissionActivity.java");
const main = read("android/app/src/main/java/com/nvu/operacional/MainActivity.java");
const plugin = read("android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java");
const manifest = read("android/app/src/main/AndroidManifest.xml");
const gradle = read("android/app/build.gradle");

let passed = 0, failed = 0;
const check = (name, ok) => {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.error(`FAIL ${name}`); }
};

check("HF6 Android identity", gradle.includes("versionCode 58") && gradle.includes('versionName "1.0.58"'));
check("standalone Reativar overlay removed", !service.includes('action.setText("Reativar")') && !service.includes("projectionReauthButtonView") && !service.includes("projectionReauthButtonParams"));
check("production overlay menu has no Reativar label", !service.includes('menuButton("Reativar leitura da tela")'));
check("MainActivity never owns MediaProjection consent", !main.includes("MediaProjectionManager") && !main.includes("REQUEST_GTO_CAPTURE") && !main.includes("EXTRA_REQUEST_GTO_PROJECTION"));
check("legacy web request cannot open consent from NVU", !plugin.includes("startActivityForResult(call, captureIntent") && plugin.includes("projectionPermissionDeferredToGto") && plugin.includes("requestProjectionPermissionIfRunning"));
const consentLaunchStart = service.indexOf("private void launchProjectionPermissionActivityOnlyWhenGtoLandscape");
const consentLaunchEnd = service.indexOf("private void scheduleBubbleRestoreAfterPermission", consentLaunchStart);
const consentLaunchBody = service.slice(consentLaunchStart, consentLaunchEnd);
check("service launches only isolated permission host", consentLaunchBody.includes("new Intent(this, GtoProjectionPermissionActivity.class)") && !consentLaunchBody.includes("new Intent(this, MainActivity.class)"));
check("service requires exact GTO package before consent", service.includes("!GTO_PACKAGE.equals(foregroundPackage)") && service.includes("Autorização bloqueada fora do GTO horizontal"));
check("service requires landscape before consent", service.includes("width <= height") && service.includes("isLandscapeStableForProjectionConsent(now)"));
check("service requires attached NVU bubble before consent", service.includes("bubbleView == null") && service.includes("!bubbleView.isAttachedToWindow()"));
check("permission activity is hard-locked landscape in manifest", manifest.includes('android:name=".GtoProjectionPermissionActivity"') && manifest.includes('android:screenOrientation="landscape"'));
check("permission host repeats hard landscape request", permission.includes("SCREEN_ORIENTATION_LANDSCAPE") && !permission.includes("SCREEN_ORIENTATION_SENSOR_LANDSCAPE"));
check("permission host validates fresh GTO landscape handoff", permission.includes("EXTRA_GTO_VERIFIED_AT") && permission.includes("HANDOFF_MAX_AGE_MS") && permission.includes("isFreshLandscapeHandoff()"));
check("consent waits for stable landscape host geometry", permission.includes("LANDSCAPE_SETTLE_MS") && permission.includes("tryLaunchConsent") && permission.includes("width > height"));
check("permission host never launches NVU or GTO", !permission.includes("MainActivity.class") && !permission.includes("getLaunchIntentForPackage"));
check("Android 14+ captures default display", permission.includes("MediaProjectionConfig.createConfigForDefaultDisplay()"));
check("granted token goes directly to foreground observer", permission.includes("ACTION_START_PROJECTION") && permission.includes("ContextCompat.startForegroundService"));
check("fixed 15-second consent sleep is absent", !consentLaunchBody.includes("15_000") && !consentLaunchBody.includes("15000") && !permission.includes("15_000") && !permission.includes("15000"));

// Deterministic gate model: permission can only appear after exact GTO + landscape
// remain stable; NVU/portrait never trigger it.
class ConsentGate {
  constructor() { this.since = 0; this.w = 0; this.h = 0; }
  mayOpen(now, pkg, w, h, bubble) {
    if (pkg !== "com.stargamesapps.gto" || !bubble || w <= h) { this.since = 0; this.w = 0; this.h = 0; return false; }
    if (this.w !== w || this.h !== h) { this.w = w; this.h = h; this.since = now; return false; }
    return now - this.since >= 420;
  }
}
const gate = new ConsentGate();
check("scenario: NVU foreground cannot open consent", !gate.mayOpen(1000, "com.nvu.operacional", 2400, 1080, true));
check("scenario: portrait GTO cannot open consent", !gate.mayOpen(1100, "com.stargamesapps.gto", 1080, 2400, true));
check("scenario: landscape without bubble cannot open consent", !gate.mayOpen(1200, "com.stargamesapps.gto", 2400, 1080, false));
check("scenario: first exact landscape sample waits", !gate.mayOpen(1300, "com.stargamesapps.gto", 2400, 1080, true));
check("scenario: stable exact landscape GTO opens consent", gate.mayOpen(1750, "com.stargamesapps.gto", 2400, 1080, true));

console.log(`\n${passed}/${passed + failed} HF6 GTO-only projection checks passed.`);
if (failed) process.exit(1);
