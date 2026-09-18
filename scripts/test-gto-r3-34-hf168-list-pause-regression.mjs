import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const certified = read("android/app/src/main/java/com/nvu/operacional/GtoCertifiedFreight.java");
const accepted = read("android/app/src/main/java/com/nvu/operacional/GtoAcceptedFreightFieldPolicy.java");
const parser = read("android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java");
const fixturePath = path.join(root, "scripts/java-tests/com/nvu/operacional/GtoHf168ListPauseRegressionTest.java");
const checks = [];
const check = (condition, message) => {
  const ok = Boolean(condition);
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${message}`);
};

check(service.includes("GtoAcceptedFreightFieldPolicy.destination(\n                option.destination,\n                option.destinationCompany,\n                option.rawText"),
  "canonização same-row recompõe destino embrulhado uma única vez");
check(service.includes("GtoAcceptedFreightFieldPolicy.destination(\n                destination,\n                option.destinationCompany,\n                option.rawText"),
  "sincronização same-row não rebaixa destino completo para localidade");
check(certified.includes("GtoAcceptedFreightFieldPolicy.destination(\n                        destination, destinationCompany, rawText"),
  "selagem certificada recompõe destino antes do snapshot");
check(!service.includes("Preserve its literal complete value;\n            // destinationCompany is metadata and must not prepend/recompose it."),
  "contrato antigo que congelava localidade isolada foi removido");
check(service.includes("private String pauseLocationTextField(List<OcrLine> lines, String... labels)")
  && service.includes("GtoPauseLocationParser.extractAfterLastSeparator"),
  "Pause usa pauseLocationTextField exclusivamente para a localidade após o separador");
check(service.includes("String pauseOriginCompany = pauseCompanyTextField(lines, \"origem\", \"empresa de origem\");")
  && service.includes("String pauseDestinationCompany = pauseCompanyTextField("),
  "Pause coleta empresa/prefixo separadamente da localidade");
check(service.includes("String trustedListDestination = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination("),
  "Pause preserva autoridade completa da Lista quando já disponível");
check(service.includes("String pauseDestination = GtoAcceptedFreightFieldPolicy.destination("),
  "Pause recompõe empresa e localidade quando a Lista não possui o campo");
check(!service.includes("freight.destination = pauseLocationTextField(lines, \"destino\""),
  "Pause não usa mais prefixo da rota como destino operacional isolado");
check(parser.includes("extractAfterLastSeparator"),
  "localidade pós-separador permanece disponível como evidência auxiliar");
check(accepted.includes("Motecom Matecom Itapetuna") || accepted.includes("stale"),
  "policy mantém proteção contra duplicidade de empresa stale");

const out = "/tmp/nvu-hf168-java";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const productionDir = path.join(root, "android/app/src/main/java/com/nvu/operacional");
const sources = [
  "GtoPauseLocationParser.java",
  "GtoFreightTextGuard.java",
  "GtoManualRouteSelectionPolicy.java",
  "GtoFreightReviewPolicy.java",
  "GtoMoneyValue.java",
  "GtoCityTextResolver.java",
  "GtoAcceptedFreightFieldPolicy.java",
  "GtoDestinationTextAuthorityPolicy.java",
].map((name) => path.join(productionDir, name)).concat(fixturePath);
try {
  const compile = execFileSync("javac", ["-encoding", "UTF-8", "-d", out, ...sources], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  const run = execFileSync("java", ["-cp", out, "com.nvu.operacional.GtoHf168ListPauseRegressionTest"], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  check(run.includes("GtoHf168ListPauseRegressionTest: PASS"),
    "fixture Java HF168 de Lista/Pause passou");
} catch (error) {
  check(false, `fixture Java HF168 compilou/executou: ${error?.stdout || error?.stderr || error}`);
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}

const passed = checks.filter(Boolean).length;
console.log(`${passed}/${checks.length} HF168 list/pause regression checks passed.`);
if (passed !== checks.length) process.exit(1);
