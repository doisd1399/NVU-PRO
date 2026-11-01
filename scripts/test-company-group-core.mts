import assert from "node:assert/strict";
import { addSummary, deactivateSummary, groupSimulatorSelection, parseDeactivateResult, simulatorChanges, companyGroupIdOf, fleetsOfGroup, groupFailureMessage, groupSimulatorRows, isGroupUnsupported, isRenameAcknowledged, isUsableFleet,
  parseAddResult, parseGroupCapabilities, simulatorsToAdd } from "../src/services/companyGroupCore.ts";
import { extraRegistrationSimulatorIds, registrationSimulatorIds, registrationSimulatorLabel } from "../src/lib/registrationSimulators.ts";

const simulators = [
  { id: "gto", name: "GTO", active: true }, { id: "ats", name: "ATS", active: true }, { id: "ets-2", name: "ETS 2", active: true },
  { id: "wtds", name: "WTDS", active: true }, { id: "off", name: "Desligado", active: false },
];
const fleet = (id: string, simulatorId: string, simulatorName: string, extra: Record<string, unknown> = {}) => ({ id, companyName: "DC Transportes", simulatorId, simulatorName, status: "active", ...extra });

// Which fleets belong to the company: the ones sharing the group id, or the first fleet that gave it.
const a = fleet("a", "gto", "GTO", { companyGroupId: "a" }), b = fleet("a-ats", "ats", "ATS", { companyGroupId: "a" }), other = fleet("z", "ats", "ATS", { companyGroupId: "z" });
assert.equal(companyGroupIdOf(a), "a"); assert.equal(companyGroupIdOf(fleet("solo", "gto", "GTO")), "solo");
assert.deepEqual(fleetsOfGroup(a, [a, b, other]).map(f => f.id), ["a", "a-ats"], "the active one first, strangers never");
assert.deepEqual(fleetsOfGroup(b, [a, b, other]).map(f => f.id), ["a-ats", "a"], "seen from another fleet the group is the same");
assert.deepEqual(fleetsOfGroup(fleet("solo", "gto", "GTO"), [a, b, other]).map(f => f.id), ["solo"], "a company that never added a simulator is alone");
assert.deepEqual(fleetsOfGroup(a, [a, fleet("a-ets", "ets-2", "ETS 2", { companyGroupId: "a", deleted: true }), b]).map(f => f.id), ["a", "a-ats"], "a deleted fleet does not count");
assert.deepEqual(fleetsOfGroup(null, [a]), []);
for (const status of ["deleted", "archived", "suspended", "inactive", "pending"]) assert.equal(isUsableFleet(fleet("x", "gto", "GTO", { status })), false, status);
assert.equal(isUsableFleet(fleet("x", "gto", "GTO", { isActive: false })), false); assert.equal(isUsableFleet(null), false);

// The rows of "Simuladores da empresa".
assert.deepEqual(groupSimulatorRows(a, [a, b], simulators), [{ companyId: "a", label: "GTO", current: true }, { companyId: "a-ats", label: "ATS", current: false }]);

// What can still be added: active catalog simulators the company does not have, also when it has one under another spelling.
assert.deepEqual(simulatorsToAdd(a, [a, b], simulators), [{ value: "ets-2", label: "ETS 2" }, { value: "wtds", label: "WTDS" }]);
assert.deepEqual(simulatorsToAdd(fleet("solo", "global-truck-online", "Global Truck Online"), [], simulators).map(o => o.value), ["ats", "ets-2", "wtds"], "GTO under its old spelling is still GTO");
assert.deepEqual(simulatorsToAdd(a, [a], simulators.map(s => ({ ...s, active: false }))), [], "nothing to add when every simulator is off");
assert.deepEqual(simulatorsToAdd(null, [], simulators).map(o => o.value), ["gto", "ats", "ets-2", "wtds"]);

// Server answers.
assert.deepEqual(parseGroupCapabilities({ success: true, capabilities: ["add-simulators", "rename", 3] }), ["add-simulators", "rename"]);
for (const bad of [null, {}, { success: false, capabilities: ["x"] }, { success: true }, { success: true, capabilities: "x" }]) assert.deepEqual(parseGroupCapabilities(bad), []);
for (const code of ["functions/invalid-argument", "functions/not-found", "functions/unimplemented", "invalid-argument"]) assert.equal(isGroupUnsupported({ code }), true, code);
for (const code of ["functions/unavailable", "functions/internal", "functions/permission-denied", ""]) assert.equal(isGroupUnsupported({ code }), false, code);
const answer = { success: true, companyId: "a", groupId: "a", created: [{ companyId: "a-ats", simulatorId: "ats", simulatorName: "ATS" }], existing: [], skipped: [{ simulatorId: "off", reason: "inactive-simulator" }] };
assert.deepEqual(parseAddResult(answer, "a")?.created, [{ companyId: "a-ats", simulatorId: "ats", simulatorName: "ATS" }]);
assert.equal(parseAddResult(answer, "other"), null, "an answer about another company is not accepted");
assert.equal(parseAddResult({ ...answer, success: false }, "a"), null); assert.equal(parseAddResult({ success: true, companyId: "a" }, "a"), null); assert.equal(parseAddResult(null, "a"), null);
assert.equal(isRenameAcknowledged({ success: true, companyName: "DC Cargas" }, "DC Cargas"), true);
assert.equal(isRenameAcknowledged({ success: true, companyName: "Outro" }, "DC Cargas"), false); assert.equal(isRenameAcknowledged(undefined, "x"), false);

// Wording.
const two = parseAddResult({ ...answer, created: [{ companyId: "1", simulatorId: "ats", simulatorName: "ATS" }, { companyId: "2", simulatorId: "ets-2", simulatorName: "ETS 2" }] }, "a")!;
assert.equal(addSummary(two), "ATS e ETS 2 foram adicionados à empresa.");
assert.equal(addSummary(parseAddResult(answer, "a")!), "ATS foi adicionado à empresa.");
assert.equal(addSummary({ created: [], existing: [], skipped: [{ simulatorId: "ats", reason: "already-in-group" }] }), "Esses simuladores já fazem parte da empresa.");
assert.equal(addSummary({ created: [], existing: [], skipped: [] }), "Nenhum simulador foi adicionado.");
assert.match(groupFailureMessage({ details: { reasonCode: "GROUP_OWNER_ONLY" } }), /Somente o proprietário/);
assert.match(groupFailureMessage({ code: "functions/unavailable", details: { diagnosticId: "g-1" } }), /Nada foi perdido: tente novamente\. Referência: g-1\./);
assert.match(groupFailureMessage({ code: "functions/permission-denied" }), /Não foi possível concluir\./);

// Registrations: old ones have a single simulator, new ones a list whose first item is simulatorId.
assert.deepEqual(registrationSimulatorIds({ simulatorId: "gto", simulatorName: "GTO" }), ["gto"]);
assert.deepEqual(registrationSimulatorIds({ simulatorId: "gto", simulatorIds: ["gto", "ats", "ats", " "] }), ["gto", "ats"]);
assert.deepEqual(registrationSimulatorIds({ simulatorIds: ["ats", "ets-2"] }), ["ats", "ets-2"]);
assert.deepEqual(registrationSimulatorIds(null), []);
assert.equal(registrationSimulatorLabel({ simulatorName: "GTO" }), "GTO");
assert.equal(registrationSimulatorLabel({ simulatorName: "GTO", simulatorNames: ["GTO", "ATS"] }), "GTO, ATS");
assert.equal(registrationSimulatorLabel({ simulatorNames: ["ATS"] }), "ATS"); assert.equal(registrationSimulatorLabel({}), "N/A"); assert.equal(registrationSimulatorLabel(null), "N/A");
assert.deepEqual(extraRegistrationSimulatorIds({ simulatorId: "gto", simulatorIds: ["gto", "ats", "ets-2"] }, "gto"), ["ats", "ets-2"]);
assert.deepEqual(extraRegistrationSimulatorIds({ simulatorId: "gto", simulatorIds: ["global-truck-online", "ats"] }, "gto", id => id === "global-truck-online" ? "gto" : id), ["ats"], "the same simulator under another spelling is not extra");
assert.deepEqual(extraRegistrationSimulatorIds({ simulatorId: "gto" }, "gto"), []);
console.log("COMPANY_GROUP_CORE_PASS");

// "Simuladores de atuação": every active catalog simulator is an option, the usable fleets of the group are the chosen ones.
{
  const group = fleet("a", "gto", "GTO", { companyGroupId: "a" }), ats = fleet("a-ats", "ats", "ATS", { companyGroupId: "a" });
  const gone = fleet("a-ets", "ets-2", "ETS 2", { companyGroupId: "a", status: "archived", deactivatedForSimulator: true });
  const selection = groupSimulatorSelection(group, [group, ats, gone], simulators);
  assert.deepEqual(selection.selected.sort(), ["ats", "gto"], "a switched-off fleet is not chosen");
  assert.deepEqual(selection.options.map(o => o.value), ["gto", "ats", "ets-2", "wtds"], "inactive catalog simulators are not offered");
  assert.equal(selection.fleetByValue.get("ats"), "a-ats"); assert.equal(selection.currentValue, "gto");
  // The same company seen from another fleet.
  assert.equal(groupSimulatorSelection(ats, [group, ats], simulators).currentValue, "ats");
  // A simulator the catalog no longer lists still shows as chosen.
  const orphan = groupSimulatorSelection(fleet("o", "old-sim", "Antigo"), [], simulators);
  assert.deepEqual(orphan.selected, ["old-sim"]); assert.ok(orphan.options.some(o => o.value === "old-sim" && o.label === "Antigo"));
  // What saving changes.
  assert.deepEqual(simulatorChanges(selection, ["gto", "ats"]), { add: [], remove: [] });
  assert.deepEqual(simulatorChanges(selection, ["gto", "ats", "wtds"]), { add: ["wtds"], remove: [] });
  assert.deepEqual(simulatorChanges(selection, ["gto"]), { add: [], remove: [{ value: "ats", companyId: "a-ats" }] });
  assert.deepEqual(simulatorChanges(selection, ["gto", "ets-2"]), { add: ["ets-2"], remove: [{ value: "ats", companyId: "a-ats" }] });
}

// Switching simulators off: the answer is only accepted when it is for this company.
assert.equal(parseDeactivateResult({ success: true, companyId: "x", deactivated: [] }, "a"), null);
assert.equal(parseDeactivateResult({ success: false, companyId: "a", deactivated: [] }, "a"), null);
const off = parseDeactivateResult({ success: true, companyId: "a", deactivated: [{ companyId: "a-ats", simulatorId: "ats", simulatorName: "ATS" }], alreadyInactive: ["a-pbs"], remaining: 2 }, "a");
assert.deepEqual(off, { deactivated: [{ companyId: "a-ats", simulatorId: "ats", simulatorName: "ATS" }], alreadyInactive: ["a-pbs"], remaining: 2 });
assert.equal(deactivateSummary(off!), "ATS foi desativado. O histórico fica guardado.");
assert.equal(deactivateSummary({ deactivated: [], alreadyInactive: ["a-pbs"], remaining: 2 }), "Esses simuladores já estavam desativados.");
assert.equal(deactivateSummary({ deactivated: [{ companyId: "1", simulatorId: "a", simulatorName: "ATS" }, { companyId: "2", simulatorId: "b", simulatorName: "WTDS" }], alreadyInactive: [], remaining: 1 }), "ATS e WTDS foram desativados. O histórico fica guardado.");
assert.equal(groupFailureMessage({ details: { reasonCode: "GROUP_LAST_SIMULATOR" } }), "A empresa precisa continuar com pelo menos um simulador ativo.");
assert.match(groupFailureMessage({ details: { reasonCode: "GROUP_OPEN_OPERATIONS" } }), /Finalize ou cancele as operações desse simulador/);
// A server that predates the reactivation list still reads fine, and a reactivated simulator counts as added.
assert.equal(addSummary({ created: [], existing: [], reactivated: [{ companyId: "a-ats", simulatorId: "ats", simulatorName: "ATS" }], skipped: [] }), "ATS foi adicionado à empresa.");
assert.deepEqual(parseAddResult({ success: true, companyId: "a", created: [], reactivated: [{ companyId: "a-ats", simulatorId: "ats", simulatorName: "ATS" }] }, "a")?.reactivated.map(r => r.companyId), ["a-ats"]);
console.log("COMPANY_GROUP_EDIT_CORE_PASS");
