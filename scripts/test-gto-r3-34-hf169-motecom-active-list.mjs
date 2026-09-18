import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const accepted = read("android/app/src/main/java/com/nvu/operacional/GtoAcceptedFreightFieldPolicy.java");
const flow = read("android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java");
const semantic = read("android/app/src/main/java/com/nvu/operacional/GtoFreightSemanticCertificationPolicy.java");
const checks = [];
const check = (condition, message) => {
  const ok = Boolean(condition);
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${message}`);
};

check(accepted.includes("collapseLeadingDestinationCompany")
  && accepted.includes("hasExactOfficialLocalitySuffix(candidate)"),
  "destino completo colapsa prefixo OCR divergente apenas com localidade oficial");
check(accepted.includes("if (hasExactOfficialLocalitySuffix(current)")
  && accepted.includes("return current;"),
  "destino localidade-only não recebe prefixo OCR sem evidência segura");
check(service.includes("selectedRowCanCertifyAfterHumanTouch")
  && service.includes("TOUCH_LOCKED")
  && service.includes("hasConfirmedSelectionIdentity()"),
  "row tocado usa certificação pós-toque sem exigir OCR do texto Aceitar");
check(semantic.includes("selectedRowCanCertifyAfterHumanTouch")
  && semantic.includes("contextual >= 1"),
  "certificação pós-toque mantém geometria, valor e contexto mínimo");
check(flow.includes("freightListIsInformationalOnly(String state, boolean exactAcceptTouchConfirmed)")
  && flow.includes("return \"TRIP_IN_PROGRESS\".equals(state) && !exactAcceptTouchConfirmed;"),
  "Lista durante viagem ativa é informativa sem toque de Aceitar");
check(service.includes("publishActiveTripFreightListInfo")
  && service.includes("FREIGHT_LIST_REOPENED_INFORMATIONAL")
  && service.includes("Lista de fretes reaberta durante viagem"),
  "reabertura publica mensagem/contador normal sem limpar a viagem");
check(service.includes("boolean exactAcceptTouchConfirmed = replacementFreightPressedRow >= 0;")
  && !service.includes("boolean touchBoundary = replacementFreightTouchPending || replacementFreightPressedRow >= 0;"),
  "replacement não é promovido apenas por flag pendente sem botão Aceitar confirmado");
check(service.includes("putInt(\"freightVisualCount\", safeCount)")
  && service.includes("freightListDetectedMessage(safeCount)"),
  "contador e mensagem usam a mesma contagem visual normalizada");

const out = "/tmp/nvu-hf169-java";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const productionDir = path.join(root, "android/app/src/main/java/com/nvu/operacional");
const fixturePath = path.join(root, "scripts/java-tests/com/nvu/operacional/GtoHf169MotecomActiveListTest.java");
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
  const run = execFileSync("java", ["-cp", out, "com.nvu.operacional.GtoHf169MotecomActiveListTest"], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  check(run.includes("GtoHf169MotecomActiveListTest: PASS"),
    "fixture Java HF169 de Motecom/reabertura ativa passou");
} catch (error) {
  check(false, `fixture Java HF169 compilou/executou: ${error?.stdout || error?.stderr || error}`);
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}

const passed = checks.filter(Boolean).length;
console.log(`${passed}/${checks.length} HF169 Motecom/active-list checks passed.`);
if (passed !== checks.length) process.exit(1);
