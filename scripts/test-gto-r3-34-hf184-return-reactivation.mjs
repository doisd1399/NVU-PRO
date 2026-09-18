import fs from "node:fs";

const service = fs.readFileSync("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java", "utf8");
const workflow = fs.readFileSync(".github/workflows/build-android-release.yml", "utf8");
const metadata = JSON.parse(fs.readFileSync("NVU_RELEASE_METADATA.json", "utf8"));
const currentVersionCode = String(metadata.androidVersionCode);
const currentVersionName = `1.0.${currentVersionCode}`;

const restoreStart = service.indexOf("private void restoreBubbleAfterPermission");
const restoreEnd = service.indexOf("private void cancelTrip", restoreStart);
const restore = restoreStart >= 0 && restoreEnd > restoreStart
  ? service.slice(restoreStart, restoreEnd)
  : "";
const resumeStart = service.indexOf("private void resumeScreenAnalysisInSameState");
const resumeEnd = service.indexOf("private void reconcileSessionAfterGtoReturn", resumeStart);
const resume = resumeStart >= 0 && resumeEnd > resumeStart
  ? service.slice(resumeStart, resumeEnd)
  : "";

const checks = [];
const check = (name, ok) => {
  checks.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};

check("HF184 identity remains covered by the current release", metadata.androidVersionCode >= 262 && metadata.androidVersion === currentVersionName && metadata.hf184ChangesAndroidOnlyVsHF183 === true);
check("workflow identity matches current release metadata", workflow.includes(`EXPECTED_VERSION_CODE: \"${currentVersionCode}\"`) && workflow.includes(`EXPECTED_VERSION_NAME: \"${currentVersionName}\"`) && workflow.includes(`versionCode ${currentVersionCode}`) && workflow.includes(`versionName \"${currentVersionName}\"`));
check("restore refreshes foreground before deciding", restore.includes("if (refreshUsage) refreshForegroundPackage()") && restore.includes("boolean confirmedGto"));
check("exact GTO package is a direct return authority", restore.includes("GTO_PACKAGE.equals(foregroundPackage) || verifiedBridge"));
check("external or transient context remains blocked", restore.includes("if (!confirmedGto || transientForegroundSurfaceActive) return;"));
check("paused analysis resumes for confirmed GTO", restore.includes("if (screenAnalysisPausedOutsideGto && confirmedGto)") && restore.includes("resumeScreenAnalysisInSameState"));
check("old bridge-only resume condition is absent", !restore.includes("if (screenAnalysisPausedOutsideGto && verifiedBridge)"));
check("resume clears the visibility pause", resume.includes("screenAnalysisPausedOutsideGto = false") && resume.includes("putBoolean(\"screenAnalysisPaused\", false)"));
check("resume re-arms fresh frame stability", resume.includes("captureStabilityGate.reset") && resume.includes("VISIBILITY_RETURN_3_FRAMES"));
check("resume re-arms touch continuity", resume.includes("ensureCaptureContinuityAfterGtoReturn()") && resume.includes("updateFreightTouchPulseSensor()"));

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} HF184 return-reactivation checks passed.`);
if (failed) process.exit(1);
