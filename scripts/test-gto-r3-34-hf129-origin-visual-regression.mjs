import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoAcceptedFreightFieldPolicy.java");
const gradle = read("android/app/build.gradle");
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

check(
  "accepted origin authority is explicit and Pause-aware",
  policy.includes("acceptedVisibleOrigin(")
    && policy.includes("if (!accepted.isEmpty()) return accepted;")
    && policy.includes("if (pauseMenuEvidence) return current;")
);
check(
  "list parser promotes route origin to operational and accepted fields",
  service.includes("option.acceptedListOrigin = origin;")
    && service.includes("option.origin = origin;")
    && service.includes("canonicalizeAcceptedListOrigin(option);")
);
check(
  "focused retry no longer clears accepted-list origin",
  service.includes("retry.acceptedListOrigin = origin.value;")
    && service.includes("retry.origin = origin.value;")
    && !service.includes("retry.origin = \"\";\n            retry.originCompanySelectedRowEvidence")
);
check(
  "post-retry resolution updates origin and originCompany together",
  service.includes("target.originCompany = value;")
    && service.includes("target.acceptedListOrigin = value;")
    && service.includes("target.originCompanyEvidenceSource = resolution.source;")
);
check(
  "summary and current-freight card use accepted origin authority",
  service.includes("String acceptedListOrigin = canonicalFreight == null")
    && service.includes("GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(")
    && service.includes("String visibleOrigin = GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(")
);
check(
  "accepted origin survives copy, JSON, prefs and Pause reread",
  service.includes("dst.acceptedListOrigin = src.acceptedListOrigin;")
    && service.includes('json.put("acceptedListOrigin", option.acceptedListOrigin)')
    && (service.includes('putString("selectedAcceptedListOrigin", selected.acceptedListOrigin)')
      || service.includes('putString("selectedAcceptedListOrigin", certified.optString("acceptedListOrigin"'))
    && (service.includes("freight.acceptedListOrigin = current.acceptedListOrigin;")
      || sync.includes("GtoCertifiedFreight.copyIntoSnapshot(snapshot, candidate)")
      || sync.includes("GtoCertifiedFreight.copyIntoPayload(payload, certifiedFreight)"))
);
check(
  "restore and payload preserve accepted origin without replacing Pause origin",
  sync.includes("acceptedListOrigin")
    && sync.includes("GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(")
    && sync.includes("snapshot.optBoolean(\"pauseMenuEvidence\", false)")
    && sync.includes('payload.put("origin", canonicalOrigin)')
);
check(
  "HF133 compact translucent card visual is explicit",
  service.includes("final int buttonWidth = dp(68)")
    && service.includes("final int buttonHeight = dp(32)")
    && service.includes("makeNvuBubbleBackground(false)")
    && service.includes("menuView.setBackground(makeRoundedBackground(Color.argb(214, 28, 31, 36), dp(14)))")
    && service.includes("menuView.setPadding(dp(8), dp(8), dp(8), dp(8))")
    && service.includes("button.setMinHeight(0)")
    && service.includes("button.setMinWidth(0)")
    && service.includes("dp(34)")
    && service.includes("Color.argb(176, 62, 69, 79)")
);
check(
  "current destination authority remains present",
  service.includes("acceptedListDestination")
    && sync.includes("acceptedListDestination")
    && policy.includes("acceptedVisibleDestination")
);
check(
  "release identity remains above 1.0.207",
  /versionCode\s+(?:20[8-9]|2[1-9]\d|[3-9]\d{2,})/.test(gradle)
);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf129-"));
const sources = [
  "android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java",
  "android/app/src/main/java/com/nvu/operacional/GtoAcceptedFreightFieldPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoDestinationTextAuthorityPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightTextGuard.java",
  "android/app/src/main/java/com/nvu/operacional/GtoManualRouteSelectionPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightReviewPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightFieldEvidencePolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoCargoConsensusPolicy.java",
  "scripts/java-tests/com/nvu/operacional/GtoHf129OriginAndCompactVisualTest.java",
].map(relative => path.join(root, relative));
let result = spawnSync("javac", ["-encoding", "UTF-8", "-d", temp, ...sources], { encoding: "utf8" });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
check("HF129 origin policy compiles", result.status === 0);
if (result.status === 0) {
  result = spawnSync("java", ["-cp", temp, "com.nvu.operacional.GtoHf129OriginAndCompactVisualTest"], { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  check("HF129 origin policy behavior passes", result.status === 0);
}
fs.rmSync(temp, { recursive: true, force: true });

const failed = checks.filter(item => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF129 origin/visual checks passed.`);
if (failed.length) process.exit(1);
