import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const servicePath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const parserPath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java");
const fixturePath = path.join(root, "scripts/java-tests/com/nvu/operacional/GtoHf167FreightPauseTest.java");

const service = fs.readFileSync(servicePath, "utf8");
const parser = fs.readFileSync(parserPath, "utf8");
const fixture = fs.readFileSync(fixturePath, "utf8");

function check(condition, message) {
  if (!condition) throw new Error(`FAIL ${message}`);
  console.log(`PASS ${message}`);
}

check(parser.includes("static String extractOperationalLocation(String raw)"),
  "parser expõe contrato operacional explícito");
check(parser.includes("return extractBeforeLastSeparator(raw);"),
  "contrato operacional usa o prefixo antes do sufixo regional");
check(service.includes("GtoPauseLocationParser.extractOperationalLocation(cleanOcrLabel(inline))"),
  "Pause usa o contrato operacional na linha com rótulo");
check(service.includes("GtoPauseLocationParser.extractOperationalLocation(cleanOcrLabel(next.text))"),
  "Pause usa o mesmo contrato em linha subsequente");
check(service.includes("replaceAll(\"[^\\\\p{L}\\\\p{N}À-ÿ'&().->›»→➜]+$\", \"\")"),
  "limpeza OCR preserva marcadores de rota no fim da linha");
check(fixture.includes("extractOperationalLocation(originLine)"),
  "fixture cobre origem antes de Área Rural");
check(fixture.includes("extractOperationalLocation(destinationLine)"),
  "fixture cobre destino antes de Área Rural");
check(fixture.includes("resolvePauseCargo(\"Soja\", true, \"Sojo\", 1)"),
  "fixture cobre autoridade literal da carga");

const javaOut = path.join("/tmp", "nvu-hf167-java");
fs.rmSync(javaOut, { recursive: true, force: true });
fs.mkdirSync(javaOut, { recursive: true });
const sources = [
  "GtoPauseLocationParser.java",
  "GtoFreightTextGuard.java",
  "GtoManualRouteSelectionPolicy.java",
  "GtoFreightReviewPolicy.java",
  "GtoMoneyValue.java",
  "GtoAcceptedFreightFieldPolicy.java",
  "GtoDestinationTextAuthorityPolicy.java",
  "GtoCargoAuthorityPolicy.java",
  "GtoCargoConsensusPolicy.java",
  "GtoCityTextResolver.java",
  "GtoHf167FreightPauseTest.java",
].map((name) => path.join(root, "android/app/src/main/java/com/nvu/operacional", name).includes("GtoHf167")
  ? fixturePath
  : path.join(root, "android/app/src/main/java/com/nvu/operacional", name));
try {
  execFileSync("javac", ["-encoding", "UTF-8", "-d", javaOut, ...sources], { stdio: "pipe" });
  const output = execFileSync("java", ["-cp", javaOut, "com.nvu.operacional.GtoHf167FreightPauseTest"], { encoding: "utf8" });
  check(output.includes("GtoHf167FreightPauseTest: PASS"), "fixture Java HF167 passou integralmente");
} finally {
  fs.rmSync(javaOut, { recursive: true, force: true });
}

console.log("HF167 freight/pause structural gate: PASS");
