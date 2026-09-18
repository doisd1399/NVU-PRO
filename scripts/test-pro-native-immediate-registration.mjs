import fs from "node:fs";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url).pathname;
const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

const service = read("../android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java");
const coordinator = read("../android/app/src/main/java/com/nvu/operacional/SimpleProNativeSubmissionCoordinator.java");
const bridge = read("../src/components/SimpleAutomationCompletionBridge.tsx");
const completion = read("../src/services/simpleAutomationCompletionService.ts");
const repository = read("../src/repositories/TripsRepository.ts");
const launcher = read("../src/services/simpleAutomationLauncher.ts");

assert.match(service, /submitNativeReceiptIfPending\(\);/);
assert.match(service, /SimpleProNativeSubmissionCoordinator\.submit\(this, prefs, receipt/);
const nativeSubmitIndex = service.indexOf("submitNativeReceiptIfPending();");
const fallbackEventIndex = service.indexOf("SimpleAutomationPlugin.emitReceiptCaptured();", nativeSubmitIndex);
assert.ok(nativeSubmitIndex >= 0, "captura legível deve iniciar submissão nativa");
assert.ok(fallbackEventIndex > nativeSubmitIndex, "evento Web deve ser fallback posterior, não caminho primário");
assert.match(service, /nativeSubmissionState.*SUBMITTING_NATIVE/);
assert.match(service, /nativeSubmissionState.*WEB_FALLBACK/);
assert.match(service, /onStartCommand[\s\S]{0,12000}submitNativeReceiptIfPending/);

assert.match(coordinator, /FirebaseAuth\.getInstance\(\)\.getCurrentUser\(\)/);
assert.match(coordinator, /FirebaseFirestore\.getInstance\(\)/);
assert.match(coordinator, /historico_viagens/);
assert.match(coordinator, /deterministicTripId/);
assert.match(coordinator, /hasConsecutiveDuplicate/);
assert.match(coordinator, /nativeSuccess/);
assert.match(coordinator, /fallback/);
assert.match(coordinator, /resultScreenConfirmed/);
assert.match(coordinator, /hasPositiveBonus/);

assert.match(bridge, /nativeSubmissionState === "SUBMITTING_NATIVE"/);
assert.match(bridge, /nativeSubmissionState === "SYNCED"/);
assert.match(repository, /addSimpleProTrip/);
assert.match(completion, /deterministicTripId/);
assert.match(completion, /addTripWithinOperationLimit\(trip, \{[\s\S]*tripId: deterministicTripId/);
assert.match(launcher, /driverId\?: string/);

const nativeIdExpression = /simple_[^;]*driverId[^;]*attemptId/;
const webIdExpression = /`simple_\$\{input\.currentUser\.id\}_\$\{attemptId\}`/;
assert.match(coordinator, nativeIdExpression);
assert.match(completion, webIdExpression);

console.log("PASS: native Pro immediate registration, safe Web fallback and deterministic idempotency contract");
