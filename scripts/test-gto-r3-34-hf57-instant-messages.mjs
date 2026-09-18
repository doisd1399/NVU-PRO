import fs from "node:fs";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const checks = [];
const ck = (name, ok) => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};
const section = (start, end) => {
  const a = service.indexOf(start);
  const b = service.indexOf(end, Math.max(0, a + start.length));
  return a >= 0 && b > a ? service.slice(a, b) : "";
};

const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
const versionPatch = Number((versionName.match(/^1\.0\.(\d+)$/) || [])[1] || 0);
ck("HF57+ Android identity", versionCode >= 109 && versionPatch >= 109);
ck("HF57+ workflow follows current Android identity", workflow.includes(`EXPECTED_VERSION_CODE: "${versionCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${versionName}"`));
ck("HF57+ workflow artifact remains post-HF57",   /NVU-R3\.34-PC-HF(?:5[7-9]|[6-9]\d|1[0-9]{2})-release\.apk/.test(workflow) && !workflow.includes("NVU-R3.34-PC-HF56-release.apk"));


ck("broken opçãoões spelling is absent", !service.includes("opçãoões"));
ck("freight count pluralization uses complete words", service.includes('safeCount == 1 ? " opção" : " opções"'));
ck("certified five-option text is built from corrected formatter", service.includes('"Lista de fretes detectada ✓ · " + freightOptionCountLabel(rowCount) + "."'));

const showChip = section(
  "private void showStatusChip(\n        String text,",
  "private void announceDriverStage("
);
ck("main-thread-safe immediate dispatcher exists", service.includes("private void runOnMainImmediatelyOrPost(Runnable action)") && service.includes("Looper.myLooper() == mainHandler.getLooper()"));
ck("status banner no longer forces an extra main-loop hop", showChip.includes("runOnMainImmediatelyOrPost(() ->") && !showChip.includes("mainHandler.post(() ->"));

const freightFrame = section("private void onFreightFrameAvailable(ImageReader reader)", "private FreightSelectionTransaction buildSelectionTransaction");
const fastCall = freightFrame.indexOf("maybeAnnounceFastFreightListMessage(");
const semanticCall = freightFrame.indexOf("ensureLiveFreightSemanticCertification(current, now);");
ck("fast list feedback runs before semantic OCR scheduling", fastCall >= 0 && semanticCall > fastCall);
ck("fast list feedback requires a strong multi-row visual list", freightFrame.includes("current.buttons != null && current.buttons.size() >= 2") && freightFrame.includes("if (strongVisualList)"));
ck("fast list feedback ignores the critical Accept touch window", freightFrame.includes("runtimeFreightCount, now, criticalTouchFrame"));
ck("fast list feedback is two-frame debounced", service.includes("FAST_FREIGHT_MESSAGE_CONFIRM_FRAMES = 2") && service.includes("FAST_FREIGHT_MESSAGE_CONFIRM_MS = 24L"));

const fastMethod = section("private void maybeAnnounceFastFreightListMessage(", "private void resetLiveFreightMessageCandidate()");
ck("fast list message is UI-only and cannot mutate trip state", fastMethod.includes('announceDriverStage("FREIGHT_LIST_VISUAL_PENDING"') && !fastMethod.includes("setTripState(") && !fastMethod.includes('putString("screenState"') && !fastMethod.includes("markFreightPageSemanticallyCertified("));
ck("semantic freight certification remains mandatory for authority", service.includes("GtoFreightSemanticCertificationPolicy.isCertifiedPage(") && service.includes("markFreightPageSemanticallyCertified(generation, semanticAnchors, visibleRowCount)"));

const closeMethod = section("private void markFreightListClosed(long now)", "private void armFreightListReopenAfterSelectionFailure");
ck("provisional list banner is cleared on the physical close edge", closeMethod.includes("clearFastFreightVisualPendingMessage();") && closeMethod.indexOf("clearFastFreightVisualPendingMessage();") < closeMethod.indexOf("if (!freightListCycleSeen)"));

const certifyMethod = section("private void markFreightPageSemanticallyCertified(", "private boolean isFreightPageSemanticallyCertified(");
const liveGuard = certifyMethod.indexOf("if (!liveWaitingList || !firstCertificationForGeneration) return;");
const officialMessage = certifyMethod.indexOf('"FREIGHT_LIST_DETECTED"');
ck("late asynchronous list OCR cannot overwrite a newer stage", certifyMethod.includes("boolean liveWaitingList = STATE_WAITING_FREIGHT.equals(state)") && certifyMethod.includes("now - lastFreightListSeenAt <= 380L") && liveGuard >= 0 && officialMessage > liveGuard);
ck("confirming-row OCR keeps evidence without repainting list UI", certifyMethod.includes("boolean confirmingSelectedRow = STATE_CONFIRMING_FREIGHT.equals(state)") && certifyMethod.includes("if (!liveWaitingList && !confirmingSelectedRow) return;") && certifyMethod.includes("if (!liveWaitingList || !firstCertificationForGeneration) return;"));

ck("active-trip result safety gate remains semantic-only", service.includes("ACTIVE_TRIP_RESULT_FALLBACK_OCR_MS = 220L") && service.includes("boolean tripCandidateOcrDue = false; // Semantic fallback only; no pixel/color result gate."));

const syncListener = section("private GtoAutoTripSync.Listener automaticTripSyncListener()", "private void flushAutomaticTripQueue()");
ck("backend ACK feedback avoids a redundant UI queue hop", syncListener.includes("public void onSynced") && syncListener.includes("runOnMainImmediatelyOrPost(() ->") && syncListener.includes('"Viagem registrada com sucesso!"'));
ck("success message still originates only from real sync callback", syncListener.indexOf('"Viagem registrada com sucesso!"') > syncListener.indexOf("public void onSynced") && !fastMethod.includes('"Viagem registrada com sucesso!"'));

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF57 instant-message checks passed.`);
if (failed.length) process.exit(1);
