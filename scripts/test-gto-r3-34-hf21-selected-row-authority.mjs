import fs from "node:fs";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const checks = [];
const check = (name, ok, detail="") => {
  checks.push({name, ok: !!ok});
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const method = (src, a, b) => {
  const i = src.indexOf(a); if (i < 0) return "";
  const j = src.indexOf(b, i + a.length); return src.slice(i, j < 0 ? src.length : j);
};

const merge = method(service,
  "private FreightOption mergeVerifiedPreciseWithStable",
  "private boolean hasUnresolvedDestinationOneEditConflict");
const precise = method(service,
  "private void runPreciseSelectedRowOcr",
  "private boolean isCurrentPreciseSelectionOcr");
const tx = method(service,
  "private static final class FreightSelectionTransaction",
  "private static class ButtonFrameSample");
const buildTx = method(service,
  "private FreightSelectionTransaction buildSelectionTransaction",
  "private void replacePendingSelectionTransaction");
const imageFlow = method(service,
  "private void onImageAvailable",
  "private boolean isCurrentAnalysisOcr");

const code = Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0);
const patch = Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/)||[])[1]||0);
check("HF21+ Android identity remains at or above 1.0.73 / 73", code >= 73 && patch >= 73);
check("workflow remains aligned to the current HF21+ release", workflow.includes(`EXPECTED_VERSION_CODE: "${code}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "1.0.${patch}"`));

check("selection transaction freezes page OCR from the pre-touch generation",
  tx.includes("final FreightOption baselineOption")
    && buildTx.includes("FreightOption frozenBaseline = stableFreightForRow(rowIndex)")
    && buildTx.includes("copyFreightOption(frozenBaseline)"));
check("selected-row merge starts from exact row instead of page history",
  merge.includes("copyFreightOption(exact)")
    && !merge.includes("stable == null ? new FreightOption() : copyFreightOption(stable)"));
check("page history can only fill fields missing selected-row evidence",
  merge.includes("!GtoFreightFieldEvidencePolicy.text(")
    && merge.includes("!GtoFreightFieldEvidencePolicy.distance(")
    && merge.includes("!GtoFreightFieldEvidencePolicy.money("));
check("selected-row OCR callback uses frozen page baseline, never live current page",
  precise.includes("frozenSelectedPageBaseline")
    && precise.includes("stableOriginHint = frozenSelectedPageBaseline")
    && precise.includes("stableSamePage = frozenSelectedPageBaseline"));
check("OCR failure preserves row for review instead of auto-committing page history",
  precise.includes("A failed selected-row OCR must never auto-commit page history")
    && !precise.includes("if (isStableFreightSafeToCommit(stable)) {\n                    commitPreciseFreight(stable);"));
check("timeout cannot auto-lock a live page-history row",
  precise.includes("Do not commit a live page-history row after a timeout"));
const resultFallbackMs = Number((service.match(/ACTIVE_TRIP_RESULT_FALLBACK_OCR_MS = (\d+)L/) || [])[1] || 0);
check("result OCR fallback remains bounded during normal gameplay",
  resultFallbackMs >= 180 && resultFallbackMs <= 1800);
check("result state remains semantic-only with no pixel/color wake-up gate",
  !imageFlow.includes("tripResultCandidate = resultVisualGate.looksLikeResultDialog")
    && imageFlow.includes("semantic pair Concluído + monetary value")
    && imageFlow.includes("tripCandidateOcrDue = false"));
check("bounded OCR cadence avoids per-frame OCR and certified-exit continuity cannot wake a result",
  resultFallbackMs >= 180
    && imageFlow.includes("GtoCertifiedResultLifecyclePolicy.shouldTrack")
    && imageFlow.includes("resultVisualGate.looksLikeCertifiedResultStillVisible")
    && !imageFlow.includes("tripResultCandidate = resultVisualGate.looksLikeResultDialog")
    && !imageFlow.includes("resultVisualGate.looksLikeResultDialog(image"));

// Behavioral model of the exact bug reported from page 2, row 3.
const exactRow3 = {
  cargo: "CARGA TIJOLO",
  origin: "Fábrica de Tijolo",
  destination: "Área Rural",
  km: "600Km",
  value: "R$ 11600"
};
const staleOtherPage = {
  cargo: "Cerâmicas",
  origin: "Fábrica de Tijolo",
  destination: "Cruz do Oeste",
  km: "600Km",
  value: "R$ 5300"
};
const selectedRowWins = (exact, stable) => ({
  cargo: exact.cargo || stable.cargo,
  origin: exact.origin || stable.origin,
  destination: exact.destination || stable.destination,
  km: exact.km || stable.km,
  value: exact.value || stable.value,
});
const merged = selectedRowWins(exactRow3, staleOtherPage);
check("reported row-3 scenario cannot be rewritten by stale page text",
  merged.cargo === "CARGA TIJOLO"
    && merged.origin === "Fábrica de Tijolo"
    && merged.destination === "Área Rural"
    && merged.km === "600Km"
    && merged.value === "R$ 11600");

const missingValue = selectedRowWins({...exactRow3, value: ""}, {...exactRow3, value: "R$ 11600"});
check("same frozen row may support only a field the selected OCR missed",
  missingValue.cargo === exactRow3.cargo
    && missingValue.destination === exactRow3.destination
    && missingValue.value === "R$ 11600");

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF21 checks passed.`);
if (failed.length) process.exit(1);
