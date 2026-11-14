import assert from "node:assert/strict";
import { blockedMessage, isLeaveCommandAcknowledged, isLeaveUnsupported, leaveDialogCopy, leaveFailureMessage, localLeavePreflight, parseLeavePreview, preflightMessage } from "../src/services/leaveCompanyCore.ts";

const ok = { success: true, preview: true, companyId: "a", companyName: "DC Transportes", canLeave: true, jobsToCancel: 1, awaitingCompletion: 0 };
const checks: string[] = [];

// Preview parsing: only a well-formed answer for this company is accepted.
assert.deepEqual(parseLeavePreview(ok, "a"), { companyId: "a", companyName: "DC Transportes", canLeave: true, blocker: null, jobsToCancel: 1, awaitingCompletion: 0, alreadyLeft: false });
for (const bad of [null, {}, { ...ok, success: false }, { ...ok, preview: false }, { ...ok, companyId: "b" }, "x"]) assert.equal(parseLeavePreview(bad, "a"), null);
assert.equal(parseLeavePreview({ ...ok, canLeave: "true" }, "a")!.canLeave, false, "canLeave must be the boolean true");
assert.equal(parseLeavePreview({ ...ok, jobsToCancel: -3 }, "a")!.jobsToCancel, 0);
assert.equal(parseLeavePreview({ ...ok, canLeave: false, blocker: "LEAVE_OWNER" }, "a")!.blocker, "LEAVE_OWNER");
checks.push("preview parsing");

// An old server (before this feature) must keep the option hidden; a network failure must not look like "unsupported".
assert.equal(isLeaveUnsupported({ code: "functions/invalid-argument", message: "Ação de vínculo inválida." }), true);
assert.equal(isLeaveUnsupported({ code: "functions/not-found" }), true);
assert.equal(isLeaveUnsupported({ code: "functions/unavailable" }), false);
assert.equal(isLeaveUnsupported({ code: "functions/permission-denied" }), false);
assert.equal(isLeaveUnsupported(new Error("offline")), false);
checks.push("capability detection");

// Success is claimed only for the server's explicit confirmation.
assert.equal(isLeaveCommandAcknowledged({ success: true, left: true, companyId: "a", userId: "me" }, "a", "me"), true);
assert.equal(isLeaveCommandAcknowledged({ success: true, companyId: "a" }, "a", "me"), false);
assert.equal(isLeaveCommandAcknowledged({ success: true, left: true, companyId: "b" }, "a", "me"), false);
assert.equal(isLeaveCommandAcknowledged({ success: true, left: true, companyId: "a", userId: "other" }, "a", "me"), false);
assert.equal(isLeaveCommandAcknowledged(undefined, "a", "me"), false);
checks.push("acknowledgement");

// Local preflight: needs a connection and nothing waiting on the device; an unreadable native queue is a refusal.
const ports = (over: Record<string, unknown> = {}) => ({ online: true, registrations: () => 0, legacyTrips: () => 0, operations: () => 0, native: async () => 0, ...over }) as any;
assert.deepEqual(await localLeavePreflight(ports()), { ok: true });
assert.deepEqual(await localLeavePreflight(ports({ online: false })), { ok: false, reason: "offline", count: 0 });
assert.deepEqual(await localLeavePreflight(ports({ registrations: () => 2, native: async () => 1 })), { ok: false, reason: "pending-work", count: 3 });
for (const key of ["registrations", "legacyTrips", "operations"]) assert.equal((await localLeavePreflight(ports({ [key]: () => 1 }))) .ok, false, key);
assert.equal((await localLeavePreflight(ports({ native: async () => 4 }))).ok, false);
assert.deepEqual(await localLeavePreflight(ports({ native: async () => { throw new Error("bridge"); } })), { ok: false, reason: "unverifiable", count: 0 });
// Offline is decided before touching the native queue.
let touched = false;
await localLeavePreflight(ports({ online: false, native: async () => { touched = true; return 0; } }));
assert.equal(touched, false);
checks.push("local preflight");

// Wording.
const copy = leaveDialogCopy(parseLeavePreview(ok, "a")!);
assert.equal(copy.title, "Sair da DC Transportes?");
assert.deepEqual(copy.lines.map(line => (line.strong || "") + line.text), [
  "Você deixará de receber trabalhos desta empresa e perderá o acesso à área dela.",
  "1 trabalho em andamento será cancelado. As viagens já registradas serão mantidas.",
  "Sua conta e seu histórico pessoal continuam com você. Para voltar, será preciso uma nova inscrição aprovada.",
]);
assert.equal(copy.lines[1].strong, "1 trabalho em andamento será cancelado.");
assert.equal(leaveDialogCopy({ ...parseLeavePreview(ok, "a")!, jobsToCancel: 3 }).lines[1].strong, "3 trabalhos em andamento serão cancelados.");
const none = leaveDialogCopy({ ...parseLeavePreview(ok, "a")!, jobsToCancel: 0 });
assert.equal(none.lines[1].strong, undefined); assert.equal(none.lines[1].text, "As viagens já registradas serão mantidas.");
assert.equal(leaveDialogCopy({ ...parseLeavePreview(ok, "a")!, companyName: "" }).title, "Sair desta empresa?");
assert.equal(copy.stay, "Continuar na empresa"); assert.equal(copy.confirm, "Confirmar saída");
assert.match(blockedMessage({ ...parseLeavePreview(ok, "a")!, canLeave: false, blocker: "LEAVE_AWAITING_COMPLETION", awaitingCompletion: 1 }), /Finalize a operação que aguarda conclusão/);
assert.match(blockedMessage({ ...parseLeavePreview(ok, "a")!, canLeave: false, blocker: "LEAVE_AWAITING_COMPLETION", awaitingCompletion: 2 }), /Finalize as operações/);
assert.match(blockedMessage({ ...parseLeavePreview(ok, "a")!, canLeave: false, blocker: "LEAVE_OWNER" }), /Transfira a propriedade/);
assert.match(preflightMessage({ ok: false, reason: "offline", count: 0 }), /Conecte-se à internet/);
assert.match(preflightMessage({ ok: false, reason: "pending-work", count: 1 }), /1 viagem ou envio ainda não enviado/);
assert.match(preflightMessage({ ok: false, reason: "pending-work", count: 5 }), /5 viagens ou envios ainda não enviados/);
assert.match(leaveFailureMessage({ code: "functions/unavailable", details: { diagnosticId: "leave-123" } }), /tente novamente\. Referência: leave-123\./);
assert.match(leaveFailureMessage({ details: { reasonCode: "LEAVE_OWNER" } }), /Transfira a propriedade/);
assert.match(leaveFailureMessage({ code: "functions/permission-denied" }), /Não foi possível sair da empresa agora\./);
checks.push("wording");

console.log("LEAVE_COMPANY_CORE_PASS", checks.length);
