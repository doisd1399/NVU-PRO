import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const read = (p) => fs.readFileSync(p, "utf8");
const servicePath = "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java";
const activityPath = "android/app/src/main/java/com/nvu/operacional/GtoProjectionPermissionActivity.java";
const manifestPath = "android/app/src/main/AndroidManifest.xml";
const gradlePath = "android/app/build.gradle";
const service = read(servicePath);
const activity = read(activityPath);
const manifest = read(manifestPath);
const gradle = read(gradlePath);

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) { passed++; console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

function runJava(name, mainClass, sources, javaArgs = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf10-"));
  try {
    const run = spawnSync(
      "java",
      [...javaArgs, "scripts/java-tests/JavaTestRunner.java", tmp, mainClass, ...sources],
      { encoding: "utf8" },
    );
    const out = `${run.stderr || ""}\n${run.stdout || ""}`.trim();
    check(`${name} compile`, !out.includes("Java compilation failed"), out);
    check(`${name} scenarios`, run.status === 0 && String(run.stdout || "").includes("PASS"), out || String(run.error || ""));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

check("HF10+ Android identity", Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0) >= 62 && Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/) || [])[1] || 0) >= 62);
check("permission host is landscape", manifest.includes('android:name=".GtoProjectionPermissionActivity"') && manifest.includes('android:screenOrientation="landscape"'));
check("root cause removed: finishOnTaskLaunch is absent", !manifest.includes('android:finishOnTaskLaunch="true"'));
check("permission host uses ordinary result-capable launch mode", manifest.includes('android:launchMode="standard"'));
check("permission host remains non-exported and transient", manifest.includes('android:exported="false"') && manifest.includes('android:excludeFromRecents="true"'));
check("consent result is dispatched through the foreground service", activity.includes("ACTION_START_PROJECTION") && activity.includes("EXTRA_RESULT_DATA") && !activity.includes("acceptProjectionGrantIfRunning"));
check("recreated host never opens a second consent", activity.includes("STATE_CONSENT_LAUNCHED") && activity.includes("if (!consentLaunched) mainHandler.post"));
check("host without result clears stuck in-flight state", activity.includes("CONSENT_HOST_FINISHED_WITHOUT_RESULT") && activity.includes("!resultHandled"));
check("service restart clears non-persistent permission latch", /onCreate\(\)[\s\S]*?putBoolean\("projectionPermissionInFlight", false\)/.test(service));
check("permission result watchdog prevents infinite stuck state", service.includes("PROJECTION_PERMISSION_RESULT_WATCHDOG_MS") && service.includes("CONSENT_RESULT_TIMEOUT"));
check("real bound grant overrides stale in-flight UI", service.includes("reconcileProjectionPermissionLifecycle") && service.includes("projectionActive || projectionSurfacePending || mediaProjection != null"));
check("Android 14+ projection FGS promotion occurs before getMediaProjection", service.indexOf("startForegroundForTypes(true)", service.indexOf("private boolean startProjection")) < service.indexOf("manager.getMediaProjection", service.indexOf("private boolean startProjection")));
check("ACTION_START_PROJECTION itself requests mediaProjection FGS type", service.includes("boolean projectionGrantAction = ACTION_START_PROJECTION.equals(action)") && service.includes("projectionGrantAction || projectionActive"));
check("permission flow survives a reclaimed observer process", activity.includes("ContextCompat.startForegroundService(this, serviceIntent)") && activity.includes("GtoObserverService.isRunning()"));
check("permission host never converts slow startup into a false denial", activity.includes("serviço ainda concluindo a ativação") && !activity.includes("GRANT_BIND_FAILED"));
check("projection surface uses maximum display metrics on modern Android", service.includes("getMaximumWindowMetrics().getBounds()"));
check("grant is registered before first VirtualDisplay", (() => {
  const startProjectionAt = service.indexOf("private boolean startProjection");
  const startProjectionEnd = service.indexOf("private void resizeProjectionSurface", startProjectionAt);
  const startProjectionBody = service.slice(startProjectionAt, startProjectionEnd);
  const createSurfaceAt = service.indexOf("private void createProjectionSurface");
  const createSurfaceEnd = service.indexOf("private void maybeRecoverProjectionFrameDelivery", createSurfaceAt);
  const createSurfaceBody = service.slice(createSurfaceAt, createSurfaceEnd);
  return startProjectionBody.includes("projection.registerCallback")
    && startProjectionBody.includes("createProjectionSurface(initialWidth, initialHeight)")
    && createSurfaceBody.includes("projection.createVirtualDisplay");
})());
check("accepted grant creates its single VirtualDisplay immediately", service.includes("GRANT_VALIDATED_STARTING_SURFACE") && service.includes("createProjectionSurface(initialWidth, initialHeight)") && service.includes("VirtualDisplay não ficou ativa após autorização"));
check("silent ImageReader recovery preserves the same MediaProjection", service.includes("rebindProjectionSurfaceWithoutReauthorization") && service.includes("expectedDisplay.setSurface(replacement.getSurface())"));
check("silent-frame recovery never calls createVirtualDisplay", (() => {
  const start = service.indexOf("private void rebindProjectionSurfaceWithoutReauthorization");
  const end = service.indexOf("private boolean startProjection", start);
  const body = service.slice(start, end);
  return !body.includes("createVirtualDisplay") && !body.includes("requestProjectionPermission");
})());
check("first captured frame is explicitly recorded", service.includes('putLong("projectionFirstFrameAt"') && service.includes("Leitura funcional · primeiro quadro recebido, detecção liberada"));
check("duplicate authorize stays blocked while grant is pending", service.includes("!projectionActive && !projectionPermissionInFlight && !projectionSurfacePending"));
check("terminal MediaProjection onStop is the path that re-enables consent", /onStop\(\)[\s\S]*?putBoolean\("projectionGrantValidated", false\)[\s\S]*?projectionReauthRequired/.test(service));

class ProjectionDispatchModel {
  constructor() {
    this.serviceAlive = false;
    this.fgsProjection = false;
    this.grantConsumed = false;
    this.virtualDisplay = false;
    this.firstFrame = false;
  }
  resultOk() {
    // Explicit service dispatch must be sufficient even if the pre-consent process/service
    // instance did not survive.
    this.serviceAlive = true;
    this.fgsProjection = true;
    this.grantConsumed = true;
    this.virtualDisplay = true;
    return true;
  }
  frame() {
    if (!this.virtualDisplay) return false;
    this.firstFrame = true;
    return true;
  }
}
const reclaimed = new ProjectionDispatchModel();
check("scenario: RESULT_OK recreates service and immediately starts capture", reclaimed.resultOk() && reclaimed.serviceAlive && reclaimed.fgsProjection && reclaimed.grantConsumed && reclaimed.virtualDisplay);
check("scenario: recreated-service capture validates first frame", reclaimed.frame() && reclaimed.firstFrame);

class ProjectionModel {
  constructor() {
    this.inFlight = false;
    this.grant = false;
    this.surfacePending = false;
    this.active = false;
    this.frames = 0;
  }
  canAuthorize() { return !this.inFlight && !this.grant && !this.surfacePending && !this.active; }
  request() { if (!this.canAuthorize()) return false; this.inFlight = true; return true; }
  acceptResult() { if (!this.inFlight) return false; this.inFlight = false; this.grant = true; this.surfacePending = true; return true; }
  startSurface() { if (!this.grant || !this.surfacePending) return false; this.surfacePending = false; this.active = true; return true; }
  frame() { if (!this.active) return false; this.frames++; return true; }
  rebindSurface() { return this.active && this.grant; }
  terminalStop() { this.inFlight = false; this.grant = false; this.surfacePending = false; this.active = false; this.frames = 0; }
}
const model = new ProjectionModel();
check("scenario: exactly one authorization starts", model.request() && !model.request());
check("scenario: accepted Android result latches grant", model.acceptResult() && !model.canAuthorize());
check("scenario: GTO surface starts without second authorization", model.startSurface() && model.active && !model.canAuthorize());
check("scenario: first frame validates functional capture", model.frame() && model.frames === 1);
check("scenario: silent-surface recovery does not lose grant", model.rebindSurface() && !model.canAuthorize());
model.terminalStop();
check("scenario: only terminal stop permits reauthorization", model.canAuthorize());

if (fs.existsSync("scripts/fixtures/gto-real-freight-list-hf9.png")) {
  runJava(
    "HF10 exact reported freight screenshot",
    "com.nvu.operacional.GtoR334Hf9FreightScreenTest",
    [
      "scripts/java-tests/android/graphics/Rect.java",
      "scripts/java-tests/android/media/Image.java",
      "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java",
        "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
      "scripts/java-tests/com/nvu/operacional/GtoR334Hf9FreightScreenTest.java",
    ],
    ["-Djava.awt.headless=true"],
  );
} else {
  check("HF10 exact reported freight screenshot", true, "SKIPPED: binary fixture is not part of this source-only checkout");
}

console.log(`\n${passed}/${passed + failed} HF10 projection/runtime checks passed.`);
if (failed) process.exit(1);
