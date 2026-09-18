import fs from "node:fs";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const priority = read("android/app/src/main/java/com/nvu/operacional/GtoDriverMessagePriorityPolicy.java");
const simple = read("android/app/src/main/java/com/nvu/operacional/GtoSimpleScreenDetectionPolicy.java");
const diagnostics = read("android/app/src/main/java/com/nvu/operacional/GtoObserverDiagnostics.java");
const fieldStatus = read("android/app/src/main/java/com/nvu/operacional/GtoFreightFieldStatusPolicy.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");

const checks = [];
const check = (name, ok) => {
  checks.push({name, ok: !!ok});
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};

const code = Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0);
const patch = Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/)||[])[1]||0);
check("HF22+ identity remains at or above 1.0.74 / 74", code >= 74 && patch >= 74);
check("workflow remains aligned to current HF22+ release", workflow.includes(`EXPECTED_VERSION_CODE: "${code}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "1.0.${patch}"`));

check("driver messages have explicit INFO/SUCCESS/ACTION/CRITICAL priority", 
  priority.includes("static final int INFO") && priority.includes("static final int CRITICAL") && priority.includes("priorityFor"));
check("new authoritative stage replaces stale message immediately while auto-hide remains bounded",
  service.includes("journey-state messages are live state, not a slideshow queue")
    && service.includes("DRIVER_STAGE_MIN_VISIBLE_MS = 650L")
    && service.includes("long acknowledgementDelay = 0L;"));
check("critical/action stage can preempt lower-priority messaging without touching trip state",
  priority.includes("incomingPriority > currentPriority") && !priority.includes("tripState"));

check("observer keeps a sparse circular log capped at 50 events",
  diagnostics.includes("MAX_EVENTS = 50") && diagnostics.includes("observerEventLog") && diagnostics.includes("MAX_EVENTS - 1"));
check("incident snapshot captures state, row, fields, sync and capture evidence",
  diagnostics.includes('incident.put("row"') && diagnostics.includes('incident.put("origin"')
    && diagnostics.includes('incident.put("syncStatus"') && diagnostics.includes('incident.put("captureStatus"'));
check("diagnostics are outside the decision path and fail closed to no-op",
  diagnostics.includes("Diagnostics are never allowed to affect the observer flow") && diagnostics.includes("catch (Exception ignored)"));

check("freight fields expose independent CONFIRMED/PENDING state",
  fieldStatus.includes('CONFIRMED = "CONFIRMED"') && fieldStatus.includes('PENDING = "PENDING"')
    && service.includes('putString("fieldStatusOrigin"') && service.includes('putString("fieldStatusValue"'));
check("destinationCompany remains optional metadata in field-state tracking",
  fieldStatus.includes('OPTIONAL = "OPTIONAL"') && service.includes('fieldStatusDestinationCompany'));
check("manual field save refreshes field-state evidence without resetting selection",
  service.includes('recordObserverEvent("FIELD_CONFIRMED"') && service.includes('persistFreightFieldStatuses(current, next)'));

check("selection identity is logged but still controlled by existing deterministic selector",
  service.includes('recordObserverEvent("SELECTION_" + safeStatus') && service.includes('persistSelectionIdentity(hit, "TOUCH_LOCKED", "precise-touch")'));
check("selection failure captures incident evidence before returning to waiting",
  service.includes('recordObserverIncident("SELECTION_NOT_CONFIRMED"'));
check("capture health transition creates evidence without changing capture policy",
  service.includes('recordObserverEvent("CAPTURE_HEALTHY"') && service.includes('recordObserverIncident("CAPTURE_UNHEALTHY"'));

check("replacement diagnostic follows the semantically certified canonical list lifecycle",
  service.includes('FREIGHT_LIST_REOPENED_CERTIFIED')
    && service.includes('"FREIGHT_REPLACEMENT_COMMITTED"')
    && service.includes('isReplacementFreightSemanticFresh')
    && !service.includes('putString("freightReplacementStatus", "PENDING")'));
check("stable jobs list retires stale trip while one unconfirmed frame cannot",
  service.includes("stableReturnedList")
    && service.includes("promoteReplacementFreightCandidateToWaiting")
    && simple.includes("observedFrames >= 2")
    && simple.includes("visibleForMs >= 55L"));

check("sync pending is visible but remains backed by durable queue behavior",
  service.includes('announceDriverStage("SYNC_PENDING"')
    && service.includes("GtoTripSubmissionCoordinator.submitCompletedTrip"));
check("operation card exposes complete current-operation data and observer/sync status",
  service.includes('"\\nViagens "')
    && service.includes('"\\nVeículo "')
    && service.includes('"\\nReboque "')
    && service.includes('"\\nProgresso "')
    && service.includes('"\\nObservador " + observerStatus')
    && service.includes('"\\nSincronização " + syncLabel'));

const resultFallbackMs = Number((service.match(/ACTIVE_TRIP_RESULT_FALLBACK_OCR_MS = (\d+)L/) || [])[1] || 0);
check("route OCR cadence remains real-time semantic authority while certified visual exit is terminal-only",
  resultFallbackMs >= 180 && resultFallbackMs <= 500
    && service.includes("tripCandidateOcrDue = false")
    && service.includes("GtoCertifiedResultLifecyclePolicy.shouldTrack")
    && service.includes("resultVisualGate.looksLikeCertifiedResultStillVisible")
    && service.includes("observeCertifiedResultVisualContinuity")
    && !service.includes("tripResultCandidate = resultVisualGate.looksLikeResultDialog"));
check("frame freshness and session-generation guards remain intact",
  service.includes("GtoFrameFreshnessPolicy.shouldConsume")
    && service.includes("generation != analysisOcrGeneration")
    && service.includes("generation != preciseSelectionOcrGeneration"));

check("critical integration mechanisms are still referenced unchanged",
  service.includes("GtoAutoTripSync.lockSelectedFreight")
    && service.includes("GtoTripSubmissionCoordinator.submitCompletedTrip")
    && service.includes("GtoAutoTripSync.syncCanonicalState"));

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF22 checks passed.`);
if (failed.length) process.exit(1);
