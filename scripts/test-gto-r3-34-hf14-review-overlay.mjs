import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const review = read("android/app/src/main/java/com/nvu/operacional/GtoFreightReviewPolicy.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const backend = read("functions/src/gtoTrips.ts");
const gradle = read("android/app/build.gradle");
const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures.push(name);
};
const method = (source, start, end) => {
  const a = source.indexOf(start);
  if (a < 0) return "";
  const b = end ? source.indexOf(end, a + start.length) : -1;
  return source.slice(a, b >= 0 ? b : source.length);
};

check("HF14 baseline identity is not older than 1.0.66 / 66",
  /versionCode\s+(6[6-9]|[7-9][0-9]|[1-9][0-9]{2,})/.test(gradle));

check("destination company is not a required review field",
  !method(review, "static String firstRequiredField", "static boolean isManualValueValid").includes("return DESTINATION_COMPANY"));

check("destination company cannot become a manual driver field",
  !method(review, "static boolean isManualValueValid", "static String preserveLiteralManualText").includes("DESTINATION_COMPANY.equals"));

const validateFreight = method(sync, "private static String validateFreight", "private static String validateCompletedPayload");
check("native freight lock treats destination company as optional metadata",
  /new String\[\]\s*\{\s*"origin",\s*"destination"\s*\}/.test(validateFreight)
  && validateFreight.includes("Cargo is intentionally optional")
  && validateFreight.includes('String destinationCompany = clean(payload.optString("destinationCompany", ""))'));

check("Firebase function accepts empty destination company but validates it when present",
  backend.includes('if (destinationCompany) assertBoundedText(destinationCompany, "destinationCompany")'));

check("destination company remains in fingerprint/payload for backward-compatible metadata",
  sync.includes('"destinationCompany"') && backend.includes('["destinationCompany", text(fields.destinationCompany'));

check("precise freight validation no longer requires destination company",
  !method(service, "private boolean isExactFreightDataValid", "private boolean isStableFreightSafeToCommit")
    .includes("option.destinationCompany"));

check("stable freight reliability ignores destination company completely",
  !method(service, "private boolean isFreightDataReliable", "private boolean hasPartialResultSemanticEvidence")
    .includes("destinationCompany")
  && method(service, "private boolean isFreightDataReliable", "private boolean hasPartialResultSemanticEvidence")
    .includes("GtoFreightFieldEvidencePolicy"));

check("legacy HF13 destination-company review is migrated without losing selected freight",
  method(service, "private boolean isFreightReviewPending", "private boolean isResultTrackingState")
    .includes("Empresa de destino opcional")
  && method(service, "private boolean isFreightReviewPending", "private boolean isResultTrackingState")
    .includes("commitReviewedFreight(current)"));

check("foreground polling preserves an explicitly open NVU card",
  service.includes("suspendPassiveDetectionOverlaysKeepBubbleAndMenu();")
  && !method(service, "private void suspendPassiveDetectionOverlaysKeepBubbleAndMenu", "private void suspendInteractiveOverlaysKeepBubble").includes("closeMenu()"));

check("permission flow can still explicitly close interactive card when required",
  method(service, "private void suspendInteractiveOverlaysKeepBubble", "private void hideOverlays").includes("closeMenu()"));

check("stale freight-panel callback cannot close card after row review is active",
  method(service, "private void keepOverlaysClearOfFreightPanel", "private void keepOverlaysClearOfResultRegion")
    .includes("freightListInteractionActive")
  && method(service, "private void keepOverlaysClearOfFreightPanel", "private void keepOverlaysClearOfResultRegion")
    .includes("!isFreightReviewPending()")
  && method(service, "private void keepOverlaysClearOfFreightPanel", "private void keepOverlaysClearOfResultRegion")
    .includes("if (!freightListInteractionActive) return;"));

check("review card does not render Empresa destino",
  !service.includes('details.append("Empresa destino: ")'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf14-"));
try {
  const run = spawnSync("java", [
    "scripts/java-tests/JavaTestRunner.java", tmp,
    "com.nvu.operacional.GtoR334Hf14DestinationOptionalPolicyTest",
    "android/app/src/main/java/com/nvu/operacional/GtoManualRouteSelectionPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightReviewPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java",
    "scripts/java-tests/com/nvu/operacional/GtoR334Hf14DestinationOptionalPolicyTest.java"
  ], { cwd: root, encoding: "utf8" });
  const output = `${run.stdout || ""}${run.stderr || ""}`.trim();
  check("HF14 destination optional policy compiles and passes",
    run.status === 0 && output.includes("GtoR334Hf14DestinationOptionalPolicyTest: PASS"));
  if (run.status !== 0) console.error(output);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${14 - failures.length}/14 HF14 review/overlay checks passed.`);
if (failures.length) process.exit(1);
