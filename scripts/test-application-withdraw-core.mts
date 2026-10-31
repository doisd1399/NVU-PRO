import assert from "node:assert/strict";
import { isWithdrawAcknowledged, parseCapabilities, withdrawFailureMessage } from "../src/services/applicationWithdrawCore.ts";
import { executeFleetMembershipClient } from "../src/services/fleetMembershipClientCore.ts";

// Capability list: only a well-formed success counts; an old server (error) offers nothing.
assert.deepEqual(parseCapabilities({ success: true, capabilities: ["leave", "withdraw-application", 7] }), ["leave", "withdraw-application"]);
for (const bad of [null, {}, { success: false, capabilities: ["x"] }, { success: true }, { success: true, capabilities: "x" }]) assert.deepEqual(parseCapabilities(bad), []);

// Success is claimed only for exactly this application.
assert.equal(isWithdrawAcknowledged({ success: true, withdrawn: true, companyId: "a", applicationId: "x" }, "a", "x"), true);
assert.equal(isWithdrawAcknowledged({ success: true, withdrawn: true, companyId: "a", applicationId: "y" }, "a", "x"), false);
assert.equal(isWithdrawAcknowledged({ success: true, withdrawn: true, companyId: "b", applicationId: "x" }, "a", "x"), false);
assert.equal(isWithdrawAcknowledged({ success: true, companyId: "a", applicationId: "x" }, "a", "x"), false);
assert.equal(isWithdrawAcknowledged(undefined, "a", "x"), false);

// Wording.
assert.match(withdrawFailureMessage({ details: { reasonCode: "WITHDRAW_ALREADY_APPROVED" } }), /já foi aprovada/);
assert.match(withdrawFailureMessage({ details: { reasonCode: "WITHDRAW_ALREADY_ANSWERED" } }), /já respondeu/);
assert.match(withdrawFailureMessage({ details: { reasonCode: "WITHDRAW_NOT_FOUND" } }), /não existe mais/);
assert.match(withdrawFailureMessage({ code: "functions/unavailable", details: { diagnosticId: "w-1" } }), /Não foi possível confirmar a retirada\. Tente novamente\. Referência: w-1\./);
assert.match(withdrawFailureMessage({ code: "functions/permission-denied" }), /Não foi possível retirar a inscrição agora\./);

// The client executor accepts a capability listing (it names no company) and still rejects other malformed answers.
const user = { uid: "me", getIdToken: async () => "t" };
const run = (command: any, data: any) => executeFleetMembershipClient(command, { ready: async () => undefined, getUser: () => user, invoke: async () => ({ data }) });
assert.deepEqual(await run({ action: "capabilities", companyId: "" }, { success: true, capabilities: ["leave"] }), { success: true, capabilities: ["leave"] });
await assert.rejects(run({ action: "withdraw-application", companyId: "a", applicationId: "x" }, { success: true, companyId: "b", withdrawn: true }), error => (error as any).code === "MEMBERSHIP_ACK_INVALID");
await assert.rejects(run({ action: "withdraw-application", companyId: "a", applicationId: "x" }, { success: true, companyId: "a", applicationId: "other", withdrawn: true }), error => (error as any).code === "MEMBERSHIP_ACK_INVALID");
assert.equal((await run({ action: "withdraw-application", companyId: "a", applicationId: "x" }, { success: true, companyId: "a", applicationId: "x", withdrawn: true })).withdrawn, true);
console.log("APPLICATION_WITHDRAW_CORE_PASS");
