import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const health = read("android/app/src/main/java/com/nvu/operacional/GtoCaptureHealthPolicy.java");
const origin = read("android/app/src/main/java/com/nvu/operacional/GtoOriginGeometryPolicy.java");
const flow = read("android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java");
const failures = [];
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures.push(name);
}

check("capture health requires real received and analyzed timestamps",
  service.includes("lastProjectionFrameAt") && service.includes("lastProjectionAnalyzedFrameAt") && service.includes("isCapturePipelineHealthy"));
check("capture recovery has no terminal two-attempt cap",
  !service.includes("PROJECTION_SURFACE_REBIND_MAX_ATTEMPTS") && service.includes("PROJECTION_SURFACE_REBIND_COOLDOWN_MS"));
check("stale capture repeatedly rebinds without requesting a new token",
  service.includes("shouldRecoverSurface") && service.includes("rebindProjectionSurfaceWithoutReauthorization"));
check("analysis stall is included in capture recovery",
  service.includes("PROJECTION_STALE_ANALYSIS_WATCHDOG_MS")
  && health.includes("analysisStalled")
  && service.includes("lastProjectionAnalyzedFrameAt"));
check("resize failure preserves projection token instead of terminal reset",
  service.includes('putString("captureReadiness", "RECOVERING_RESIZE")')
  && service.includes("Only MediaProjection.Callback.onStop() is allowed"));
check("capture health policy is based on fresh frames and analysis",
  health.includes("FRAME_HEALTH_FRESH_MS") && health.includes("ANALYSIS_HEALTH_FRESH_MS"));
check("white health dot is driven by real pipeline health",
  service.includes("captureHealthDotView") && service.includes("displayedHealthy ? Color.WHITE") && service.includes('"HEALTHY_REAL_DETECTOR"'));
check("primary bubble is preserved through foreground oscillation",
  service.includes("suspendInteractiveOverlaysKeepBubble();") && !service.includes("// caused visible flicker and lost click/menu continuity.\n                hideOverlays();"));
check("menu passive refresh avoids destructive rebuild when nothing changed",
  service.includes("menuRenderSignature") && service.includes("if (nextSignature.equals(lastMenuRenderSignature)) return;"));
check("origin uses selected-row geometry with destination company as right anchor",
  service.includes("GtoOriginGeometryPolicy") && origin.includes("DESTINATION_ANCHORED_GEOMETRY"));
check("geometric origin survives because immutable selected-row evidence is canonical",
  service.includes("FreightOption canonical = exact == null ? new FreightOption() : copyFreightOption(exact)")
  && service.includes("canonical.originCompanySelectedRowEvidence")
  && service.includes("!GtoFreightFieldEvidencePolicy.text(")
  && !service.includes("selected.originCompanyVotes = Math.max(selected.originCompanyVotes, 2)"));
check("driver origin review text is short and neutral",
  service.includes('helper.setText("Origem não confirmada. Informe a origem do frete.")') && service.includes('? "Origem do frete"') && service.includes('? "Salvar origem"'));
check("destination company remains internal but is not rendered on review card",
  !service.includes('details.append("Empresa destino: ")') && service.includes("destinationCompany"));
check("informational list detection does not relax active-trip replacement policy",
  flow.includes("static boolean mayReplaceActiveTrip")
  && flow.includes("stableFreightListReturned && \"TRIP_IN_PROGRESS\".equals(state)"));
check("five-trip automatic continuation keeps capture session instead of stopping projection",
  service.includes("beginTrip(false, false)")
  && service.includes("prepareNextFreightFromSealedQueue")
  && !service.slice(service.indexOf("private boolean prepareNextFreightFromSealedQueue"), service.indexOf("private void beginTrip()" )).includes("stopProjection()"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf13-"));
try {
  const run = spawnSync("java", [
    "scripts/java-tests/JavaTestRunner.java", tmp,
    "com.nvu.operacional.GtoR334Hf13CaptureOriginPolicyTest",
    "android/app/src/main/java/com/nvu/operacional/GtoCaptureHealthPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoListOriginTextPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoOriginGeometryPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoR334Hf13CaptureOriginPolicyTest.java"
  ], { cwd: root, encoding: "utf8" });
  const output = `${run.stdout || ""}${run.stderr || ""}`.trim();
  check("new capture/origin policies compile and pass", run.status === 0 && output.includes("PASS"));
  if (run.status !== 0) console.error(output);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${16 - failures.length}/16 HF13 capture/origin checks passed.`);
if (failures.length) process.exit(1);
