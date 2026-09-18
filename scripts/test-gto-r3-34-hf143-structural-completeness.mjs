import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const exists = relative => fs.existsSync(path.join(root, relative));
const checks = [];
const check = (name, condition, detail = "") => {
  const ok = Boolean(condition);
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoBubbleDismissPolicy.java");
const city = read("android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java");
const listAuthority = read("android/app/src/main/java/com/nvu/operacional/GtoFreightListTextAuthorityPolicy.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const plugin = read("android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java");
const launcher = read("src/services/gtoWorkLauncher.ts");
const dashboard = read("src/pages/driver/Dashboard.tsx");
const pkg = JSON.parse(read("package.json"));
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const releaseScript = String(pkg.scripts?.["verify:release"] || "");
const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";

check("all restored native GTO policy classes are present", [
  "GtoActionStateMachine.java",
  "GtoCaptureHealthPolicy.java",
  "GtoCaptureStabilityGate.java",
  "GtoCargoConsensusPolicy.java",
  "GtoCertifiedResultLifecyclePolicy.java",
  "GtoCityTextResolver.java",
  "GtoDeterministicFlowPolicy.java",
  "GtoFreightBootstrapPolicy.java",
  "GtoFreightContextPolicy.java",
  "GtoFreightFieldConflictPolicy.java",
  "GtoFreightListEvidencePolicy.java",
  "GtoFreightReviewEligibilityPolicy.java",
  "GtoFreightSemanticCertificationPolicy.java",
  "GtoGeometryStateMachine.java",
  "GtoObserverOperationalPolicy.java",
  "GtoOverlayLayoutPolicy.java",
  "GtoPauseCorrectionPolicy.java",
  "GtoPauseLocationParser.java",
  "GtoPauseScreenDetectionPolicy.java",
  "GtoResultActionFlowPolicy.java",
  "GtoResultCompletionPolicy.java",
  "GtoResultProofStore.java",
  "GtoSelectionCoordinator.java",
  "GtoSelectionEvidencePolicy.java",
  "GtoSessionRecoveryPolicy.java",
  "GtoTripSubmissionCoordinator.java",
  "GtoVisualContextStateMachine.java",
  "GtoVisualForegroundPolicy.java",
].every(name => exists(`android/app/src/main/java/com/nvu/operacional/${name}`)));
check("List and city authorities are structurally connected", exists("android/app/src/main/java/com/nvu/operacional/GtoFreightListTextAuthorityPolicy.java") && listAuthority.includes("GtoFreightFieldEvidencePolicy") && city.includes("uniqueOfficialCanonicalCandidate") && service.includes("acceptedVisibleDestination"));
check("Operation authority and refresh path are present", sync.includes("readCurrentOperationSnapshot") && sync.includes("refreshCurrentOperationSnapshot") && plugin.includes("setContext") && service.includes("operationSummaryText") && service.includes("opSession="));
check("removal target is visible on first drag inside and outside GTO", policy.includes("boolean eligibleOrigin = dragging") && policy.includes("return gestureActive && dragging") && service.includes("showBubbleRemoveTarget(bubbleActiveGestureGeneration)") && !service.includes("showBubbleRemoveTarget(longPressGeneration)"));
check("removal remains fail-safe and card remains non-destructive", policy.includes("pointerMatches") && policy.includes("generationMatches") && policy.includes("geometryInside") && !service.includes("Remover botão flutuante"));
check("Pause remains separately represented", exists("android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java") && exists("android/app/src/main/java/com/nvu/operacional/GtoPauseCorrectionPolicy.java") && !listAuthority.includes("pauseMenuEvidence = true"));
check("Web context still provides current operation identity", launcher.includes("const runtimeContext: GtoObserverContext") && launcher.includes("GtoObserver.setContext(runtimeContext)") && launcher.includes("buildGtoOperationContext(context)") && launcher.includes("GTO_WEB_RUNTIME_REVISION") && dashboard.includes("jobId: myJob.id") && dashboard.includes("contractId: contract.id") && dashboard.includes("vehicleName") && dashboard.includes("trailerName"));
check("Gradle wrapper is restored and executable", exists("android/gradlew") && fs.statSync(path.join(root, "android/gradlew")).mode & 0o111);
check("Gradle wrapper jar is restored", exists("android/gradle/wrapper/gradle-wrapper.jar"));
const ocrFiles = fs.existsSync(path.join(root, "public/tesseract/core"))
  ? fs.readdirSync(path.join(root, "public/tesseract/core")).filter(name => /\.(wasm|wasm\.js)$/.test(name))
  : [];
check("OCR core has eight required artifacts", ocrFiles.length === 8, `found ${ocrFiles.length}`);
check("OCR worker is restored", exists("public/tesseract/worker.min.js"));
check("four native voice assets are restored", [
  "nvu_gto_automated_start_voice_pt_br.mp3",
  "nvu_pause_alert_voice_pt_br.mp3",
  "nvu_ready_voice_pt_br.mp3",
  "nvu_trip_completed_voice_pt_br.mp3",
].every(name => exists(`android/app/src/main/res/raw/${name}`)));
check("backend rules and built functions are present", exists("firestore.rules") && exists("functions/lib/index.js") && exists("functions/lib/gtoTrips.js"));
check("all prior protection gates remain registered", ["test:gto-r3.34-hf131-itapetuna-direct-list", "test:gto-r3.34-hf135-in-gto-drag-removal", "test:gto-r3.34-hf140-operation-list-layout", "test:gto-r3.34-hf142-regression-lock"].every(name => releaseScript.includes(name)));
check("HF143 is registered in verify:release", releaseScript.includes("test:gto-r3.34-hf143-structural-completeness"));
check("current identity remains above 1.0.218", versionCode >= 220 && versionName === `1.0.${versionCode}` && workflow.includes("EXPECTED_VERSION_CODE"));
check("temporary local.properties is absent", !exists("android/local.properties"));

const failed = checks.filter(item => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF143 structural-completeness checks passed.`);
if (failed.length) process.exit(1);
