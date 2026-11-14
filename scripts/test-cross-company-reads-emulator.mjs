import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, where, setDoc } from "firebase/firestore";

// Operational records (vehicles, trailers, contracts, sequences, jobs, demands) are readable only inside their company,
// plus a driver's own jobs/demands. Run against the real firestore.rules.
const projectId = "demo-nvu-v36-4-staging";
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^127\.0\.0\.1:\d+$/);
const env = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync("firestore.rules", "utf8") } });
const active = (uid, companyId, roles = ["driver"]) => [`company_access/${companyId}/members/${uid}`, { userId: uid, companyId, status: "active", roles, role: roles.includes("admin") ? "admin" : "driver", schemaVersion: 1 }];
await env.clearFirestore();
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  const rows = [
    ["frotas/a", { ownerId: "owner-a", userId: "owner-a", companyName: "A", status: "active" }], ["frotas/b", { ownerId: "owner-b", userId: "owner-b", companyName: "B", status: "active" }],
    ...["owner-a", "mem-a", "admin-a", "ex", "stranger", "mem-b"].map(u => [`users/${u}`, { name: u, status: "active" }]),
    active("mem-a", "a"), active("admin-a", "a", ["admin", "driver"]), active("owner-a", "a", ["owner", "admin", "driver"]), active("mem-b", "b"),
    ["company_access/a/members/ex", { userId: "ex", companyId: "a", status: "removed", roles: [], revokedAt: new Date() }],
    ["companyMembers/admin-a_a", { userId: "admin-a", companyId: "a", roles: ["admin", "driver"], status: "active" }],
    ["veiculos/va", { companyId: "a", name: "Truck A" }], ["veiculos/vb", { companyId: "b", name: "Truck B" }], ["reboques/ta", { companyId: "a" }],
    ["contratos/ca", { companyId: "a", name: "C" }], ["sequencias/sa", { companyId: "a" }], ["vehicles/la", { companyId: "a" }], ["trailers/la", { companyId: "a" }], ["contracts/la", { companyId: "a" }],
    ["trabalhos/ja1", { companyId: "a", driverId: "mem-a", status: "active" }], ["trabalhos/ja2", { companyId: "a", driverId: "admin-a", status: "active" }],
    ["trabalhos/jold", { companyId: "a", driverId: "ex", status: "completed" }], ["trabalhos/jb1", { companyId: "b", driverId: "mem-b", status: "active" }],
    ["trabalhos/jlegacy", { empresaId: "a", motoristaId: "mem-a", status: "completed" }],
    ["jobDemands/da1", { companyId: "a", driverId: "mem-a", status: "pending" }], ["jobDemands/dold", { companyId: "a", driverId: "ex", status: "pending" }],
    ["rankingParticipantOperations/mem-a", { userId: "mem-a", schemaVersion: 1, rows: [{ id: "ja1" }] }],
  ];
  for (const [path, data] of rows) await setDoc(doc(db, path), data);
});
const as = uid => env.authenticatedContext(uid).firestore();
const can = async fn => { try { await fn(); return true; } catch (e) { if (String(e.code).includes("permission-denied")) return false; throw e; } };
const list = (db, coll, ...c) => getDocs(query(collection(db, coll), ...c));
const results = [];
const probes = [
  [true, "member lists own company vehicles", "mem-a", db => list(db, "veiculos", where("companyId", "==", "a"))],
  [true, "member lists own company trailers", "mem-a", db => list(db, "reboques", where("companyId", "==", "a"))],
  [true, "member lists own company contracts", "mem-a", db => list(db, "contratos", where("companyId", "==", "a"))],
  [true, "member lists own company sequences", "mem-a", db => list(db, "sequencias", where("companyId", "==", "a"))],
  [true, "member reads own-company vehicle and contract by id", "mem-a", async db => { await getDoc(doc(db, "veiculos/va")); await getDoc(doc(db, "contratos/ca")); }],
  [true, "driver lists own jobs (app query)", "mem-a", db => list(db, "trabalhos", where("companyId", "==", "a"), where("driverId", "==", "mem-a"))],
  [true, "driver lists own demands (app query, no company filter)", "mem-a", db => list(db, "jobDemands", where("driverId", "==", "mem-a"), where("status", "==", "pending"))],
  [true, "member lists all jobs of own company", "mem-a", db => list(db, "trabalhos", where("companyId", "==", "a"))],
  [true, "admin lists all jobs and demands of own company", "admin-a", async db => { await list(db, "trabalhos", where("companyId", "==", "a")); await list(db, "jobDemands", where("companyId", "==", "a"), where("status", "==", "pending")); }],
  [true, "owner lists all jobs of own company", "owner-a", db => list(db, "trabalhos", where("companyId", "==", "a"))],
  [true, "reading a document that does not exist is 'not found', not 'denied'", "mem-a", async db => { assert.equal((await getDoc(doc(db, "contratos/never"))).exists(), false); assert.equal((await getDoc(doc(db, "trabalhos/never"))).exists(), false); }],
  [true, "ex-member lists and reads own job history", "ex", async db => { await list(db, "trabalhos", where("driverId", "==", "ex")); await getDoc(doc(db, "trabalhos/jold")); }],
  [true, "ex-member lists own demands", "ex", db => list(db, "jobDemands", where("driverId", "==", "ex"))],
  [true, "legacy job (motoristaId only) read by its driver", "mem-a", db => list(db, "trabalhos", where("motoristaId", "==", "mem-a"))],
  [true, "RANKING through the projection: any company reads a participant's compact rows", "mem-b", db => getDoc(doc(db, "rankingParticipantOperations/mem-a"))],
  [false, "member reads another company's vehicle", "mem-a", db => getDoc(doc(db, "veiculos/vb"))],
  [false, "member lists another company's vehicles", "mem-a", db => list(db, "veiculos", where("companyId", "==", "b"))],
  [false, "member lists another company's jobs", "mem-a", db => list(db, "trabalhos", where("companyId", "==", "b"))],
  [false, "member reads another company's job by id", "mem-a", db => getDoc(doc(db, "trabalhos/jb1"))],
  [false, "member lists another company's demands", "mem-a", db => list(db, "jobDemands", where("companyId", "==", "b"))],
  [false, "stranger lists a company's vehicles / jobs / contracts / sequences", "stranger", async db => { await list(db, "veiculos", where("companyId", "==", "a")); }],
  [false, "stranger lists a company's jobs", "stranger", db => list(db, "trabalhos", where("companyId", "==", "a"))],
  [false, "stranger reads one contract by id", "stranger", db => getDoc(doc(db, "contratos/ca"))],
  [false, "stranger lists a company's sequences", "stranger", db => list(db, "sequencias", where("companyId", "==", "a"))],
  [false, "another company lists a participant's jobs by driverId (the old Ranking read)", "mem-b", db => list(db, "trabalhos", where("driverId", "==", "mem-a"))],
  [false, "another company reads a participant's vehicle by id", "mem-b", db => getDoc(doc(db, "veiculos/va"))],
  [false, "ex-member lists the former company's jobs", "ex", db => list(db, "trabalhos", where("companyId", "==", "a"))],
  [false, "ex-member reads the former company's vehicle and contract", "ex", db => getDoc(doc(db, "veiculos/va"))],
  [false, "ex-member reads the former company's other drivers' demands", "ex", db => list(db, "jobDemands", where("companyId", "==", "a"))],
  [false, "legacy collections are closed too", "stranger", db => list(db, "vehicles", where("companyId", "==", "a"))],
  [false, "legacy trailers/contracts are closed too", "stranger", async db => { await list(db, "trailers", where("companyId", "==", "a")); }],
  [false, "unfiltered collection scan by a member is refused (cannot be proven to stay inside the company)", "mem-a", db => list(db, "veiculos")],
];
let failed = 0;
for (const [expected, name, uid, fn] of probes) {
  const allowed = await can(() => fn(as(uid)));
  const ok = allowed === expected; if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${expected ? "allow" : "deny "} ${name}${ok ? "" : ` (got ${allowed ? "allow" : "deny"})`}`);
}
// The same checks without any signed-in user.
const anonymous = env.unauthenticatedContext().firestore();
for (const [coll, id] of [["veiculos", "va"], ["trabalhos", "ja1"], ["contratos", "ca"], ["jobDemands", "da1"]]) {
  const allowed = await can(() => getDoc(doc(anonymous, `${coll}/${id}`)));
  if (allowed) { failed += 1; console.log(`FAIL anonymous reads ${coll}`); } else console.log(`PASS deny  anonymous cannot read ${coll}`);
}
await env.cleanup();
console.log(`CROSS_COMPANY_READS ${probes.length + 4 - failed}/${probes.length + 4} PASS`);
if (failed) process.exitCode = 1;
