import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoAcceptedFreightFieldPolicy.java");
const parser = read("android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java");
const correction = read("android/app/src/main/java/com/nvu/operacional/GtoPauseCorrectionPolicy.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const gradle = read("android/app/build.gradle");
const releaseCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const releaseName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";

const checks = [];
const check = (name, condition, detail = "") => {
  const ok = Boolean(condition);
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

check("Pause parser has a same-line company extractor", parser.includes("extractBeforeLastSeparator") && parser.includes("extractCompanyAndLocation"));
check("Pause reads origin company from the current route line", service.includes('freight.originCompany = pauseCompanyTextField(lines, "origem", "empresa de origem")'));
check("Pause reads destination company from the current route line", service.includes('freight.destinationCompany = pauseCompanyTextField(lines, "destino", "cidade de destino", "destino final")'));
check("Pause validation marker is distinct from merely observed Pause", service.includes("pauseCorrectionConfirmed") && service.includes("freight.pauseCorrectionConfirmed = true"));
check("Pause correction policy requires same row and immutable anchors", correction.includes("sameSelectedFreightAnchors") && correction.includes("lockedRow == candidateRow") && correction.includes("sameNumericValue") && correction.includes("sameMoney"));
check("locked snapshot allows only validated same-session Pause reconciliation", sync.includes("candidate.optBoolean(\"pauseCorrectionConfirmed\", false)") && sync.includes("GtoPauseCorrectionPolicy.sameSelectedFreightAnchors") && sync.includes("Não foi possível persistir a correção validada do menu pause"));
check("ordinary locked freight remains fail-closed on divergence", sync.includes("O frete desta sessão já estava bloqueado com dados diferentes.") && sync.includes("if (!sameAnchors)"));
check("reconciled Pause fields are written to the durable snapshot", sync.includes('snapshot.put("pauseCorrectionConfirmed", true)') && sync.includes('snapshot.put(field, candidate.optString(field, ""))'));
check("restore distinguishes validated Pause from stale Pause", sync.includes('boolean pauseCorrectionConfirmed = snapshot.optBoolean("pauseCorrectionConfirmed", false)') && sync.includes("pauseCorrectionConfirmed"));
check("operation card uses current Pause values only after validation", service.includes("pauseCorrectionConfirmed") && service.includes("acceptedVisibleDestination(") && service.includes("acceptedVisibleOrigin("));
check("outbound payload uses current Pause values only after validation", sync.includes("pauseCorrectionConfirmed") && sync.includes('payload.put("origin", canonicalOrigin)') && sync.includes('payload.put("destination", visibleDestination)'));
check("accepted-list destination authority remains available without Pause correction", policy.includes("acceptedListDestination") && policy.includes("pauseCorrectionConfirmed"));
check("release identity is above the previous 1.0.209 baseline", releaseCode >= 220 && releaseName === `1.0.${releaseCode}`);

const tmp = fs.mkdtempSync("/tmp/nvu-hf130-");
try {
  const sources = [
    "android/app/src/main/java/com/nvu/operacional/GtoFreightTextGuard.java",
    "android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java",
    "android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java",
    "android/app/src/main/java/com/nvu/operacional/GtoAcceptedFreightFieldPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoDestinationTextAuthorityPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java",
    "android/app/src/main/java/com/nvu/operacional/GtoPauseCorrectionPolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoHf130PauseSnapshotReconciliationTest.java",
  ];
  const run = spawnSync("java", [
    "scripts/java-tests/JavaTestRunner.java",
    tmp,
    "com.nvu.operacional.GtoHf130PauseSnapshotReconciliationTest",
    ...sources,
  ], { cwd: root, encoding: "utf8" });
  const output = `${run.stdout || ""}\n${run.stderr || ""}`.trim();
  check("HF130 Pause snapshot reconciliation compiles and passes", run.status === 0 && output.includes("HF130 pause snapshot reconciliation behavior passes"), output);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = checks.filter(item => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF130 pause snapshot reconciliation checks passed.`);
if (failed.length) process.exit(1);
