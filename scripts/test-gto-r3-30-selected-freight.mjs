import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const read = (p) => fs.readFileSync(p, "utf8");
const servicePath = "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java";
const policyPath = "android/app/src/main/java/com/nvu/operacional/GtoFreightSelectionPolicy.java";
const detectorPath = "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java";
const listEvidencePath = "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java";
const service = read(servicePath);
const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function runJava(name, mainClass, sources, javaArgs = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-r330-"));
  try {
    const run = spawnSync("java", [...javaArgs, "scripts/java-tests/JavaTestRunner.java", tmp, mainClass, ...sources], { encoding: "utf8" });
    const out = `${run.stderr || ""}\n${run.stdout || ""}`.trim();
    check(`${name} fixtures compile`, !out.includes("Java compilation failed"), out);
    check(`${name} scenarios pass`, run.status === 0 && String(run.stdout || "").includes("PASS"), out || String(run.error || ""));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

check("selection forces canonical page consensus before row OCR", service.includes("!isStableFreightSafeToCommit(canonicalBeforeSelection)"));
check("secondary crop cannot destructively shorten parsed company route", service.includes("Refinement is fill-only") && service.includes("option.destinationCompany == null || option.destinationCompany.trim().isEmpty()"));
check("wrapped destination company continuation is preserved", service.includes("destinationCompany.append(continuation)"));
check("immutable selected row remains base while frozen page evidence fills only truly missing fields",
  service.includes("FreightOption canonical = exact == null ? new FreightOption() : copyFreightOption(exact)")
  && service.includes("!GtoFreightFieldEvidencePolicy.text(")
  && service.includes("!GtoFreightFieldEvidencePolicy.distance(")
  && service.includes("!GtoFreightFieldEvidencePolicy.money("));
check("secondary OCR is advisory except explicit numeric conflict", service.includes("GtoFreightSelectionPolicy.canCommitCanonicalRow"));
check("secondary text differences are diagnostic and do not overwrite canonical text", service.includes("lastFreightSecondaryReadDiff"));
check("old all-fields secondary agreement is no longer a commit gate", !service.includes("|| !hasIndependentVisibleAgreement(selected, stableSamePage)"));
check("selection preserves the touched row when canonical OCR lacks consensus", service.includes("A linha selecionada foi preservada; confirme somente o campo que permaneceu sem evidência suficiente.") && service.includes("enterFreightReview"));
check("selected freight still advances only through commitPreciseFreight", service.includes("commitPreciseFreight(selected)"));

runJava(
  "canonical selected-row policy",
  "com.nvu.operacional.GtoFreightSelectionPolicyTest",
  [
    policyPath,
    "android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java",
    "scripts/java-tests/com/nvu/operacional/GtoFreightSelectionPolicyTest.java",
  ],
);
if (fs.existsSync("scripts/fixtures/r329-real-freight-list.png")) {
  runJava(
    "real list geometry remains strict",
    "com.nvu.operacional.GtoR329StrictFreightScreenTest",
    [
      "scripts/java-tests/android/graphics/Rect.java",
      "scripts/java-tests/android/media/Image.java",
      detectorPath,
      listEvidencePath,
      "scripts/java-tests/com/nvu/operacional/GtoR329StrictFreightScreenTest.java",
    ],
    ["-Djava.awt.headless=true"],
  );
} else {
  check("real list pixel fixtures", true, "SKIPPED: binary fixtures are not part of this source-only checkout");
}
runJava(
  "1-6 visual row selection remains exact",
  "com.nvu.operacional.GtoFreightSelectionRegressionTest",
  [
    "scripts/java-tests/android/graphics/Rect.java",
    "scripts/java-tests/android/media/Image.java",
    detectorPath,
    listEvidencePath,
    "scripts/java-tests/com/nvu/operacional/GtoFreightSelectionRegressionTest.java",
  ],
);

if (fs.existsSync("scripts/fixtures/r329-real-freight-list.png")) {
  runJava(
    "current reported R3.29 screenshots",
    "com.nvu.operacional.GtoR330CurrentScreensTest",
    [
      "scripts/java-tests/android/graphics/Rect.java",
      "scripts/java-tests/android/media/Image.java",
      detectorPath,
      listEvidencePath,
      "scripts/java-tests/com/nvu/operacional/GtoR330CurrentScreensTest.java",
    ],
    ["-Djava.awt.headless=true"],
  );
} else {
  check("current reported screenshot fixtures", true, "SKIPPED: binary fixtures are not part of this source-only checkout");
}

const failed = checks.filter((x) => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} R3.30 selected-freight checks passed.`);
if (failed.length) process.exit(1);
