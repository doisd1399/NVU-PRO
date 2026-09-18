import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const metadata = JSON.parse(read("metadata.json"));
const envExample = fs.existsSync(".env.example") ? read(".env.example") : "";
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const stateFn = read("functions/src/gtoState.ts");
const tripsFn = read("functions/src/gtoTrips.ts");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");

const checks = [];
const ck = (name, ok) => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};

const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
const versionTail = Number((versionName.match(/^1\.0\.(\d+)$/) || [])[1] || 0);
const artifactHotfix = Number((workflow.match(/NVU-R3\.34-PC-HF(\d+)-release\.apk/) || [])[1] || 0);
ck("HF58+ Android identity", versionCode >= 110 && versionTail >= 110);
ck("HF58+ workflow identity follows Android source", workflow.includes(`EXPECTED_VERSION_CODE: "${versionCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${versionName}"`));
ck("HF58+ release artifact identity", artifactHotfix >= 58 && !workflow.includes("NVU-R3.34-PC-HF57-release.apk"));
ck("HF58 release gate runs Firebase cost audit", String(pkg.scripts?.["verify:release"] || "").includes("npm run audit:firebase-costs"));

ck("unused Google GenAI dependency removed", !pkg.dependencies?.["@google/genai"] && !lock.packages?.["node_modules/@google/genai"]);
ck("metadata no longer advertises Gemini capability", !JSON.stringify(metadata).includes("GEMINI") && Array.isArray(metadata.majorCapabilities) && metadata.majorCapabilities.length === 0);
ck("env example contains no Gemini key wiring", !/GEMINI_API_KEY/i.test(envExample));

ck("canonical state has local native-auth gate", sync.includes("Autenticação NVU ausente para sincronizar estado GTO") && sync.includes("GtoFirebaseRuntime.currentUser(context)"));
ck("canonical retry uses bounded exponential backoff", service.includes("CANONICAL_SYNC_BASE_RETRY_MS = 15_000L") && service.includes("CANONICAL_SYNC_MAX_RETRY_MS = 5L * 60_000L") && service.includes("CANONICAL_SYNC_EXPONENT_CAP = 4"));
ck("old five-second infinite canonical retry is absent", !service.includes("mainHandler.postDelayed(this::retryCanonicalStateSync, 5000L)") && !service.includes("mainHandler.postDelayed(() -> retryCanonicalStateSync(), 2500L)"));
ck("permanent callable failures are blocked from retry storm", service.includes("isPermanentCanonicalSyncFailure") && service.includes("gtoCanonicalStateRetryBlocked") && service.includes("FirebaseFunctionsException.Code.PERMISSION_DENIED") && service.includes("FirebaseFunctionsException.Code.UNAUTHENTICATED"));
ck("stale scheduled canonical retries are generation isolated", service.includes("canonicalSyncGeneration") && service.includes("canonicalSyncAttemptIsCurrent"));

const duplicateIndex = stateFn.indexOf("currentSnap.exists && currentState === state");
const expectedIndex = stateFn.indexOf("expectedState && expectedState !== currentState");
ck("server canonical state retry is idempotent before expected-state conflict", duplicateIndex >= 0 && expectedIndex > duplicateIndex && stateFn.includes("duplicate: true"));

ck("GTO progress has one-time canonical migration marker", tripsFn.includes("GTO_PROGRESS_SCHEMA_VERSION = 1") && tripsFn.includes("gtoProgressSchemaVersion: GTO_PROGRESS_SCHEMA_VERSION"));
ck("migrated GTO progress updates in same transaction as trip", tripsFn.includes("progressFastPath") && tripsFn.includes("transaction.set(jobRef, progressUpdate, { merge: true })") && tripsFn.includes("transaction.create(tripRef"));
ck("duplicate GTO retry uses job progress without historical scan after migration", tripsFn.includes("hasCanonicalProgress") && tripsFn.includes("progress: Math.trunc(retryProgress)"));
ck("legacy jobs retain safe one-time historical reconciliation", tripsFn.includes("One-time migration/heal for jobs created before HF58") && tripsFn.includes("await syncJobProgress("));
ck("simple-mode completed routes remain maintained on fast path", tripsFn.includes('if (serverContractMode === "simple")') && tripsFn.includes("progressUpdate.completedRoutes") && tripsFn.includes("{ origin: effectiveOrigin, destination }"));

// Explicitly guard the HF57 UX optimizations that must not be traded for cost savings.
ck("HF57 instant freight feedback preserved", service.includes("FAST_FREIGHT_MESSAGE_CONFIRM_FRAMES = 2") && service.includes('announceDriverStage("FREIGHT_LIST_VISUAL_PENDING"'));
ck("HF57 corrected option pluralization preserved", service.includes('safeCount == 1 ? " opção" : " opções"') && !service.includes("opçãoões"));
ck("ML Kit remains local detector dependency", service.includes("TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)"));

const failed = checks.filter((x) => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF58 Cost Safe checks passed.`);
if (failed.length) process.exit(1);
