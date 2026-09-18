import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const policyPath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoPauseScreenDetectionPolicy.java");
const servicePath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policy = fs.readFileSync(policyPath, "utf8");
const service = fs.readFileSync(servicePath, "utf8");
const checks = [];
function check(name, condition) {
  const ok = Boolean(condition);
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

check(
  "field anchors are available independently of generic pause categories",
  policy.includes("static boolean hasFreightFieldAnchor(List<String> lines)")
    && policy.includes('startsWithField(value, "carga")')
    && policy.includes('startsWithField(value, "origem")')
    && policy.includes('startsWithField(value, "destino")')
);
check(
  "detail page can be a pause surface without generic menu buttons",
  service.includes("boolean pauseSurface = pause || freightFieldAnchor;")
    && service.includes("if (!pauseSurface)")
    && service.includes("observePauseVisualContext(plainLines, now);")
);
check(
  "generic menu without fields remains non-reading state",
  service.includes("if (!freightFieldAnchor)")
    && service.includes("WAITING_FOR_PAUSE_DETAILS")
    && !service.includes("PAUSE_FIELDS_NOT_VISIBLE")
);
check(
  "field-labeled detail reaches readPauseFreight",
  service.includes("FreightOption freight = readPauseFreight(lines, plainLines);")
    && service.includes("if (freight == null)")
);
check(
  "validated pause still locks the canonical snapshot",
  service.includes("GtoAutoTripSync.lockSelectedFreight(this, prefs)")
    && service.includes("PAUSE_FREIGHT_VALIDATED")
);
check(
  "HF110 prompt restoration remains active",
  service.includes("restorePausePromptAfterCleanFrame")
    && service.includes("if (!pausePromptVisible)")
    && !service.includes("now - lastPausePromptAt >= PAUSE_PROMPT_REPEAT_MS")
);

const failed = checks.filter((ok) => !ok).length;
if (failed) {
  console.error(`\n${failed} HF111 check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} HF111 checks passed.`);
