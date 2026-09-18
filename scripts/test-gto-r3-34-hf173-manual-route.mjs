import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const javaRoot = join(root, "android/app/src/main/java/com/nvu/operacional");
const fixture = join(root, "scripts/java-tests/com/nvu/operacional/GtoManualRouteSelectionPolicyTest.java");
const temp = mkdtempSync(join(tmpdir(), "nvu-hf173-"));
const service = readFileSync(join(javaRoot, "GtoObserverService.java"), "utf8");
const sync = readFileSync(join(javaRoot, "GtoAutoTripSync.java"), "utf8");
const certified = readFileSync(join(javaRoot, "GtoCertifiedFreight.java"), "utf8");
const functions = readFileSync(join(root, "functions/src/gtoTrips.ts"), "utf8");
try {
  execFileSync("javac", ["-d", temp, join(javaRoot, "GtoManualRouteSelectionPolicy.java"), fixture], { stdio: "inherit" });
  execFileSync("java", ["-cp", temp, "com.nvu.operacional.GtoManualRouteSelectionPolicyTest"], { stdio: "inherit" });

  const required = [
    [service, "runNumericSelectedRowOcr", "seleção numérica focalizada ausente"],
    [service, "addManualRouteSelector", "seletor manual ausente"],
    [service, "MANUAL_ROUTE_ORIGIN", "etapa de origem manual ausente"],
    [service, "MANUAL_ROUTE_DESTINATION", "etapa de destino manual ausente"],
    [service, "manualRouteSelectionConfirmed", "marcador de rota manual ausente"],
    [sync, "manualRouteSelectionConfirmed", "snapshot não propaga rota manual"],
    [certified, "manualRouteSelectionConfirmed", "payload certificado não propaga rota manual"],
    [functions, 'if (cargo) assertBoundedText(cargo, "cargo");', "backend ainda exige Carga"],
  ];
  for (const [text, marker, message] of required) {
    if (!text.includes(marker)) throw new Error(`HF173: ${message}`);
  }
  if (/runFocusedCargoOnlyRecovery\(/.test(service.slice(service.indexOf("private void runPreciseSelectedRowOcr(FreightSelectionTransaction")))) {
    const entry = service.slice(service.indexOf("private void runPreciseSelectedRowOcr(FreightSelectionTransaction"), service.indexOf("private void runPreciseSelectedRowOcr(FreightSelectionTransaction") + 1800);
    if (!entry.includes("runNumericSelectedRowOcr(transaction)")) throw new Error("HF173: entrada não prioriza leitura numérica");
  }
  console.log("GtoManualRouteHF173Gate: PASS");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
