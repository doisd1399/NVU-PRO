import fs from "node:fs";

const root = process.cwd();
const servicePath = "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java";
const service = fs.readFileSync(`${root}/${servicePath}`, "utf8");
const checks = [];
const check = (name, ok) => {
  checks.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};
const body = (start, end) => {
  const a = service.indexOf(start);
  const b = service.indexOf(end, a);
  return a >= 0 && b > a ? service.slice(a, b) : "";
};
const listener = body("sensor.setOnTouchListener", "WindowManager.LayoutParams params");
const queue = body("private void queueFreightTouchMarker", "private void toggleMenu");
const pending = body("private void queuePendingAcceptEvent", "private void schedulePendingAcceptGeometryResolution");
const visual = body("private void refreshPhysicalTouchDiagnosticOverlay", "private void hidePhysicalTouchDiagnosticOverlay");

check("fresh geometry is accepted before global capture stability", service.includes("hasFreshAuthoritativeFreightGeometry") && listener.indexOf("freshAuthoritativeGeometry") < listener.indexOf("!isCurrentGtoActionContext"));
check("fresh geometry requires current bounded AcceptRects", service.includes("realtimeAcceptRects.size()") && service.includes("GtoSelectionInteractionPolicy.MAX_FRESH_LIST_AGE_MS") && service.includes('getLong("freightStructureAt", 0L)'));
check("queue context cannot reject a current geometry snapshot", queue.includes("hasFreshAuthoritativeFreightGeometry(queueNow)"));
check("capture processing preserves the same fresh-geometry exception", queue.includes("hasFreshAuthoritativeFreightGeometry(processNow)"));
check("pending generation uses structure timestamp as well as list timestamp", pending.includes('getLong("freightStructureAt", 0L)') && pending.includes("Math.max(lastFreightListSeenAt, structureAt)"));
check("old structure timestamp is cleared on session reset", service.includes('.remove("freightStructureAt")'));
check("reopened list can retire orphan context", service.includes("retireOrphanedTripContextAtNewFreightList") && service.includes("restartWaitingFreightSelectionSession"));
check("diagnostic overlay is disabled while telemetry remains internal", service.includes("return false;") && visual.includes("hidePhysicalTouchDiagnosticOverlay()") && service.includes('.putBoolean("touchDiagnosticMode", false)'));
check("LIST_GENERATION_INVALID remains a failure only outside the fresh snapshot path", service.includes('"LIST_GENERATION_INVALID"') && service.includes("if (hasFreshAuthoritativeFreightGeometry"));

const failed = checks.filter(Boolean).length !== checks.length;
console.log(`${checks.length - (failed ? 1 : 0)}/${checks.length} HF208 rapid-reopen checks passed.`);
if (failed) process.exit(1);
