import fs from "node:fs";
import crypto from "node:crypto";

const read = (p) => fs.readFileSync(p, "utf8");
const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const pkg = JSON.parse(read("package.json"));
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const functionsSource = read("functions/src/gtoTrips.ts");
const functionsCompiled = read("functions/lib/gtoTrips.js");

const checks = [];
const ck = (name, ok) => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};

const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
const versionTail = Number((versionName.match(/^1\.0\.(\d+)$/) || [])[1] || 0);
ck("HF59+ Android identity", versionCode >= 111 && versionTail >= 111);
ck("HF59+ workflow identity follows Android source", workflow.includes(`EXPECTED_VERSION_CODE: "${versionCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${versionName}"`));
const artifactHotfix = Number((workflow.match(/NVU-R3\.34-PC-HF(\d+)-release\.apk/) || [])[1] || 0);
ck("HF59+ release artifact identity", artifactHotfix >= 59);
ck("HF59 release gate is mandatory", String(pkg.scripts?.["verify:release"] || "").includes("npm run test:gto-r3.34-hf59-sync-safe"));

// HF149 intentionally changes the register contract. Source and compiled Functions
// must carry the same canonical Origin rule; gtoState remains hash-pinned because it is
// unrelated to the freight-authority change.
ck("HF149 registerGtoTrip source and compiled Function use certified Origin", functionsSource.includes("const effectiveOrigin = origin;") && functionsSource.includes("GTO_CERTIFIED_ORIGIN") && functionsCompiled.includes("const effectiveOrigin = origin;") && functionsCompiled.includes("GTO_CERTIFIED_ORIGIN"));
ck("HF58 syncGtoTripState server source preserved byte-for-byte", sha256("functions/src/gtoState.ts") === "f15301283ea37774deef756498a655a0018be17474254dcfc09485efdcfbc836");

ck("registerGtoTrip queue keeps durable seal before network flush", sync.includes("putString(QUEUE_PREFIX + sessionId, sealed).commit()") && sync.indexOf("putString(QUEUE_PREFIX + sessionId, sealed).commit()") < sync.indexOf("flushPending(context, mainPrefs, listener)"));
ck("permanent callable failures pause timed retries", sync.includes("shouldPauseAutomaticRetry") && sync.includes("FirebaseFunctionsException.Code.INVALID_ARGUMENT") && sync.includes("FirebaseFunctionsException.Code.FAILED_PRECONDITION") && sync.includes("FirebaseFunctionsException.Code.PERMISSION_DENIED") && sync.includes("FirebaseFunctionsException.Code.UNAUTHENTICATED") && sync.includes("Long.MAX_VALUE") && sync.includes("RETRY_BLOCK_CODE_PREFIX"));
ck("transient registerGtoTrip retry remains capped exponential", sync.includes("BASE_RETRY_MS = 15_000L") && sync.includes("MAX_RETRY_MS = 5 * 60_000L") && sync.includes("Math.min(MAX_RETRY_MS, BASE_RETRY_MS * (1L << Math.min(attempt - 1, 4)))"));
ck("missing native auth retries locally without callable storm", sync.includes('pauseRetryForReason(retry, queuedSessionId, "NO_NATIVE_AUTH")') && sync.includes("scheduleRetryWhileAuthUnavailable") && sync.includes("GtoFirebaseRuntime.currentUser(context)"));
ck("repeated no-auth polls remain locally bounded",
  sync.includes("boolean pauseChanged = pauseRetryForReason")
  && sync.includes("Sessão NVU indisponível")
  && sync.includes("scheduleRetryWhileAuthUnavailable")
  && sync.includes("if (currentUser == null)")
  && sync.includes('if (!anyRetryScheduled && !currentSessionQueued) return;'));
ck("driver mismatch pauses locally", sync.includes('pauseRetryForReason(retry, sessionId, "DRIVER_UID_MISMATCH")'));
ck("backend contract mismatch pauses instead of looping", sync.includes('pauseRetryForReason(retry, sessionId, "BACKEND_CONTRACT_MISMATCH")'));
ck("auth-paused queue gets only one process recovery release per reason", sync.includes("AUTH_RECOVERY_RELEASED") && sync.includes("AUTH_RECOVERY_RELEASED.add(sessionId + \":\" + blockedCode)"));
ck("auth/profile recovery can resume inside the running process", sync.includes("authRelatedPause") && sync.includes("currentUid.equals(recoveryDriverId)") && sync.includes("AUTH_RECOVERY_RELEASED.add(recoveryKey)"));
ck("queue recovery schema upgraded for HF59", sync.includes('putInt("gtoQueueRecoverySchema", 2)'));

ck("completion-to-queue watchdog has bounded local backoff", service.includes("COMPLETION_QUEUE_SEAL_RETRY_BASE_MS = 1_200L") && service.includes("COMPLETION_QUEUE_SEAL_RETRY_MAX_MS = 60_000L") && service.includes("COMPLETION_QUEUE_SEAL_RETRY_EXPONENT_CAP = 5"));
ck("foreground observer continuously self-heals unsealed completion", service.includes("recoverUnsealedCompletedTripIfNeeded(now);") && service.indexOf("recoverUnsealedCompletedTripIfNeeded(now);") < service.indexOf("recoverSealedCompletionToWaitingIfNeeded();"));
ck("failed immediate completion seal arms recovery", service.includes("armCompletionQueueSealRecovery(completedSessionId, System.currentTimeMillis())"));
ck("watchdog retries durable enqueue and retains proof until server ACK",
  service.includes("boolean queued = GtoTripSubmissionCoordinator.submitCompletedTrip(this, prefs, automaticTripSyncListener());")
  && service.includes("if (queued) {\n            markResultProofSealedPendingServerAck(sessionId);")
  && service.includes("finalizeResultProofAfterServerAck(sessionId)"));
ck("watchdog itself contains no direct Firebase callable", (() => {
  const a = service.indexOf("private void recoverUnsealedCompletedTripIfNeeded");
  const b = service.indexOf("private boolean recoverSealedCompletionToWaitingIfNeeded", a);
  const body = a >= 0 && b > a ? service.slice(a, b) : "";
  return body.includes("submitCompletedTrip")
    && !body.includes("getHttpsCallable")
    && !body.includes("FirebaseFunctions");
})());
ck("completed but unsealed UI is explicit",
  service.includes('"QUEUE_SEAL_PENDING"')
  && service.includes("protegendo o registro local")
  && service.includes("aguardando selar a fila de envio"));
ck("paused sync UI is explicit",
  service.includes('"SYNC_PENDING"')
  && service.includes("Envio pausado; a viagem continua protegida."));
ck("driver receives protected-sync message instead of oscillating status",
  service.includes("gtoTripSyncRetryPaused")
  && service.includes("Envio pausado; a viagem continua protegida.")
  && service.includes("Envio pendente; nova tentativa automática."));
ck("result proof escrow remains preserved while queue seal is pending", service.includes('putString("gtoTripIntegrityStatus", "RESULT_PROOF_ESCROWED_PENDING_QUEUE")'));

// Critical HF57/HF58 behavior must remain untouched by the synchronization hotfix.
ck("HF57 instant detection feedback preserved", service.includes("FAST_FREIGHT_MESSAGE_CONFIRM_FRAMES = 2") && service.includes('announceDriverStage("FREIGHT_LIST_VISUAL_PENDING"'));
ck("HF57 corrected option pluralization preserved", service.includes('safeCount == 1 ? " opção" : " opções"') && !service.includes("opçãoões"));
ck("ML Kit remains local OCR path", service.includes("TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)"));
ck("HF58 canonical cost backoff preserved", service.includes("CANONICAL_SYNC_BASE_RETRY_MS = 15_000L") && service.includes("CANONICAL_SYNC_MAX_RETRY_MS = 5L * 60_000L") && service.includes("isPermanentCanonicalSyncFailure"));

const failed = checks.filter((x) => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF59 Sync Safe checks passed.`);
if (failed.length) process.exit(1);
