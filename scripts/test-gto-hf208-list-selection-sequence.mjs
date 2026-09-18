import fs from "node:fs";

const root = process.cwd();
const service = fs.readFileSync(`${root}/android/app/src/main/java/com/nvu/operacional/GtoObserverService.java`, "utf8");
const lifecycle = fs.readFileSync(`${root}/android/app/src/main/java/com/nvu/operacional/GtoFreightLifecycleBoundaryPolicy.java`, "utf8");
const policy = fs.readFileSync(`${root}/android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java`, "utf8");

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const body = (start, end) => {
  const a = service.indexOf(start);
  const b = service.indexOf(end, a);
  return a >= 0 && b > a ? service.slice(a, b) : "";
};

const structural = body("private void updateRealtimeFreightStructure", "private void armSelectionProbe");
const frameLoop = body("private void processOrderedCaptureFrame", "private boolean isCurrentAnalysisOcr");
const semantic = body("private void markFreightPageSemanticallyCertified", "private boolean isFreightPageSemanticallyCertified");
const message = body("private void maybeAnnounceFastFreightListMessage", "private void resetLiveFreightMessageCandidate");
const commit = body("private boolean commitAuthoritativeFreightTouch", "private boolean confirmPreciseTouchCandidateOnListExit");

check(
  "the same bounded AcceptRects that produce ACCEPTS are allowed to drive the list message",
  structural.includes("detectAcceptButtonRects(frame)")
    && structural.includes("realtimeAcceptRects")
    && structural.includes("maybeAnnounceFastFreightListMessage")
);
check(
  "list messaging is not dependent on a separate fast-detector truth",
  structural.includes("maybeAnnounceFastFreightListMessage")
    || !frameLoop.includes("if (strongVisualList)")
);
check(
  "semantic certification admits the unanchored TRIP_STARTED recovery path",
  semantic.includes("STATE_TRIP_STARTED.equals(state)")
    && semantic.includes("mayObserveFreightSelectionSurface()")
);
check(
  "TRIP_STARTED recovery observes the list without replacing a confirmed active context",
  service.includes("mayObserveFreightSelectionSurface()")
    && lifecycle.includes("mayHandleCertifiedFreightBoundary")
    && !lifecycle.includes('return "TRIP_STARTED"')
);
check(
  "semantic failure preserves the observed bounded count for UI feedback",
  service.slice(service.indexOf("if (!semanticCertified)"), service.indexOf("long ocrNow", service.indexOf("if (!semanticCertified)"))).includes('putInt("freightVisualCount"')
);
check(
  "the selection path cannot advance to TRIP_STARTED without a row target",
  commit.includes("if (prefs == null || row < 0) return false")
    && commit.includes('persistSelectionIdentity(row, "TOUCH_LOCKED"')
    && commit.includes("startNextTripSessionOnAccept(row, touchedOption, safeSource)")
);
check(
  "the physical diagnostic is updated when the row is resolved, not only at session start",
  service.includes('"FREIGHT_ROW_RESOLVED"')
    && service.includes('"FREIGHT_TARGET_LOCKED"')
    && service.includes('"FREIGHT_SELECTION_VALIDATION_STARTED"')
);

const failed = checks.filter((ok) => !ok).length;
console.log(`${checks.length - failed}/${checks.length} HF208 list-selection sequence checks passed.`);
if (failed) process.exit(1);
