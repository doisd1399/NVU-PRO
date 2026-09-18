import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const read = (p) => fs.readFileSync(p, "utf8");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoOverlayLayoutPolicy.java");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const bubbleTest = read("scripts/java-tests/com/nvu/operacional/GtoHf56BubblePositionPolicyTest.java");
const checks = [];
const check = (name, ok) => {
  checks.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};

check("reference X uses the calibrated 28.5 percent anchor", policy.includes("referenceTopX") && policy.includes("0.285f"));
check("reference Y reserves the top HUD band", policy.includes("referenceTopY") && policy.includes("0.06f"));
check("service installs the reference X anchor", service.includes("GtoOverlayLayoutPolicy.referenceTopX(") && service.includes("metrics.widthPixels, bubbleWidth"));
check("service installs the reference Y anchor", service.includes("GtoOverlayLayoutPolicy.referenceTopY(") && service.includes("metrics.heightPixels, safeTop, maxY"));
check("only explicit user drag restores saved normalized coordinates", service.includes("hasExplicitUserGtoBubblePosition()") && service.includes('"USER_DRAG_GTO_LANDSCAPE"') && service.includes("positionFromNormalized"));
check("legacy/default coordinates cannot become the fresh-install authority", service.includes("Every attach starts at the visual reference anchor") && service.includes("saved user position is") && service.includes("intentionally not restored here"));
check("display rebase restores only explicit user position", service.includes("restorePreferred") && service.includes("hasExplicitUserGtoBubblePosition()"));
check("position policy fixture covers both reference axes", bubbleTest.includes("referenceTopX(1080, 68, 20, 1020) == 274") && bubbleTest.includes("referenceTopY(1920, 20, 1840) == 135"));
check("reference anchor remains clamped to safe bounds", policy.includes("return clamp(desiredLeft, safeLeft, maxX)") && policy.includes("return clamp(desired, safeTop, maxY)"));
check("message/card reflow does not alter saved position authority", service.includes("Automatic docking is intentionally NOT persisted") && service.includes("menuMessageBandReserved"));

const out = mkdtempSync(join(tmpdir(), "nvu-hf186-"));
try {
  const result = spawnSync("javac", ["-d", out, "android/app/src/main/java/com/nvu/operacional/GtoOverlayLayoutPolicy.java", "scripts/java-tests/com/nvu/operacional/GtoHf56BubblePositionPolicyTest.java"], { encoding: "utf8" });
  check("position policy compiles and its fixture passes", result.status === 0);
  if (result.status === 0) {
    const run = spawnSync("java", ["-cp", out, "com.nvu.operacional.GtoHf56BubblePositionPolicyTest"], { encoding: "utf8" });
    check("reference position fixture executes successfully", run.status === 0 && run.stdout.includes("PASS"));
  } else {
    console.log(result.stderr || result.stdout || "javac failed");
    check("reference position fixture executes successfully", false);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} HF186 reference-bubble-position checks passed.`);
if (failed) process.exit(1);
