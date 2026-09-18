import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const read = (p) => fs.readFileSync(p, "utf8");
const servicePath = "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java";
const activityPath = "android/app/src/main/java/com/nvu/operacional/GtoProjectionPermissionActivity.java";
const detectorPath = "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java";
const listEvidencePath = "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java";
const syncPath = "android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java";
const service = read(servicePath);
const permissionActivity = read(activityPath);
const launcher = read("src/services/gtoWorkLauncher.ts");
const setup = read("src/components/GtoObserverSetup.tsx");
const adminLayout = read("src/layouts/AdminLayout.tsx");
const seniorService = read("src/services/seniorAccessService.ts");
const sync = read(syncPath);

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function runJava(name, mainClass, sources, javaArgs = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-r328-"));
  try {
    const run = spawnSync("java", [...javaArgs, "scripts/java-tests/JavaTestRunner.java", tmp, mainClass, ...sources], { encoding: "utf8" });
    const out = `${run.stderr || ""}\n${run.stdout || ""}`.trim();
    check(`${name} fixtures compile`, !out.includes("Java compilation failed"), out);
    check(`${name} scenarios pass`, run.status === 0 && String(run.stdout || "").includes("PASS"), out || String(run.error || ""));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

check(
  "web work launcher opens GTO before asking for screen capture",
  !/requestScreenCapture\(\)[\s\S]{0,700}openGto\(\)/.test(launcher)
    && launcher.includes("const openResult = await GtoObserver.openGto()"),
);
check(
  "observer setup button also opens simulator before capture consent",
  !/requestScreenCapture\(\)[\s\S]{0,500}GtoObserver\.openGto\(\)/.test(setup)
    && setup.includes("const result = await GtoObserver.openGto()"),
);
check(
  "native launch prepares WAITING_FREIGHT without pre-opening consent",
  service.includes("beginTrip(false, false)")
    && service.includes("armProjectionPermissionAfterGtoOpen()")
    && service.includes("projectionPermissionAfterGtoOpenPending"),
);
check(
  "initial capture consent is triggered only after real GTO foreground",
  service.includes("maybeLaunchInitialProjectionPermissionOverGto(now)")
    && service.includes("GTO_PACKAGE.equals(foregroundPackage)")
    && service.includes("INITIAL_PROJECTION_AFTER_GTO_DELAY_MS")
    && service.includes("launchProjectionPermissionOverGto()"),
);
const permissionLaunchStart = service.indexOf("private void launchProjectionPermissionActivityOnlyWhenGtoLandscape");
const permissionLaunchEnd = service.indexOf("private void", permissionLaunchStart + 20);
const permissionLaunchBody = service.slice(permissionLaunchStart, permissionLaunchEnd);
check(
  "GTO consent uses isolated transparent landscape host without foregrounding NVU",
  permissionLaunchBody.includes("new Intent(this, GtoProjectionPermissionActivity.class)")
    && !permissionLaunchBody.includes("new Intent(this, MainActivity.class)")
    && permissionActivity.includes('SCREEN_ORIENTATION_LANDSCAPE')
    && permissionActivity.includes('CONSENT_VISIBLE_OVER_GTO_LANDSCAPE'),
);
check(
  "capture starts from rotation-aware real display metrics",
  (service.includes("DisplayMetrics liveMetrics = realDisplayMetrics()")
    && service.includes("gtoLandscapeExpected")
    && service.includes("if (gtoLandscapeExpected && initialHeight > initialWidth)"))
  || (service.includes("private void maybeStartPendingProjectionSurface(long now)")
    && service.includes("DisplayMetrics metrics = realDisplayMetrics()")
    && (service.includes("if (!packageMatchesGto || width <= 0 || height <= 0 || width <= height)")
      || service.includes("if (!trustedGtoContext || width <= 0 || height <= 0 || width <= height)"))
    && service.includes("createProjectionSurface(width, height)")),
);
check(
  "Android 14+ orientation callback has generation-bound resize recovery",
  service.includes("onCapturedContentResize(int width, int height)")
    && service.includes("if (generation != projectionGeneration || mediaProjection != projection) return;")
    && service.includes("resizeProjectionSurface(width, height)")
    && service.includes("handler.postDelayed(() -> resizeProjectionSurface(width, height), retryDelay)"),
);
check(
  "expected IDLE to WAITING_FREIGHT launch while paused is not reported as integrity failure",
  service.includes("expectedLaunchPreparation")
    && service.includes('STATE_IDLE.equals(preservedState)')
    && service.includes('STATE_WAITING_FREIGHT.equals(currentState)')
    && service.includes('.remove("gtoTripIntegrityError")'),
);
check(
  "admin users can see the secure Senior Panel entry before senior claim",
  adminLayout.includes('const hasSeniorPanelAccess = true;')
    && adminLayout.includes('navigate("/admin/senior")')
    && seniorService.includes("authenticateSeniorAccess")
    && seniorService.includes("token.claims.senior !== true"),
);
check(
  "selected freight remains immutable and visible as current trip",
  service.includes("GtoAutoTripSync.lockSelectedFreight")
    && service.includes('freightHeading.setText("Frete atual")')
    && (service.includes("Frete identificado. Tudo preparado, podemos partir!") || service.includes("Frete confirmado ✓ · viagem em andamento.")),
);
check(
  "Receive is persisted before automatic queue and Firebase send",
  service.includes('putBoolean("resultReceiveLatched", true)')
    && /confirmNormalResultAutomatically\(\)[\s\S]*?\.commit\(\)[\s\S]*?setTripState\(STATE_RESULT_CONFIRMED[\s\S]*?GtoTripSubmissionCoordinator\.submitCompletedTrip\(this, prefs/.test(service)
    && sync.indexOf("sealPayload(payload)") < sync.indexOf("registerGtoTrip"),
);

if (fs.existsSync("scripts/fixtures/gto-real-freight-list-r328.png")) {
  runJava(
    "reported R3.27-HF2 freight screen",
    "com.nvu.operacional.GtoR328ReportedFreightScreenTest",
    [
      "scripts/java-tests/android/graphics/Rect.java",
      "scripts/java-tests/android/media/Image.java",
      detectorPath,
      listEvidencePath,
      "scripts/java-tests/com/nvu/operacional/GtoR328ReportedFreightScreenTest.java",
    ],
    ["-Djava.awt.headless=true"],
  );
} else {
  check("reported R3.27-HF2 freight screen fixture", true, "SKIPPED: binary fixture is not part of this source-only checkout");
}
runJava(
  "full deterministic journey",
  "com.nvu.operacional.GtoFullJourneyPolicyTest",
  [
    "android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoFullJourneyPolicyTest.java",
  ],
);
runJava(
  "result visual matrix",
  "com.nvu.operacional.GtoResultVisualGateScreenMatrixTest",
  [
    "scripts/java-tests/android/graphics/Rect.java",
    "scripts/java-tests/android/media/Image.java",
    "android/app/src/main/java/com/nvu/operacional/GtoResultVisualGate.java",
      "android/app/src/main/java/com/nvu/operacional/GtoResultEvidencePolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoResultVisualGateScreenMatrixTest.java",
  ],
);

const failed = checks.filter((x) => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} R3.28 practical-flow checks passed.`);
if (failed.length) process.exit(1);
