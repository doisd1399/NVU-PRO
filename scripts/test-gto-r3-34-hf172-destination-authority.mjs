import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const accepted = read("android/app/src/main/java/com/nvu/operacional/GtoAcceptedFreightFieldPolicy.java");
const certified = read("android/app/src/main/java/com/nvu/operacional/GtoCertifiedFreight.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const checks = [];
const check = (condition, message) => {
  const ok = Boolean(condition);
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${message}`);
};

check(accepted.includes("GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(currentDestination)"),
  "composição do destino começa pela autoridade canônica fechada");
check(accepted.includes("GtoDestinationTextAuthorityPolicy.canonicalizeListCompany(destinationCompany)"),
  "empresa de destino é canonicalizada antes de qualquer prefixo");
check(accepted.includes("GtoDestinationTextAuthorityPolicy.sameAcceptedListDestination"),
  "comparação de leituras aceita somente alias fechado e formato wrapped da mesma linha");
check(service.includes("canonicalizeListDestinationFields(canonical)")
  && service.includes("canonicalizeListDestinationFields(stable)"),
  "fusão precise/snapshot sanitiza as duas fontes antes de resolver conflitos");
check(service.includes("canonicalizeListDestinationFields(frozen)")
  && service.includes("DIRECT_FROZEN_BASELINE"),
  "OCR vazia pode promover apenas o snapshot completo da própria linha tocada");
check(service.includes("json.put(\"destination\", GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(option.destination))"),
  "serialização do frete bloqueia alias antes do payload");
check(certified.includes("repairCanonicalDestination(value, sessionId)")
  && (certified.includes("applyToPrefs(prefs.edit(), value).commit()")
    || (certified.includes("SharedPreferences.Editor editor = prefs.edit()")
      && certified.includes("applyToPrefs(editor, value)")
      && certified.includes("editor.commit()"))),
  "snapshot antigo é migrado antes de voltar ao card/registro");
check(sync.includes("GtoDestinationTextAuthorityPolicy.canonicalizeListCompany")
  && sync.includes("GtoDestinationTextAuthorityPolicy.canonicalizeListDestination"),
  "restauração AutoTripSync mantém a mesma autoridade");

const out = "/tmp/nvu-hf172-java";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const productionDir = path.join(root, "android/app/src/main/java/com/nvu/operacional");
const fixturePath = path.join(root, "scripts/java-tests/com/nvu/operacional/GtoHf172DestinationAuthorityTest.java");
const sources = [
  "GtoManualRouteSelectionPolicy.java",
  "GtoFreightReviewPolicy.java",
  "GtoFreightTextGuard.java",
  "GtoMoneyValue.java",
  "GtoCityTextResolver.java",
  "GtoAcceptedFreightFieldPolicy.java",
  "GtoDestinationTextAuthorityPolicy.java",
  "GtoDeterministicFlowPolicy.java",
].map((name) => path.join(productionDir, name)).concat(fixturePath);
try {
  execFileSync("javac", ["-encoding", "UTF-8", "-d", out, ...sources], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  const run = execFileSync("java", ["-cp", out, "com.nvu.operacional.GtoHf172DestinationAuthorityTest"], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  check(run.includes("GtoHf172DestinationAuthorityTest: PASS"),
    "fixture Java HF172 de autoridade do destino passou");
} catch (error) {
  check(false, `fixture Java HF172 compilou/executou: ${error?.stdout || error?.stderr || error}`);
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}

const passed = checks.filter(Boolean).length;
console.log(`${passed}/${checks.length} HF172 destination-authority checks passed.`);
if (passed !== checks.length) process.exit(1);
