import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoResultActionFlowPolicy.java");
const selectionPolicy = read("android/app/src/main/java/com/nvu/operacional/GtoSelectionInteractionPolicy.java");
const plugin = read("android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java");
const manifest = read("android/app/src/main/AndroidManifest.xml");
const checks = [];
function check(name, condition) {
  const ok = Boolean(condition);
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

const sensorUpdate = service.slice(
  service.indexOf("private void updateFreightTouchPulseSensor"),
  service.indexOf("private boolean hasFreshVisualGtoActionEvidence")
);
const outside = service.slice(
  service.indexOf("private void handleOutsideTouch"),
  service.indexOf("private boolean confirmFreightAfterListExit")
);
const freshContext = service.slice(
  service.indexOf("private boolean isFreshFreightTouchContext"),
  service.indexOf("private boolean isCurrentGtoActionContext")
);

check("passive observer no longer depends on temporary capture authorization", policy.includes("return observeEnabled && overlayAllowed"));
check("sensor update uses the passive transport policy", sensorUpdate.includes("keepPassiveTransportObserver"));
check("sensor remains non-modal and watches outside touches", service.includes("FLAG_NOT_TOUCH_MODAL") && service.includes("FLAG_WATCH_OUTSIDE_TOUCH"));
check("sensor is not an action authority", policy.includes("Listener presence is transport only") && policy.includes("action mutation remains separately guarded"));
check("selection still requires current GTO action context", outside.includes("isCurrentGtoActionContext") || service.includes("isCurrentGtoActionContext"));
check("selection still requires a fresh current freight list", freshContext.includes("lastFreightListSeenAt") && selectionPolicy.includes("MAX_FRESH_LIST_AGE_MS"));
check("selection still requires current capture generation", freshContext.includes("currentGeneration") && freshContext.includes("visualContextGeneration == projectionGeneration"));
check("selection still requires row geometry count", freshContext.includes("buttonCount") && selectionPolicy.includes("acceptButtonCount < 1"));
check("OCR-only geometry can populate the same target list", service.includes('publishOcrFreightListGeometry(stableOptions, fullFrame, ocrNow)') && service.includes('"OCR_TEXT_GEOMETRY"'));
check("visual-only fallback is not promoted by the transport change", service.includes("Geometry alone is only a candidate") && service.includes("must never be exposed as a certified list"));
check("precise-touch compatibility API is not falsely used as a new transport", plugin.includes("openPreciseTouchSettings") && plugin.includes("no longer uses AccessibilityService") && !manifest.includes("AccessibilityService"));
check("the final commit remains transaction-bound", service.includes("pendingSelectionTransaction") && service.includes("confirmPreciseTouchCandidateOnListExit"));

const failed = checks.filter((ok) => !ok).length;
if (failed) {
  console.error(`\nHF187 simple-selection-transport: ${failed} check(s) failed.`);
  process.exit(1);
}
console.log(`\nHF187 simple-selection-transport: APPROVED (${checks.length}/${checks.length})`);
