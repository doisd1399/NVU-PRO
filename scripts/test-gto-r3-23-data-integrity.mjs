import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const paths = {
  service: "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java",
  textGuard: "android/app/src/main/java/com/nvu/operacional/GtoFreightTextGuard.java",
  selectionPolicy: "android/app/src/main/java/com/nvu/operacional/GtoFreightSelectionPolicy.java",
  moneyValue: "android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java",
  resultConsensus: "android/app/src/main/java/com/nvu/operacional/GtoResultValueConsensus.java",
  detector: "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java",
  listEvidence: "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
  resultGate: "android/app/src/main/java/com/nvu/operacional/GtoResultVisualGate.java",
  resultEvidence: "android/app/src/main/java/com/nvu/operacional/GtoResultEvidencePolicy.java",
  autoSync: "android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java",
  dashboard: "src/pages/driver/Dashboard.tsx",
  observerSetup: "src/components/GtoObserverSetup.tsx",
  rect: "scripts/java-tests/android/graphics/Rect.java",
  image: "scripts/java-tests/android/media/Image.java",
  selectionTest: "scripts/java-tests/com/nvu/operacional/GtoFreightSelectionRegressionTest.java",
  integrityTest: "scripts/java-tests/com/nvu/operacional/GtoFreightDataIntegrityTest.java",
  resultGateTest: "scripts/java-tests/com/nvu/operacional/GtoResultVisualGateScreenMatrixTest.java",
};

const service = fs.readFileSync(paths.service, "utf8");
const selectionPolicy = fs.readFileSync(paths.selectionPolicy, "utf8");
const autoSync = fs.readFileSync(paths.autoSync, "utf8");
const dashboard = fs.readFileSync(paths.dashboard, "utf8");
const observerSetup = fs.readFileSync(paths.observerSetup, "utf8");
const checks = [];
function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

check(
  "canonical freight text remains literal while page history cannot overwrite selected-row evidence",
  service.includes("FreightOption canonical = exact == null ? new FreightOption() : copyFreightOption(exact)")
    && service.includes("lastFreightSecondaryReadDiff")
    && service.includes("!GtoFreightFieldEvidencePolicy.text(")
    && service.includes("!GtoFreightFieldEvidencePolicy.distance(")
    && service.includes("!GtoFreightFieldEvidencePolicy.money(")
    && selectionPolicy.includes("numericConflict(secondaryKm, canonicalKm)")
    && selectionPolicy.includes("moneyConflict(secondaryValue, canonicalValue)"),
);
check(
  "single plausible OCR snapshots are not accepted as freight fallbacks",
  service.includes("isStableFreightSafeToCommit")
    && !service.includes("stable != null && isExactFreightDataValid(stable)"),
);
check(
  "fast page OCR uses the same stabilization evidence as full OCR",
  service.includes("List<FreightOption> stable = stabilizeFreightOptions(pageKey, parsed)")
    && service.includes("base.destinationVotes = destination.count")
    && service.includes("GtoFreightFieldEvidencePolicy")
    && service.includes("base.dataConfidence = evidence / 5f"),
);
check(
  "legacy company-city continuity is retired and selected source company becomes Origem",
  !service.includes("learnCompanyCities(")
    && !service.includes("resolveKnownOrigin(")
    && (service.includes('putString("selectedOriginSource", selected.originEvidenceSource')
      || service.includes('putString("selectedOriginSource", certified.optString("originEvidenceSource"'))
    && (service.includes("GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(")
      || service.includes("GtoCertifiedFreight"))
    && service.includes("selected.originCompany"),
);
check(
  "selected freight JSON matches the durable sync contract without breaking Web aliases",
  service.includes('json.put("selectedRow", option.rowIndex)')
    && service.includes('json.put("distanceKm", option.km)')
    && service.includes('json.put("row", option.rowIndex)')
    && service.includes('json.put("km", option.km)')
    && (service.includes('putInt("selectedFreightRow", selected.rowIndex)')
      || service.includes('putInt("selectedFreightRow", certified.optInt("selectedRow"'))
    && autoSync.includes('candidate.optInt("row", -1)')
    && autoSync.includes('candidate.put("distanceKm", candidate.optString("km", ""))'),
);
check(
  "selection failure is visible in overlay, menu and foreground notification",
  service.includes('putString("selectionConfirmationStatus", "FAILED")')
    && service.includes("Nenhum dado foi registrado")
    && service.includes("Frete não confirmado · abra a bolinha NVU"),
);
check(
  "selection failure diagnostics are mounted in the active GTO dashboard",
  (dashboard.match(/<GtoObserverSetup/g) || []).length === 1
    && dashboard.indexOf("<GtoObserverSetup") > dashboard.indexOf("const handleFinishJob")
    && dashboard.indexOf("<GtoObserverSetup") < dashboard.indexOf("{/* Main Job Card */}")
    && observerSetup.includes("status.selectionConfirmationStatus === \"FAILED\"")
    && observerSetup.includes("Nenhum dado foi registrado"),
);
check(
  "NVU overlays are moved outside the detected freight panel",
  service.includes("keepOverlaysClearOfFreightPanel(left, full.getWidth())")
    && service.includes("overlayOcclusionPreventedAt")
    && service.includes("freightOverlaySafeRight"),
);
check(
  "selected-row OCR is latency-isolated but memory-bounded on a dedicated cropped recognizer",
  service.includes("selectionTextRecognizer = TextRecognition.getClient")
    && service.includes("Bitmap rowCrop = Bitmap.createBitmap")
    && service.includes("preciseSelectionOcrBusy || focusedFreightConflictRetryBusy")
    && !service.includes("preciseSelectionOcrBusy || focusedFreightConflictRetryBusy || ocrBusy.get()")
    && service.includes("PRECISE_OCR_BUSY_WAIT_TIMEOUT_MS"),
);
check(
  "final result amount requires immutable multi-pass consensus",
  service.includes("observeResultValueCandidate")
    && service.includes("resultValueConsensusStable")
    && !service.includes("recoverResultValueFromPersistedOcr"),
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-gto-r323-integrity-"));
function runJava(name, mainClass, sources) {
  const outputDir = path.join(tmp, name);
  const run = spawnSync(
    "java",
    ["scripts/java-tests/JavaTestRunner.java", outputDir, mainClass, ...sources],
    { encoding: "utf8" },
  );
  const output = `${run.stderr || ""}\n${run.stdout || ""}`.trim();
  check(`${name} fixtures compile`, !output.includes("compilation failed") && !output.includes("Java compilation failed"), output);
  check(`${name} scenarios pass`, run.status === 0 && String(run.stdout || "").includes("PASS"), output || String(run.error || ""));
}

try {
  runJava("freight-data-integrity", "com.nvu.operacional.GtoFreightDataIntegrityTest", [
    paths.textGuard,
    paths.moneyValue,
    paths.resultConsensus,
    paths.integrityTest,
  ]);
  runJava("screen-size-selection", "com.nvu.operacional.GtoFreightSelectionRegressionTest", [
    paths.rect,
    paths.image,
    paths.detector,
      paths.listEvidence,
    paths.selectionTest,
  ]);
  runJava("screen-size-result", "com.nvu.operacional.GtoResultVisualGateScreenMatrixTest", [
    paths.rect,
    paths.image,
    paths.resultGate,
      paths.resultEvidence,
    paths.resultGateTest,
  ]);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = checks.filter((item) => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} R3.23 data-integrity checks passed.`);
if (failed.length) process.exit(1);
