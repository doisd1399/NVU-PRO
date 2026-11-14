import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const read = (p) => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const gradle = read("android/app/build.gradle");
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const method = (source, start, end) => {
  const a = source.indexOf(start);
  if (a < 0) return "";
  const b = source.indexOf(end, a + start.length);
  return source.slice(a, b >= 0 ? b : source.length);
};

check("HF17+ Android identity remains at or above 1.0.69 / 69",
  Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0) >= 69
  && Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/) || [])[1] || 0) >= 69);

const openMenu = method(service, "private void openMenu()", "private void populateMenuContents");
check("open card watches outside touches without making GTO modal",
  openMenu.includes("FLAG_NOT_TOUCH_MODAL") && openMenu.includes("FLAG_WATCH_OUTSIDE_TOUCH"));
check("outside touch minimizes only the card",
  openMenu.includes("NativeCompactMenuView.bindOutsideDismiss")
    && fs.readFileSync("android/app/src/main/java/com/nvu/operacional/NativeCompactMenuView.java", "utf8").includes("MotionEvent.ACTION_OUTSIDE")
    && openMenu.includes("if (menuView != openedMenu || destroying) return;")
    && openMenu.includes("mainHandler.post(() ->")
    && openMenu.includes("closeMenu();")
    && openMenu.includes("showManualRoutePendingAlert()"));
check("bubble tap cannot reopen card after outside event from same gesture",
  service.includes("lastMenuOutsideTouchAt = System.currentTimeMillis()")
    && method(service, "private void toggleMenu()", "private void openMenu()")
      .includes("now - lastMenuOutsideTouchAt < OUTSIDE_SAME_GESTURE_GUARD_MS"));

const closeMenu = method(service, "private void closeMenu()", "private void suspendPassiveDetectionOverlaysKeepBubbleAndMenu");
check("minimize does not remove bubble or stop projection",
  closeMenu.includes("removeView(previous)")
    && !closeMenu.includes("removeView(bubbleView)")
    && !closeMenu.includes("stopProjection"));

const layout = method(service, "private void adjustOpenMenuLayoutAfterMeasure()", "private boolean shouldMinimizeMenuForConfirmedExternalApp");
check("card publication suppresses bubble",
  openMenu.includes("cardVisibility.acquire(menuView)"));
check("measured card never changes bubble coordinates",
  layout.includes("targetMenuX = clamp") && !layout.includes("bubbleParams.x =") && !layout.includes("bubbleParams.y ="));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf17-"));
try {
  const run = spawnSync("java", [
    "scripts/java-tests/JavaTestRunner.java", tmp,
    "com.nvu.operacional.GtoR334Hf17OverlayLayoutPolicyTest",
    "android/app/src/main/java/com/nvu/operacional/GtoOverlayLayoutPolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoR334Hf17OverlayLayoutPolicyTest.java",
  ], { encoding: "utf8" });
  const out = `${run.stderr || ""}\n${run.stdout || ""}`.trim();
  check("HF17 overlay policy compiles", !out.includes("Java compilation failed"), out);
  check("HF17 side-choice scenarios pass", run.status === 0 && String(run.stdout || "").includes("PASS"), out);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF17 checks passed.`);
if (failed.length) process.exit(1);
