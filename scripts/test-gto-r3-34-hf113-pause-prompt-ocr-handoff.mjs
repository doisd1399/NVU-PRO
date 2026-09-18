import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const servicePath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const parserPath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java");
const policyPath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoPauseScreenDetectionPolicy.java");
const service = fs.readFileSync(servicePath, "utf8");
const parser = fs.readFileSync(parserPath, "utf8");
const policy = fs.readFileSync(policyPath, "utf8");
const checks = [];
function check(name, condition) {
  const ok = Boolean(condition);
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

const ocrStart = service.indexOf("private void schedulePauseScreenOcrIfDue");
const ocrEnd = service.indexOf("private FreightOption readPauseFreight", ocrStart);
const ocr = ocrStart >= 0 && ocrEnd > ocrStart ? service.slice(ocrStart, ocrEnd) : "";
const handoffStart = ocr.indexOf("boolean hadNvuBlockingOverlay");
const handoffEnd = ocr.indexOf("Bitmap source", handoffStart);
const handoff = handoffStart >= 0 && handoffEnd > handoffStart ? ocr.slice(handoffStart, handoffEnd) : "";
const blockingStart = service.indexOf("private void hidePauseBlockingOverlaysKeepPrompt");
const blockingEnd = service.indexOf("private void hideTransientOverlaysKeepBubble", blockingStart);
const blocking = blockingStart >= 0 && blockingEnd > blockingStart ? service.slice(blockingStart, blockingEnd) : "";

check(
  "pause OCR treats only the NVU menu as a blocking overlay",
  ocr.includes("boolean hadNvuBlockingOverlay = menuView != null;")
    && !ocr.includes("menuView != null || statusChipView != null")
);
check(
  "blocking handoff preserves the stable driver prompt",
  ocr.includes("hidePauseBlockingOverlaysKeepPrompt();")
    && !blocking.includes("hideStatusChip()")
    && !blocking.includes("hideStatusChipViewOnly()")
);
check(
  "covered frame is discarded without scheduling prompt removal/restoration",
  (handoff.includes("lastPauseOcrAt = 0L;") || handoff.includes("lastPauseOcrAt = now;"))
    && handoff.includes("if (hadNvuBlockingOverlay)")
    && !handoff.includes("restorePausePromptAfterCleanFrame")
);
check(
  "exact screenshot route lines require final separator parsing",
  parser.includes("if (c == '-' || c == '\\u2013' || c == '\\u2014')")
    && parser.includes("return local;")
    && service.includes("pauseLocationTextField(lines, \"origem\"")
    && service.includes("pauseLocationTextField(lines, \"destino\"")
);

function extractAfterLastSeparator(value) {
  const normalized = value.replace(/\\s+/g, " ").trim();
  const index = Math.max(normalized.lastIndexOf("-"), normalized.lastIndexOf("–"), normalized.lastIndexOf("—"));
  if (index <= 0 || index >= normalized.length - 1) return "";
  const company = normalized.slice(0, index).trim();
  const local = normalized.slice(index + 1).trim();
  return company.length >= 2 && local.length >= 2 ? local : "";
}
const screenshotLines = [
  "Carga: Bebidas",
  "Origem: Cooper Log – Cruz do Oeste",
  "Destino: Supermercado Santo Antonio – Nova Macaé"
];
const originLine = screenshotLines.find((line) => line.toLowerCase().startsWith("origem:"));
const destinationLine = screenshotLines.find((line) => line.toLowerCase().startsWith("destino:"));
check("screenshot origin resolves to Cruz do Oeste", extractAfterLastSeparator(originLine.split(":").slice(1).join(":").trim()) === "Cruz do Oeste");
check("screenshot destination resolves to Nova Macaé", extractAfterLastSeparator(destinationLine.split(":").slice(1).join(":").trim()) === "Nova Macaé");
check("screenshot cargo resolves to Bebidas", screenshotLines[0].split(":").slice(1).join(":").trim() === "Bebidas");
check(
  "field anchor still admits the detailed pause page",
  policy.includes("static boolean hasFreightFieldAnchor(List<String> lines)")
    && service.includes("boolean pauseSurface = pause || freightFieldAnchor;")
);
check(
  "successful pause read still requires complete fields and real lock",
  service.includes("if (freight == null)")
    && service.includes("GtoAutoTripSync.lockSelectedFreight(this, prefs)")
    && service.includes("transitionConfirmedFreightToTripInProgress();")
);

const failed = checks.filter((ok) => !ok).length;
if (failed) {
  console.error(`\n${failed} HF113 check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} HF113 checks passed.`);
