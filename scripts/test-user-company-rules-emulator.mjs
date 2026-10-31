import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";

// Rules for users, companies, simulators, devices, company registrations and notifications, against the real rules file.
// WAVE=A: any signed-in user still reads users/* (first publication). WAVE=B (default): only the owner and the managers of
// the user's company read it.
const wave = (process.env.RULES_WAVE || "B").toUpperCase();
const rulesFile = process.env.RULES_FILE || "firestore.rules";
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^127\.0\.0\.1:\d+$/);
const env = await initializeTestEnvironment({ projectId: "demo-nvu-v36-4-staging", firestore: { rules: fs.readFileSync(rulesFile, "utf8") } });
await env.clearFirestore();
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  const rows = [
    ["frotas/a", { ownerId: "owner-a", userId: "owner-a", companyName: "A", status: "active" }], ["frotas/b", { ownerId: "owner-b", userId: "owner-b", companyName: "B", status: "active" }],
    ["users/owner-a", { name: "Dono", status: "active", companyId: "a" }], ["users/mgr-a", { name: "Gestor", status: "active", companyId: "a" }],
    ["users/drv-a", { name: "Motorista", email: "d@x.com", status: "active", companyId: "a" }], ["users/drv-b", { name: "Outro", status: "active", companyId: "b" }],
    ["users/mgr-b", { name: "Gestor B", status: "active", companyId: "b" }], ["users/senior", { name: "Senior", status: "active" }], ["users/stranger", { name: "S", status: "active" }],
    ["company_access/a/members/mgr-a", { userId: "mgr-a", companyId: "a", status: "active", roles: ["admin", "driver"] }],
    ["company_access/a/members/drv-a", { userId: "drv-a", companyId: "a", status: "active", roles: ["driver"] }],
    ["company_access/b/members/mgr-b", { userId: "mgr-b", companyId: "b", status: "active", roles: ["admin", "driver"] }],
    ["simulators/gto", { id: "gto", name: "GTO", active: true }],
    ["userDevices/drv-a_h1", { userId: "drv-a", token: "t" }],
    ["company_registrations/r1", { type: "company_registration", userId: "drv-a", companyName: "X", ownerName: "O", email: "d@x.com", simulatorId: "gto", status: "pending" }],
    ["notifications/n1", { userId: "drv-a", read: false, title: "t" }],
  ];
  for (const [path, data] of rows) await setDoc(doc(db, path), data);
});
const as = (uid, claims = {}) => env.authenticatedContext(uid, claims).firestore();
const can = async fn => { try { await fn(); return true; } catch (e) { if (String(e.code).includes("permission-denied")) return false; throw e; } };
const firstLogin = (id, extra = {}) => ({ id, email: `${id}@x.com`, name: "Novo", authPhotoURL: null, whatsapp: "", canonicalUserId: id, updatedAt: new Date().toISOString(), role: "driver", roles: ["driver"], status: "active", ...extra });
const senior = () => as("senior", { senior: true });
const probes = [
  // users: creation
  [true, "first login: the app creates the own user document with status 'active'", () => setDoc(doc(as("n1"), "users/n1"), firstLogin("n1"))],
  [true, "same with status 'pending'", () => setDoc(doc(as("n2"), "users/n2"), firstLogin("n2", { status: "pending" }))],
  [false, "a new user cannot create themselves as admin", () => setDoc(doc(as("n3"), "users/n3"), firstLogin("n3", { role: "admin", roles: ["admin", "driver"] }))],
  [wave === "A", "a new user creating themselves with a company or memberships: allowed only in wave A (old behaviour, not an authorization source)", () => setDoc(doc(as("n4"), "users/n4"), firstLogin("n4", { companyId: "a", memberships: { a: { role: "driver", roles: ["driver"], status: "active" } } }))],
  [false, "a new user cannot grant themselves the personal-profile flag", () => setDoc(doc(as("n5"), "users/n5"), firstLogin("n5", { driverProfileEnabled: true }))],
  [false, "an oversized name is refused", () => setDoc(doc(as("n6"), "users/n6"), firstLogin("n6", { name: "x".repeat(201) }))],
  [false, "a non-text WhatsApp is refused", () => setDoc(doc(as("n7"), "users/n7"), firstLogin("n7", { whatsapp: 11999990000 }))],
  [false, "nobody creates a user document for someone else", () => setDoc(doc(as("n8"), "users/someone-else"), firstLogin("someone-else"))],
  // users: update
  [true, "a user edits their own name and WhatsApp", () => updateDoc(doc(as("drv-a"), "users/drv-a"), { name: "Novo Nome", whatsapp: "11999990000" })],
  [false, "a user cannot set the personal-profile flag", () => updateDoc(doc(as("drv-a"), "users/drv-a"), { driverProfileEnabled: true })],
  [true, "the Senior can set the personal-profile flag", () => updateDoc(doc(senior(), "users/drv-a"), { driverProfileEnabled: true })],
  [false, "a user cannot save a name over 200 characters", () => updateDoc(doc(as("drv-a"), "users/drv-a"), { name: "y".repeat(201) })],
  [false, "a user cannot change their own company or roles", () => updateDoc(doc(as("drv-a"), "users/drv-a"), { companyId: "b", roles: ["admin"] })],
  // users: read
  [true, "a user reads their own document", () => getDoc(doc(as("drv-a"), "users/drv-a"))],
  [true, "a company manager reads a driver's document (trip moderation transaction)", () => getDoc(doc(as("mgr-a"), "users/drv-a"))],
  [true, "the owner of the company reads a driver's document", () => getDoc(doc(as("owner-a"), "users/drv-a"))],
  [wave === "A", "a signed-in stranger reads someone else's document", () => getDoc(doc(as("stranger"), "users/drv-a"))],
  [wave === "A", "a manager of another company reads the driver's document", () => getDoc(doc(as("mgr-b"), "users/drv-a"))],
  [wave === "A", "a driver reads a colleague's document", () => getDoc(doc(as("drv-a"), "users/owner-a"))],
  [false, "anonymous reads nothing", () => getDoc(doc(env.unauthenticatedContext().firestore(), "users/drv-a"))],
  // simulators
  [true, "anyone reads the simulators (login screen)", () => getDocs(collection(env.unauthenticatedContext().firestore(), "simulators"))],
  [false, "a signed-in non-senior cannot create a simulator", () => setDoc(doc(as("drv-a"), "simulators/x"), { id: "x", name: "X", active: true })],
  [false, "a signed-in non-senior cannot delete a simulator", () => deleteDoc(doc(as("mgr-a"), "simulators/gto"))],
  [true, "the Senior creates a simulator with the allowed fields", () => setDoc(doc(senior(), "simulators/ets2"), { id: "ets2", name: "ETS2", active: true, createdAt: "2026-10-31", updatedAt: "2026-10-31" })],
  [false, "the Senior cannot add unknown fields to a simulator", () => setDoc(doc(senior(), "simulators/pbs"), { id: "pbs", name: "PBS", active: true, logo: "x" })],
  [true, "the Senior deletes a simulator", () => deleteDoc(doc(senior(), "simulators/gto"))],
  // push devices
  [false, "a client cannot write a push device directly", () => setDoc(doc(as("drv-a"), "userDevices/drv-a_h2"), { userId: "drv-a", token: "t2" })],
  [false, "a client cannot change or delete a push device", () => updateDoc(doc(as("drv-a"), "userDevices/drv-a_h1"), { token: "t3" })],
  [true, "a client reads their own push device", () => getDoc(doc(as("drv-a"), "userDevices/drv-a_h1"))],
  [false, "a client cannot read someone else's push device", () => getDoc(doc(as("mgr-a"), "userDevices/drv-a_h1"))],
  // company registrations
  [true, "anyone submits a company registration", () => setDoc(doc(env.unauthenticatedContext().firestore(), "company_registrations/r2"), { type: "company_registration", companyName: "Y", ownerName: "O", email: "y@x.com", simulatorName: "GTO", status: "pending" })],
  [true, "the applicant reads their own registration", () => getDoc(doc(as("drv-a"), "company_registrations/r1"))],
  [false, "the applicant cannot change or delete their registration", () => updateDoc(doc(as("drv-a"), "company_registrations/r1"), { status: "approved" })],
  [false, "the applicant cannot delete their registration", () => deleteDoc(doc(as("drv-a"), "company_registrations/r1"))],
  [true, "the Senior approves a registration", () => updateDoc(doc(senior(), "company_registrations/r1"), { status: "approved" })],
  // companies
  [false, "a signed-in user cannot create a company for themselves", () => setDoc(doc(as("stranger"), "frotas/new"), { companyName: "N", ownerId: "stranger", userId: "stranger" })],
  [true, "the Senior creates a company", () => setDoc(doc(senior(), "frotas/new2"), { companyName: "N2", ownerId: "owner-a", userId: "owner-a" })],
  [false, "the Senior cannot create a company without a name", () => setDoc(doc(senior(), "frotas/new3"), { ownerId: "owner-a", userId: "owner-a" })],
  [true, "a manager edits their company", () => updateDoc(doc(as("owner-a"), "frotas/a"), { whatsapp: "11" })],
  [false, "a manager cannot blank the company name", () => updateDoc(doc(as("owner-a"), "frotas/a"), { companyName: "" })],
  [false, "a manager cannot move the company to another owner", () => updateDoc(doc(as("owner-a"), "frotas/a"), { ownerId: "stranger" })],
  // notifications
  [true, "a user marks a popup as shown", () => updateDoc(doc(as("drv-a"), "notifications/n1"), { popupShownAt: new Date(), popupShownAtIso: "2026-10-31T00:00:00Z" })],
  [false, "a user cannot rewrite the notification text", () => updateDoc(doc(as("drv-a"), "notifications/n1"), { title: "hack" })],
];
let failed = 0;
for (const [expected, name, fn] of probes) {
  const allowed = await can(fn);
  const ok = allowed === expected; if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${expected ? "allow" : "deny "} ${name}${ok ? "" : ` (got ${allowed ? "allow" : "deny"})`}`);
}
await env.cleanup();
console.log(`USER_COMPANY_RULES_${wave} ${probes.length - failed}/${probes.length} PASS`);
if (failed) process.exitCode = 1;
