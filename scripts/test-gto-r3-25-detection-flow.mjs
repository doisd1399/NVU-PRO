import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const files = {
  service: "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java",
  detector: "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java",
  listEvidence: "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
  visualPolicy: "android/app/src/main/java/com/nvu/operacional/GtoVisualForegroundPolicy.java",
  flowPolicy: "android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java",
  sync: "android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java",
  backend: "functions/src/gtoTrips.ts",
  rect: "scripts/java-tests/android/graphics/Rect.java",
  image: "scripts/java-tests/android/media/Image.java",
  realTest: "scripts/java-tests/com/nvu/operacional/GtoRealFreightScreenshotTest.java",
  selectionTest: "scripts/java-tests/com/nvu/operacional/GtoFreightSelectionRegressionTest.java",
  policyTest: "scripts/java-tests/com/nvu/operacional/GtoVisualForegroundPolicyTest.java",
};
const service = fs.readFileSync(files.service, "utf8");
const sync = fs.readFileSync(files.sync, "utf8");
const backend = fs.readFileSync(files.backend, "utf8");

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function runJava(name, mainClass, sources, extraJavaArgs = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-r325-"));
  try {
    const run = spawnSync(
      "java",
      [...extraJavaArgs, "scripts/java-tests/JavaTestRunner.java", tmp, mainClass, ...sources],
      { encoding: "utf8" },
    );
    const output = `${run.stderr || ""}\n${run.stdout || ""}`.trim();
    check(`${name} fixtures compile`, !output.includes("Java compilation failed"), output);
    check(`${name} scenarios pass`, run.status === 0 && String(run.stdout || "").includes("PASS"), output || String(run.error || ""));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

check(
  "capture gate can recover from stale OEM UsageStats using real freight pixels",
  service.includes("capture-gate-freight-list")
    && service.includes("canUseFreightListAsVisualGtoProof")
    && service.includes("recordVisualGtoForegroundEvidence")
    && service.indexOf("recordVisualGtoForegroundEvidence(") < service.indexOf("captureStabilityGate.observeFrame("),
);
check(
  "live freight frames refresh visual foreground evidence before capture-ready check",
  service.includes('recordVisualGtoForegroundEvidence(now, runtimeFreightCount, "live-freight-list")')
    && service.indexOf('"live-freight-list"') < service.indexOf("!isCaptureReadyForAnalysis(now)"),
);
check(
  "fast freight path restores list lifecycle reopen/close edges",
  service.includes("onFreightListVisibleAgain(now);")
    && service.includes("markFreightListClosed(now);")
    && service.includes("freightListReopenPending"),
);
check(
  "OEM no-touch selection uses isolated row visuals but still needs list exit and precise OCR",
  service.includes("fastVisualDetector.detectPressedRow(")
    && service.includes("detectTemporarilyMissingPressedRow(")
    && service.includes("fastMissingListFrames >= missingRequired")
    && service.includes("runPreciseSelectedRowOcr(transaction)"),
);
check(
  "driver receives explicit list-detected and selected-freight messages",
  (service.includes("Lista de fretes detectada · ") || service.includes("Lista de fretes detectada ✓ · "))
    && (service.includes("Frete identificado. Tudo preparado, podemos partir!") || service.includes("Frete confirmado ✓ · viagem em andamento.")),
);
check(
  "menu status refreshes when freight runtime count changes",
  service.includes("mainHandler.post(this::refreshMenuContents)")
    && service.includes('if (detected > 0) return "Lista de fretes detectada"') && service.includes('if (visualDetected >= 2) return "Lista de fretes localizada"'),
);
check(
  "backend request type includes contractMode and still validates server contract mode",
  backend.includes("contractMode?: unknown;")
    && backend.includes("requestedContractMode")
    && backend.includes("serverContractMode"),
);
check(
  "automatic completion remains sealed and queued before network send",
  sync.includes("sealPayload(payload)")
    && sync.includes("queue.edit().putString(QUEUE_PREFIX + sessionId, sealed).commit()")
    && sync.includes("registerGtoTrip"),
);
check(
  "exact freight anti-mutation agreement remains enabled",
  service.includes("hasIndependentVisibleAgreement")
    && service.includes("sameVisibleText(exact.destination, stable.destination)"),
);

// Type-check the real Functions source against tiny API stubs. This catches internal
// request-contract errors (including the R3.24 missing contractMode field) without
// requiring Firebase packages to be installed just to run this regression test.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-r325-functions-"));
  try {
    const typeRoots = path.join(tmp, "types");
    fs.mkdirSync(typeRoots, { recursive: true });
    const stubs = path.join(tmp, "firebase-stubs.d.ts");
    fs.writeFileSync(stubs, `declare module "firebase-functions" {
  export namespace https {
    type CallableContext = any;
    class HttpsError extends Error { constructor(code: string, message: string, details?: any); }
  }
  export function region(...regions: string[]): any;
}
declare module "firebase-admin" {
  export function firestore(): any;
  export namespace firestore {
    type DocumentData = any;
    type Firestore = any;
    const FieldValue: any;
    const Timestamp: any;
  }
}
declare module "node:crypto" { export function createHash(name: string): any; }
`);
    // Always invoke the project-local TypeScript compiler through Node.
    // Calling "tsc" directly is not portable on Windows because the Functions
    // node_modules/.bin directory is not added to PATH by the root npm script.
    const localTsc = path.resolve("functions", "node_modules", "typescript", "bin", "tsc");
    const typeArgs = [
      "--noEmit", "--target", "ES2022", "--module", "commonjs",
      "--moduleResolution", "node", "--skipLibCheck", "--typeRoots", typeRoots,
      stubs, files.backend,
    ];
    let run;
    if (fs.existsSync(localTsc)) {
      run = spawnSync(process.execPath, [localTsc, ...typeArgs], { encoding: "utf8" });
    } else {
      // The Windows release path always installs functions/node_modules first. A global
      // compiler is accepted only as a CI/container fallback; it is never required from
      // the driver machine and therefore cannot recreate the old spawnSync ENOENT bug.
      const probe = spawnSync("tsc", ["--version"], { encoding: "utf8" });
      if (probe.status === 0) run = spawnSync("tsc", typeArgs, { encoding: "utf8" });
    }
    if (!run) {
      check(
        "Functions GTO source type-checks",
        false,
        "TypeScript nao encontrado. Execute: npm --prefix functions ci",
      );
    } else {
      const output = `${run.stderr || ""}\n${run.stdout || ""}`.trim();
      check("Functions GTO source type-checks", run.status === 0, output || String(run.error || ""));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (fs.existsSync("scripts/fixtures/gto-real-freight-list-5.png")) {
  runJava(
    "real reported screenshot",
    "com.nvu.operacional.GtoRealFreightScreenshotTest",
    [files.rect, files.image, files.detector,
        files.listEvidence, files.realTest],
    ["-Djava.awt.headless=true"],
  );
} else {
  check("real reported screenshot fixture", true, "SKIPPED: binary fixture is not part of this source-only checkout");
}
runJava(
  "OEM visual foreground policy",
  "com.nvu.operacional.GtoVisualForegroundPolicyTest",
  [files.flowPolicy, files.visualPolicy, files.policyTest],
);
runJava(
  "1-6/visual selection regression",
  "com.nvu.operacional.GtoFreightSelectionRegressionTest",
  [files.rect, files.image, files.detector,
      files.listEvidence, files.selectionTest],
);

const failed = checks.filter((item) => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} R3.25 detection-flow checks passed.`);
if (failed.length) process.exit(1);
