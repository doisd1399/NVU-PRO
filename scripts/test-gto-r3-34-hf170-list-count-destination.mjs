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

check(
  service.includes('return "Lista de fretes detectada ✓ · " + freightOptionCountLabel(rowCount) + ".";'),
  "mensagem canônica inclui sempre a contagem pluralizada"
);
check(
  service.includes('putInt("freightVisualCount", safeCount)')
    && service.includes('putInt("driverStageFreightCount", safeCount)')
    && service.includes('freightListDetectedMessage(safeCount)'),
  "reabertura informa contador visual e mensagem pela mesma contagem"
);
check(
  service.includes("publishActiveTripFreightListInfo")
    && service.includes('FREIGHT_LIST_REOPENED_INFORMATIONAL')
    && service.includes("Lista de fretes reaberta durante viagem"),
  "Lista ativa atualiza informação sem apagar a sessão da viagem"
);
check(
  accepted.includes("acceptedVisibleDestination")
    && accepted.includes("pauseCorrectionConfirmed")
    && accepted.includes("destinationCompanyFromRoute"),
  "autoridade distingue Lista completa, rota same-row e correção confirmada do Pause"
);
check(
  accepted.includes("collapseLeadingDestinationCompany")
    && accepted.includes("hasExactOfficialLocalitySuffix"),
  "prefixo OCR divergente só é descartado diante de localidade oficial"
);
check(
  certified.includes("GtoAcceptedFreightFieldPolicy.destination")
    && certified.includes('sealed.put("acceptedListDestination", acceptedDestination)'),
  "CertifiedFreight sela a rota canônica antes do snapshot"
);
check(
  sync.includes("restoreLockedFreightToPrefs")
    && sync.includes("GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination")
    && sync.includes("GtoCertifiedFreight.copyIntoPayload"),
  "restore e payload consomem a autoridade durável sem recomputação paralela"
);

const out = "/tmp/nvu-hf170-java";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const productionDir = path.join(root, "android/app/src/main/java/com/nvu/operacional");
const fixturePath = path.join(root, "scripts/java-tests/com/nvu/operacional/GtoHf170DestinationAuthorityTest.java");
const sources = [
  "GtoFreightTextGuard.java",
  "GtoCityTextResolver.java",
  "GtoAcceptedFreightFieldPolicy.java",
  "GtoDestinationTextAuthorityPolicy.java",
].map((name) => path.join(productionDir, name)).concat(fixturePath);
try {
  execFileSync("javac", ["-encoding", "UTF-8", "-d", out, ...sources], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  const run = execFileSync("java", ["-cp", out, "com.nvu.operacional.GtoHf170DestinationAuthorityTest"], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  check(run.includes("GtoHf170DestinationAuthorityTest: PASS"),
    "fixture Java HF170 de autoridade do destino passou");
} catch (error) {
  check(false, `fixture Java HF170 compilou/executou: ${error?.stdout || error?.stderr || error}`);
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}

const passed = checks.filter(Boolean).length;
console.log(`${passed}/${checks.length} HF170 list/count/destination checks passed.`);
if (passed !== checks.length) process.exit(1);
