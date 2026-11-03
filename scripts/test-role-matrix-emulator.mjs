import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";

const projectId = "demo-nvu-v36-4-staging";
assert.equal(process.env.GCLOUD_PROJECT, projectId, "Only the disposable demo project is allowed");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^127\.0\.0\.1:\d+$/);
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require(process.cwd()+"/functions/lib/firebaseAdmin.js");
if (!admin.apps.length) admin.initializeApp({ projectId });
const { executeOperationalCommand, prepareCompanyOperationalCommands, settleOperationalAssignment,
  operationalDriverStateId, operationalCompletionId } = require("./lib/operationalCommands.js");
const { completeCanonicalOperation } = require("./lib/completeCanonicalOperation.js");
const { registerGtoTrip } = require("./lib/gtoTrips.js");
const { settleCanonicalOperationCompletion } = require("./lib/finalizeCanonicalOperation.js");
const environment = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync("firestore.rules", "utf8") } });
const db = admin.firestore();
const ctx = (uid, token = {}) => ({ auth: { uid, token } });
const owner = ctx("owner-a"), driver = ctx("driver-a"), driver2 = ctx("driver-b");
let sequence = 0;
const command = (args, actor = owner, requestId = `request-${++sequence}`) => executeOperationalCommand(db, { ...args, requestId }, actor);
const assign = (args = {}, actor = owner, requestId) => command({ action: "assign", companyId: "a", contractId: "contract-a", driverId: "driver-a",
  vehicleId: "vehicle-a", trailerId: "trailer-a", ...args }, actor, requestId);
const start = (jobId, actor = driver, requestId) => command({ action: "start", companyId: "a", jobId }, actor, requestId);
const cancel = jobId => command({ action: "cancel", companyId: "a", jobId });
const state = uid => db.doc(`operationalDriverStates/${operationalDriverStateId("a", uid)}`);
const progress = (uid = "driver-a") => db.doc(`driverOperationCompletions/${operationalCompletionId("a", uid, "contract-a")}`);
const denied = (fn, code = "permission-denied") => assert.rejects(fn, error => String(error.code).includes(code));
const client = uid => environment.authenticatedContext(uid).firestore();
const seed = async () => {
  await environment.clearFirestore();
  const rows = [
    ["frotas/a", { ownerId: "owner-a", userId: "owner-a", simulatorId: "GTO", status: "active", operationalCommandVersion: 1 }],
    ["frotas/b", { ownerId: "owner-b", userId: "owner-b", simulatorId: "GTO", operationalCommandVersion: 1 }],
    ["frotas/legacy", { ownerId: "owner-a", userId: "owner-a", simulatorId: "GTO" }],
    ["sequencias/a", { companyId: "a", name: "A" }], ["sequencias/b", { companyId: "b", name: "B" }],
    ["users/owner-a", { companyId: "a", role: "admin", status: "active" }],
    ["users/owner-b", { companyId: "b", role: "admin", status: "active" }],
    ["users/profile-admin-a", { companyId: "a", role: "admin", status: "active" }],
    ["companyMembers/profile-admin-a_a", { companyId: "a", userId: "profile-admin-a", roles: ["admin", "driver"], status: "active" }],
    ["users/member-admin", { companyId: "a", role: "driver", status: "active" }],
    ["users/senior", { role: "driver", status: "active" }],
    ["companyMembers/member-admin-a", { companyId: "a", userId: "member-admin", roles: ["admin"], status: "active" }],
    ["contratos/contract-a", { companyId: "a", name: "Operação A", simulator: "GTO", mode: "simple", totalDeliveries: 1, deadlineDays: 3, trailerId: "trailer-a", status: "active" }],
    ["contratos/contract-b", { companyId: "b", name: "Operação B", simulator: "GTO", mode: "simple", totalDeliveries: 1, deadlineDays: 3, status: "active" }],
    ["veiculos/vehicle-a", { companyId: "a", name: "Caminhão A", plate: "ABC", status: "available" }],
    ["veiculos/vehicle-a2", { companyId: "a", name: "Caminhão 2", status: "available" }],
    ["veiculos/vehicle-b", { companyId: "b", name: "Caminhão B", status: "available" }],
    ["reboques/trailer-a", { companyId: "a", name: "Reboque A", status: "available" }],
    ["reboques/trailer-b", { companyId: "b", name: "Reboque B", status: "available" }],
  ];
  for (const uid of ["driver-a", "driver-b"]) rows.push(
    [`users/${uid}`, { role: "driver", companyId: "a", status: "active" }],
    [`companyMembers/${uid}_a`, { userId: uid, companyId: "a", roles: ["driver"], status: "active" }],
    [`simulator_members/${uid}_a`, { userId: uid, companyId: "a", roles: ["driver"], status: "active" }],
  );
  const batch = db.batch();
  rows.forEach(([ref, data]) => batch.set(db.doc(ref), data));
  await batch.commit();
  // The Functions emulator is not started: explicitly run the real 501
  // projection that would be produced by membership triggers in production.
  const { refreshCompanyAccess } = require("./lib/companyAccess.js");
  for (const uid of ["owner-a", "driver-a", "driver-b", "member-admin", "profile-admin-a"])
    if ((await db.doc(`users/${uid}`).get()).exists) await refreshCompanyAccess(db, uid, "a");

};
const addReceipt = async (jobId, uid = "driver-a") => db.doc(`historico_viagens/trip-${jobId}`).set({
  jobId, operationId: jobId, companyId: "a", empresaId: "a", driverId: uid, motoristaId: uid, contractId: "contract-a",
  status: "concluida", recordStatus: "concluida", source: "gto_auto", operationSlot: 1, operationSlotKey: `trip-${jobId}`,
  serverValidatedAt: new Date(), uploadedAt: new Date(), completedAt: new Date(),
});

// ---------------------------------------------------------------------------------------------------------------------------
// Role × action matrix of the server-side operational commands (the authority behind every enabled button).
// Fictitious data only (demo project, emulator). Expected = the policy; a change in behaviour fails here and must be explained.
// ---------------------------------------------------------------------------------------------------------------------------
const actors = {
  proprietario: ctx("owner-a"),                 // owner of company A
  administrador: ctx("member-admin"),           // companyMembers: admin
  "administrador+motorista": ctx("profile-admin-a"),
  motorista: ctx("driver-a"),                   // the driver assigned by the company
  "outro motorista": ctx("driver-b"),           // another driver of the same company
  "proprietário de outra empresa": ctx("owner-b"),
  anônimo: { auth: null },
};
const rows = [];
async function row(action, role, expectation, attempt) {
  const started = performance.now();
  let outcome;
  try { await attempt(actors[role]); outcome = "allow"; }
  catch (error) { outcome = String(error.code || error.message).replace(/^functions\//, ""); }
  const ok = expectation === "allow" ? outcome === "allow" : outcome.includes(expectation);
  rows.push({ action, role, expected: expectation === "allow" ? "permitido" : `recusado (${expectation})`, actual: outcome === "allow" ? "permitido" : `recusado (${outcome})`, ok, ms: Math.round(performance.now() - started) });
  if (!ok) console.error(`FAIL ${action} / ${role}: expected ${expectation}, got ${outcome}`);
}
const asOwner = owner;
async function matrix() {
  const assignRoles = [["proprietario", "allow"], ["administrador", "allow"], ["administrador+motorista", "allow"], ["motorista", "permission-denied"], ["outro motorista", "permission-denied"], ["proprietário de outra empresa", "permission-denied"], ["anônimo", "unauthenticated"]];
  for (const [role, expected] of assignRoles) { await seed(); await row("designar operação", role, expected, a => assign({}, a)); }
  const startRoles = [["motorista", "allow"], ["outro motorista", "permission-denied"], ["proprietario", "permission-denied"], ["administrador", "permission-denied"], ["proprietário de outra empresa", "permission-denied"], ["anônimo", "unauthenticated"]];
  for (const [role, expected] of startRoles) { await seed(); const job = await assign(); await row("iniciar trabalho", role, expected, a => start(job.jobId, a)); }
  const manageRoles = [["proprietario", "allow"], ["administrador", "allow"], ["administrador+motorista", "allow"], ["motorista", "permission-denied"], ["outro motorista", "permission-denied"], ["proprietário de outra empresa", "permission-denied"], ["anônimo", "unauthenticated"]];
  for (const [role, expected] of manageRoles) { await seed(); const job = await assign(); await row("cancelar trabalho", role, expected, a => command({ action: "cancel", companyId: "a", jobId: job.jobId }, a)); }
  for (const [role, expected] of manageRoles) { await seed(); const job = await assign(); await row("trocar veículo", role, expected, a => command({ action: "changeVehicle", companyId: "a", jobId: job.jobId, vehicleId: "vehicle-a2" }, a)); }
  for (const [role, expected] of manageRoles) { await seed(); const job = await assign(); await cancel(job.jobId); await row("retirar da listagem (arquivar)", role, expected, a => command({ action: "archive", companyId: "a", jobId: job.jobId }, a)); }
  // Context: the right action in the WRONG company, and states that must refuse.
  await seed(); const foreign = await assign({ companyId: "a" });
  await row("cancelar trabalho de OUTRA empresa (não revela que ele existe)", "proprietário de outra empresa", "not-found", a => command({ action: "cancel", companyId: "b", jobId: foreign.jobId }, a));
  await row("cancelar com o proprietário da empresa A apontando para a empresa B", "proprietario", "not-found", a => command({ action: "cancel", companyId: "b", jobId: foreign.jobId }, a));
  await seed(); const done = await assign(); await start(done.jobId, ctx("driver-a")); await cancel(done.jobId);
  await row("iniciar trabalho já cancelado", "motorista", "failed-precondition", a => start(done.jobId, a));
  await seed(); const first = await assign(); await start(first.jobId, ctx("driver-a")); const second = await assign({ contractId: "contract-a" });
  await row("iniciar segundo trabalho com um em andamento", "motorista", "failed-precondition", a => start(second.jobId, a));
  await seed(); const again = await assign(); await start(again.jobId, ctx("driver-a"));
  await row("repetir o mesmo início (confirmação perdida)", "motorista", "allow", async a => { const r = await start(again.jobId, a); assert.equal(r.job.status, "active"); });
  await seed(); const active = await assign(); await start(active.jobId, ctx("driver-a"));
  await row("arquivar trabalho em andamento", "proprietario", "failed-precondition", a => command({ action: "archive", companyId: "a", jobId: active.jobId }, a));
}
try {
  await matrix();
  const failed = rows.filter(r => !r.ok);
  fs.mkdirSync("reports", { recursive: true });
  fs.writeFileSync("reports/role-matrix.json", JSON.stringify({ projectId, generatedAt: new Date().toISOString(), method: "Handlers reais do backend contra o emulador do Firestore; dados fictícios.", rows }, null, 2));
  const md = ["# Matriz por papel — comandos operacionais", "", "Fonte: `scripts/test-role-matrix-emulator.mjs` (handlers reais + emulador, dados fictícios).", "", "| Ação | Papel | Esperado | Obtido | OK |", "|---|---|---|---|---|",
    ...rows.map(r => `| ${r.action} | ${r.role} | ${r.expected} | ${r.actual} | ${r.ok ? "sim" : "**NÃO**"} |`), ""].join("\n");
  fs.writeFileSync("reports/role-matrix.md", md);
  console.log(`ROLE_MATRIX ${rows.length - failed.length}/${rows.length} PASS`);
  if (failed.length) process.exitCode = 1;
} finally { await environment.cleanup(); await admin.deleteApp(admin.app()); }
