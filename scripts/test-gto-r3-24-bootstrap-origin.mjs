import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const files = {
  service: "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java",
  plugin: "android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java",
  sync: "android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java",
  modePolicy: "android/app/src/main/java/com/nvu/operacional/GtoContractModePolicy.java",
  bootstrapPolicy: "android/app/src/main/java/com/nvu/operacional/GtoFreightBootstrapPolicy.java",
  dashboard: "src/pages/driver/Dashboard.tsx",
  observerType: "src/lib/gtoObserver.ts",
  backend: "functions/src/gtoTrips.ts",
  javaTest: "scripts/java-tests/com/nvu/operacional/GtoR324BootstrapOriginPolicyTest.java",
};

const read = (name) => fs.readFileSync(files[name], "utf8");
const service = read("service");
const plugin = read("plugin");
const sync = read("sync");
const dashboard = read("dashboard");
const observerType = read("observerType");
const backend = read("backend");
const checks = [];
function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

check(
  "fresh automatic bootstrap does not discard a fast first Aceitar tap",
  service.includes("GtoFreightBootstrapPolicy.shouldAwaitSecondListFrame")
    && service.includes("exactConsistentRowForTouch")
    && service.indexOf("exactConsistentRowForTouch") < service.indexOf("GtoFreightBootstrapPolicy.shouldAwaitSecondListFrame"),
);
check(
  "bootstrap touch is armed once with the real coordinates",
  service.includes("touchArmedDuringPromotion")
    && service.includes("promoteReplacementFreightCandidateToWaiting(\n                    true, rawX, rawY, localX, localY")
    && service.includes("if (!touchArmedDuringPromotion)")
    && service.includes("armFastTouchPulseOnCaptureThread(rawX, rawY, localX, localY)"),
);
check(
  "coordinate and pressed-frame row disagreement fails closed",
  service.includes("replacementFreightPressedRow != exactReplacementRow")
    && service.includes("Toque e quadro pressionado apontaram linhas diferentes; seleção descartada"),
);
check(
  "active-route replacement still needs two frames or exact row evidence",
  read("bootstrapPolicy").includes("!isFreshState(state) && observedFrames < 2 && exactPressedRow < 0"),
);
check(
  "Web sends contract mode in both native observer contexts",
  (dashboard.match(/contractMode:\s*contract\.mode/g) || []).length >= 2
    && observerType.includes('contractMode?: "simple" | "detailed"'),
);
check(
  "native bridge preserves missing legacy mode instead of guessing a business mode",
  (plugin.includes("GtoContractModePolicy.normalize(call.getString(\"contractMode\"))")
    || plugin.includes('putStringIfPresent(editor, call, "contractMode"'))
    && read("modePolicy").includes('return "";'),
);
const lockOriginContract = sync.includes('String canonicalOrigin = clean(candidate.optString("origin", ""))')
  || sync.includes('String canonicalOrigin = GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(');
check(
  "automatic freight uses certified route Origem in every contract mode",
  (service.includes("GtoAcceptedFreightFieldPolicy.origin(") || service.includes("GtoCertifiedFreight.seal"))
    && (service.includes('putString("selectedOriginSource", selected.originEvidenceSource')
      || service.includes('putString("selectedOriginSource", certified.optString("originEvidenceSource"'))
    && lockOriginContract
    && sync.includes('if (canonicalOrigin.isEmpty())'),
);
check(
  "previous-destination origin continuity is removed from native flow",
  !service.includes("private String resolveKnownOrigin")
    && !service.includes('prefs.getString("currentGtoCity", "").trim()')
    && service.includes('.remove("currentGtoCity")'),
);
check(
  "backend derives authoritative mode from Firestore contract",
  backend.includes("const serverContractMode")
    && backend.includes('serverContractMode !== "simple" && serverContractMode !== "detailed"')
    && backend.includes('serverContractMode === "detailed" && !origin')
    && backend.includes("requestedContractMode !== serverContractMode"),
);
check(
  "backend preserves certified Origem independently from source company metadata",
  backend.includes('assertBoundedText(origin, "origin")')
    && backend.includes('const effectiveOrigin = origin;')
    && !backend.includes('if (origin !== originCompany)')
    && !backend.includes('const effectiveOrigin = originCompany')
    && !backend.includes('PREVIOUS_CONFIRMED_DESTINATION'),
);
check(
  "R3.23 sealed pending payloads remain hash-compatible after upgrade",
  !sync.slice(sync.indexOf("private static final String[] HASH_FIELDS"), sync.indexOf("interface Listener")).includes('"contractMode"'),
);
check(
  "exact destination anti-mutation guard remains enabled",
  service.includes("hasIndependentVisibleAgreement")
    && service.includes("sameVisibleText(exact.destination, stable.destination)"),
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-r324-policy-"));
try {
  const run = spawnSync(
    "java",
    [
      "scripts/java-tests/JavaTestRunner.java",
      tmp,
      "com.nvu.operacional.GtoR324BootstrapOriginPolicyTest",
      files.modePolicy,
      files.bootstrapPolicy,
      files.javaTest,
    ],
    { encoding: "utf8" },
  );
  const output = `${run.stderr || ""}\n${run.stdout || ""}`.trim();
  check("bootstrap/origin policy fixtures compile", !output.includes("compilation failed") && !output.includes("Java compilation failed"), output);
  check("bootstrap/origin policy scenarios pass", run.status === 0 && String(run.stdout || "").includes("PASS"), output || String(run.error || ""));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = checks.filter((x) => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} R3.24 bootstrap/origin checks passed.`);
if (failed.length) process.exit(1);
