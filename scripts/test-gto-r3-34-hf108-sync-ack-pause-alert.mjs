import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const servicePath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const service = fs.readFileSync(servicePath, "utf8");
const sync = fs.readFileSync(path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java"), "utf8");
const checks = [];
function check(name, condition) {
  const ok = Boolean(condition);
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

const completionBlockStart = service.indexOf("private void confirmNormalResultAutomatically()");
const completionBlockEnd = service.indexOf('\n    private GtoAutoTripSync.Listener automaticTripSyncListener()', completionBlockStart);
const completionBlock = completionBlockStart >= 0 && completionBlockEnd > completionBlockStart
  ? service.slice(completionBlockStart, completionBlockEnd)
  : "";
check(
  "completion still seals the immutable queue",
  completionBlock.includes("enqueueConfirmedTrip(this, prefs, automaticTripSyncListener())")
);
check(
  "completion does not prepare next freight before ACK",
  !completionBlock.includes("prepareNextFreightFromSealedQueue(completedSessionId)")
);
check(
  "local seal message does not claim registration",
  (completionBlock.toLowerCase().includes("aguardando confirmação do sistema")
    || completionBlock.includes("Registrando viagem…"))
    && !completionBlock.includes("Próximo frete liberado")
    && !completionBlock.toLowerCase().includes("viagem registrada com sucesso")
);
check(
  "sealed queue next-freight gate requires STATUS_SYNCED",
  service.includes('if (!GtoAutoTripSync.STATUS_SYNCED.equals(prefs.getString("gtoTripSyncStatus", ""))) return false;')
);
const syncedCallbackStart = service.indexOf("public void onSynced(String sessionId, String tripId)");
const syncedCallback = syncedCallbackStart >= 0 ? service.slice(syncedCallbackStart, syncedCallbackStart + 3600) : "";
check(
  "next freight remains an ACK callback responsibility",
  syncedCallback.includes("STATUS_SYNCED") && syncedCallback.includes("beginTrip(false, false)")
);
const pausePrompt = service.slice(service.indexOf("private void maybeAnnouncePausePrompt"), service.indexOf("private void clearPauseReadState"));
check(
  "pause prompt is sticky",
  pausePrompt.includes('"PAUSE_ACTION_REQUIRED"') && pausePrompt.includes("0L")
);
check(
  "pause prompt remains visible after covered-frame discard",
  service.includes("hidePauseBlockingOverlaysKeepPrompt();")
    && service.includes("PAUSE_* status chip is the driver's durable instruction")
    && !service.includes("mainHandler.postDelayed(this::restorePausePromptAfterCleanFrame, 180L)")
    && service.includes("restorePausePromptAfterCleanFrame")
);
check(
  "unrelated stages cannot replace active pause instruction",
  service.includes("pauseInstructionActive")
    && service.includes("if (pauseInstructionActive && !pauseConfirmed && !pauseStage) return;")
);
check(
  "backend ACK still requires exact session and tripId",
  sync.includes("!sessionId.equals(responseSession)")
    && sync.includes("tripId.isEmpty()")
    && sync.includes("responseContract < CONTRACT_VERSION")
);

const failed = checks.filter((ok) => !ok).length;
if (failed) {
  console.error(`\n${failed} HF108 check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} HF108 checks passed.`);
