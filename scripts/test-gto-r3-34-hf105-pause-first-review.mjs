import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const service = fs.readFileSync(
  path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java"),
  "utf8"
);
const checks = [];
function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

check(
  "draft inseguro ativa pauseRecoveryOnly",
  service.includes("requiresPauseRecoveryBeforeManualReview(draft)")
    && service.includes("putBoolean(\"pauseRecoveryOnly\", pauseFirstReview)")
);
check(
  "regra considera cargo, origem, destino e rota colapsada",
  service.includes("cargoHasRequiredConsensus(draft)")
    && service.includes("looksLikePlaceName(draft.origin)")
    && service.includes("looksLikePlaceName(draft.destination)")
    && service.includes("routeCollapsed")
);
check(
  "UI não cria input enquanto pauseRecoveryOnly",
  service.includes("if (!pauseRecoveryOnly) {")
    && service.includes("⚠️ Abra o menu do simulador para confirmar os dados do frete.")
);
check(
  "pause elegível para revisão de carga",
  service.includes("return isPauseRecoveryField(prefs.getString(\"reviewRequiredField\", \"\"));")
    && service.includes("GtoFreightReviewPolicy.CARGO.equals(field)")
);
check(
  "fallback manual libera o input somente após falha automática",
  service.includes("putBoolean(\"pauseManualFallbackAllowed\", true)")
    && service.includes("putBoolean(\"pauseRecoveryOnly\", false)")
);
check(
  "transição validada limpa o modo pause-only",
  service.includes("remove(\"pauseRecoveryOnly\")")
);
check(
  "elegibilidade usa origin final, não originCompany",
  service.includes("draft.cargo, draft.origin, draft.destination, draft.km, draft.offeredValue")
);

const failed = checks.filter((ok) => !ok).length;
if (failed) {
  console.error(`\n${failed} HF105 check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} HF105 checks passed.`);
