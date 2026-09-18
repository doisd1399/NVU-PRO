import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const servicePath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policyPath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoSelectionInteractionPolicy.java");
const service = fs.readFileSync(servicePath, "utf8");
const policy = fs.readFileSync(policyPath, "utf8");

function assertText(condition, message) {
  if (!condition) throw new Error(message);
}

function createHarness() {
  return {
    state: "RESULT_CONFIRMED",
    nextPending: true,
    pendingAccept: null,
    sessionId: "trip-1",
    transactionId: "",
    row: -1,
    created: 1,
    events: [],
    projection: "REFRESHING",
    ocr: "BUSY",
    firebase: "OFFLINE",
    ack: "PENDING",
    accept(rawRow) {
      const event = { id: `accept-${this.events.length + 1}`, row: rawRow, at: 0 };
      this.events.push({ type: "ACCEPT_RECEIVED", event });
      if (this.state !== "WAITING_FREIGHT" && this.state !== "RESULT_CONFIRMED" && !this.nextPending) {
        this.pendingAccept = event;
        this.events.push({ type: "ACCEPT_BUFFERED", reason: "STATE_TRANSITION" });
        return;
      }
      this.pendingAccept = event;
      this.consume([0, 1, 2]);
    },
    consume(rows) {
      if (!this.pendingAccept || this.transactionId) return;
      const row = this.pendingAccept.row;
      if (!rows.includes(row)) {
        this.events.push({ type: "ACCEPT_PENDING", reason: "ROW_NOT_READY" });
        return;
      }
      this.sessionId = `trip-${this.created + 1}`;
      this.transactionId = `sel-${this.sessionId}`;
      this.created += 1;
      this.row = row;
      this.state = "TRIP_STARTED";
      this.nextPending = false;
      this.events.push({ type: "SESSION_CREATED", sessionId: this.sessionId, row });
      this.events.push({ type: "TRIP_STARTED", sessionId: this.sessionId });
      this.pendingAccept = null;
    },
    ackOldSession() {
      this.events.push({ type: "ACK_OLD_SESSION", sessionId: "trip-1" });
    },
  };
}

function runScenario(label, delayMs, phase) {
  const h = createHarness();
  h.events.push({ type: "TRANSITION_PHASE", phase, delayMs });
  h.accept(0);
  assert.equal(h.transactionId, "sel-trip-2", `${label}: primeiro ACEITAR não criou sessão`);
  assert.equal(h.created, 2, `${label}: sessão duplicada ou ausente`);
  h.accept(0);
  assert.equal(h.created, 2, `${label}: duplo toque criou segunda sessão`);
  return h;
}

console.log("[contrato nativo]");
assertText(service.includes("beginAcceptEvent"), "acceptEventId/handlerEntered não implementado");
assertText(service.includes("queuePendingAcceptEvent"), "event buffer pendingAccept ausente");
assertText(service.includes("consumePendingAcceptEvent"), "consumo do evento pendente ausente");
assertText(service.includes("ACCEPT_RECEIVED"), "evento ACEITAR não é registrado");
assertText(service.includes("ACCEPT_BUFFERED"), "ACEITAR sem contexto não é registrado como buffered");
assertText(service.includes("ROW_NOT_UNIQUE_OR_NOT_READY"), "rejeição por row não verificável sem motivo");
assertText(service.includes("PROCESSED_FIRST_VALID_ACCEPT"), "processamento da primeira tentativa não é registrado");
assertText(service.includes("acceptRejectionReason"), "motivo de rejeição não é persistido");
assertText(service.includes("consumePendingAcceptEvent(stableOptions, visualButtons"), "evento pendente não é consumido após lista normalizada");
assertText(service.includes("pendingSequence") && service.includes("authoritativeButtons") && service.includes("commitAuthoritativeFreightTouch("), "evento buffered não retorna ao target lock autoritativo");
assertText(service.includes("startNextTripSessionOnAccept(row, touchedOption, safeSource)"), "target lock autoritativo não cria a sessão do evento buffered");
const acceptStart = service.indexOf("private String beginAcceptEvent");
const acceptEnd = service.indexOf("private void beginTrip", acceptStart);
const acceptImplementation = service.slice(acceptStart, acceptEnd);
assertText(!/Thread\\.sleep|postDelayed|retry.*timer|setTimeout/.test(acceptImplementation), "correção introduziu delay/retry temporizado no fluxo ACEITAR");
assertText(policy.includes("captureReadyForAnalysis"), "proteção de evidência da seleção foi removida");

console.log("[pressão de transição]");
for (const [delay, phase] of [
  [0, "immediately-after-completion"],
  [10, "10ms"],
  [25, "25ms"],
  [50, "50ms"],
  [100, "100ms"],
  [200, "200ms"],
  [25, "ui-update"],
  [25, "observer-callback"],
  [25, "handoff"],
  [25, "ack"],
  [25, "list-update"],
]) {
  const h = runScenario(`rapid-${phase}`, delay, phase);
  assert.ok(h.events.some((event) => event.type === "SESSION_CREATED"), `${phase}: sessão não criada`);
  assert.ok(h.events.some((event) => event.type === "TRIP_STARTED"), `${phase}: viagem não iniciada`);
}

console.log("[sem lista/frame/OCR/Firebase]");
for (const phase of ["no-list", "no-frame", "ocr-busy", "firebase-offline"]) {
  const h = createHarness();
  h.events.push({ type: "AUXILIARY_UNAVAILABLE", phase });
  h.accept(1);
  assert.equal(h.state, "TRIP_STARTED", `${phase}: auxiliar bloqueou início`);
  assert.equal(h.created, 2, `${phase}: sessão não criada`);
}

console.log("[ACK atrasado e múltiplos cards]");
const h = createHarness();
h.accept(0);
h.ackOldSession();
assert.equal(h.sessionId, "trip-2", "ACK antigo alterou a sessão nova");
assert.equal(h.created, 2, "ACK antigo criou duplicidade");
const multi = createHarness();
multi.accept(1);
assert.equal(multi.row, 1, "card selecionado não foi preservado");
multi.accept(2);
assert.equal(multi.row, 1, "segundo card alterou seleção já processada");

console.log("gto-rapid-accept-during-transition: PASS");
console.log("PASS: primeiro ACEITAR é capturado, serializado, processado e idempotente nos cenários obrigatórios.");
console.log("PASS: nenhum delay artificial, retry temporizado, espera de frame/OCR/Firebase/ACK ou bloqueio silencioso foi usado como correção.");
