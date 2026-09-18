import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoSelectionInteractionPolicy.java");
const gradle = read("android/app/build.gradle");
const checks = [];
const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
const check = (name, ok) => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};

check("HF175 version increments HF174 release baseline",
  versionCode >= 253 && versionName === `1.0.${versionCode}`);
check("production service uses one pure early-touch policy",
  service.includes("GtoSelectionInteractionPolicy.mayArmFromFreshFreightList")
  && !service.includes("private boolean isFreshFreightTouchContextLegacy"));
check("early touch only arms correlation and keeps immutable commit gates",
  policy.includes("The early-touch window only arms correlation")
  && service.includes("before/after transaction")
  && service.includes("semantic/OCR checks still remain required"));
check("first row and reopened list are covered by fresh geometry",
  service.includes("lastFreightListSeenAt")
  && service.includes("realtimeAcceptRects")
  && service.includes("visualContextGeneration == projectionGeneration"));
check("manual card exposes both route steps",
  service.includes("Etapa 1/2 · Origem")
  && service.includes("Etapa 2/2 · Destino")
  && service.includes("manualRouteSelectionStep"));
check("same-step refresh preserves scroll",
  service.includes("manualRouteScrollView")
  && service.includes("shouldRestoreRouteScroll")
  && service.includes("routeScroll.post(() -> routeScroll.scrollTo(0, restoreScrollY));"));
check("step/freight/menu changes clear scroll context",
  service.includes("manualRouteScrollView = null")
  && service.includes("manualRouteScrollStep = \"\"")
  && service.includes("manualRouteScrollStep = step"));
check("no pause fallback is used to validate a stable human-selected row",
  service.includes("canPromoteHumanBackedSelectedRowDirectly")
  && service.includes("commitPreciseFreight(reconciledSameRow)")
  && service.includes("scheduleFocusedFreightConflictRetry"));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf175-"));
const sources = [
  "android/app/src/main/java/com/nvu/operacional/GtoSelectionInteractionPolicy.java",
  "scripts/java-tests/com/nvu/operacional/GtoSelectionInteractionPolicyTest.java",
].map(relative => path.join(root, relative));
let result = spawnSync("javac", ["-encoding", "UTF-8", "-d", temp, ...sources], { encoding: "utf8" });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
check("selection interaction policy compiles", result.status === 0);
if (result.status === 0) {
  result = spawnSync("java", ["-cp", temp, "com.nvu.operacional.GtoSelectionInteractionPolicyTest"], { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  check("selection interaction scenarios pass", result.status === 0);
}
fs.rmSync(temp, { recursive: true, force: true });

const failed = checks.filter(item => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF175 selection-route checks passed.`);
if (failed.length) process.exit(1);
