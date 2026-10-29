import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { driverDisplayIdentity } from "../functions/src/driverDisplayIdentity";
import { receiptUploadFlight } from "../src/services/sync/receiptUploadFlight";

const checks: string[] = [];
const metrics: Record<string, any> = {};
async function test(name: string, run: () => unknown) { await run(); checks.push(name); console.log("PASS", name); }
const require = createRequire(import.meta.url);
const { makeEnv, Stamp } = require("./fixtures/fleet-membership-test-env.cjs");
const baseline = fs.readFileSync("verification/release-519/baseline-fleetMembership.cjs", "utf8");
const actor = { auth: { uid: "owner519", token: {} } };
const seed = () => ({
  "users/owner519": { status: "active", name: "Gestor" },
  "users/driver519": { status: "active", name: "Google antigo", email: "driver@example.test", companyId: "company519", memberships: {} },
  "frotas/company519": { ownerId: "owner519", companyName: "Empresa", simulatorId: "gto" },
  "companyMembers/driver519_company519": { userId: "driver519", companyId: "company519", roles: ["driver"], status: "active" },
  "company_access/company519/members/driver519": { roles: ["driver"], status: "active" },
  "recruitment_applications/app519": { userId: "driver519", email: "driver@example.test", companyId: "company519", type: "driver_application", status: "approved", isCurrent: true, fullName: "Nome NVU", applicationPhotoURL: "https://example.test/form.png" },
});

await test("Form identity wins over legacy Google copies; current independent profile edits win over the form", () => {
  const form = { ...seed()["recruitment_applications/app519"], id: "app519" };
  const user = { id: "driver519", name: "Google antigo", authPhotoURL: "https://lh3.googleusercontent.com/avatar", profilePhotoURL: "https://lh3.googleusercontent.com/avatar", approvedIdentityApplicationId: "app519" };
  assert.deepEqual(driverDisplayIdentity(user, form), { name: "Nome NVU", profilePhotoURL: "https://example.test/form.png" });
  assert.deepEqual(driverDisplayIdentity({ ...user, name: "Editado", profileNameSource: "user_edit", profilePhotoSource: "user_edit", profilePhotoURL: "" }, form), { name: "Editado", profilePhotoURL: "" });
  assert.equal(driverDisplayIdentity(user, { ...form, userId: "other" }).name, "Google antigo");
  assert.equal(driverDisplayIdentity(user).profilePhotoURL, "");
  assert.equal(driverDisplayIdentity({ ...user, approvedIdentityName: "Cadastro", approvedIdentityPhotoURL: "https://example.test/approved.png" }).name, "Cadastro");
});

await test("Removal reads only the affected driver's forms/requests and preserves another company", async () => {
  const rows: any = seed();
  for (let i = 0; i < 1500; i++) rows[`recruitment_applications/unrelated${i}`] = { userId: `other${i}`, companyId: "company519", status: "pending" };
  rows["recruitment_applications/another-company"] = { ...rows["recruitment_applications/app519"], companyId: "another-company" };
  const env = makeEnv(rows);
  await env.load("fleetMembership").manageFleetMembership({ action: "remove", companyId: "company519", targetUserId: "driver519", diagnosticId: "removal-519-test" }, actor);
  assert.equal(env.rows.get("recruitment_applications/app519").status, "rejected");
  assert.equal(env.rows.get("recruitment_applications/another-company").status, "approved");
  assert.equal(env.rows.get("recruitment_applications/unrelated1").status, "pending");
  assert(!env.reads.some((entry: string) => /^recruitment_applications\?/.test(entry) && entry.includes('"companyId"')));
  assert.equal(env.rows.get("company_access/company519/members/driver519").status, "removed");
});

await test("Parallel removal authorization eliminates one sequential read round under controlled latency", async () => {
  for (const [version, sources] of [["518", { "fleetMembership.js": baseline }], ["519", undefined]] as const) {
    const env = makeEnv(seed(), { sources, readDelayMs: 45 });
    const start = performance.now();
    await env.load("fleetMembership").manageFleetMembership({ action: "remove", companyId: "company519", targetUserId: "driver519", diagnosticId: "remove-timing-519" }, actor);
    metrics[version] = { controlledRemovalMs: Math.round(performance.now() - start), reads: env.reads.length };
  }
  assert(metrics["519"].controlledRemovalMs < metrics["518"].controlledRemovalMs * 0.9);
});

await test("Actual Print writer returns the committed scoped row, serializes timestamps and replays without another slot", async () => {
  const rows: any = seed();
  rows["users/driver519"].approvedIdentityName = "Nome Cadastro NVU";
  rows["contratos/contract519"] = { companyId: "company519", totalDeliveries: 10, mode: "simple" };
  rows["trabalhos/job519"] = { companyId: "company519", driverId: "driver519", contractId: "contract519", simulatorId: "gto", status: "active", progress: 0, totalDeliveries: 10, operationReconciliationVersion: 4 };
  const env = makeEnv(rows, { storageMetadata: { contentType: "image/png", size: 12000, metadata: { uploadedBy: "driver519" } } });
  const writer = env.load("registerCanonicalSimpleTrip").registerCanonicalSimpleTrip;
  const payload = { trip: { tripId: "print519", canonicalTripId: "print519", driverId: "driver519", companyId: "company519", contractId: "contract519", jobId: "job519", idempotencyKey: "print-attempt519", origem: "GA", destino: "SP", valor: 95, valorCents: 9500,
    simulatorCode: "GTO", source: "PRINT_PRO_REGISTRATION", imageHash: "hash519", gtoEntryMode: "print", gtoReceiptAnalyzed: true, gtoRewardedAdDetected: false,
    receiptText: "Concluido\nValor a receber: R$ 95,00\nReceber\nDobrar valor (ADS)", comprovanteUrl: "https://firebasestorage.googleapis.com/v0/b/demo-audit.appspot.com/o/trip-receipts%2Fcompany519%2Fdriver519%2Freceipt.png?alt=media" } };
  const result = await writer(payload, { auth: { uid: "driver519", token: {} } });
  assert.equal(result.canonicalAckVersion, 1); assert.equal(result.confirmedTrip.valorCents, 9500);
  assert.equal(result.confirmedTrip.motoristaNome, "Nome Cadastro NVU");
  assert.equal(result.confirmedTrip.id, "print519"); assert.equal(result.confirmedTrip.operationSlot, 1);
  assert.equal(typeof result.confirmedTrip.serverValidatedAt, "string");
  assert.equal(Date.parse(result.confirmedTrip.serverValidatedAt), env.rows.get("historico_viagens/print519").serverValidatedAt.toMillis());
  assert.equal(env.reads.filter((key: string) => key === "users/driver519").length, 1);
  assert.equal(env.reads.filter((key: string) => key === "frotas/company519").length, 1);
  const revokedRows = { ...rows, "company_access/company519/members/driver519": { status: "removed", revokedAt: "now" } };
  const revoked = makeEnv(revokedRows, { storageMetadata: { contentType: "image/png", size: 12000, metadata: { uploadedBy: "driver519" } } });
  await assert.rejects(revoked.load("registerCanonicalSimpleTrip").registerCanonicalSimpleTrip(payload, { auth: { uid: "driver519", token: {} } }), /vínculo/);
  assert(!revoked.rows.has("historico_viagens/print519"));
  const replay = await writer(payload, { auth: { uid: "driver519", token: {} } });
  assert.equal(replay.duplicate, true); assert.equal(replay.confirmedTrip.serverValidatedAt, result.confirmedTrip.serverValidatedAt);
  assert.equal(env.rows.get("trabalhos/job519").progress, 1);
  assert.equal([...env.rows.keys()].filter(key => key.startsWith("trip_operation_slots/")).length, 1);
  const failed = makeEnv(rows, { storageMetadata: { contentType: "image/png", size: 12000, metadata: { uploadedBy: "driver519" } } });
  failed.failNextCommit(); await assert.rejects(failed.load("registerCanonicalSimpleTrip").registerCanonicalSimpleTrip(payload, { auth: { uid: "driver519", token: {} } }));
  assert(!failed.rows.has("historico_viagens/print519"));
});

await test("Receipt preparation and submission share one upload; failure releases the flight for retry", async () => {
  let calls = 0; let release!: (value: string) => void;
  const work = () => { calls++; return new Promise<string>(resolve => { release = resolve; }); };
  const first = receiptUploadFlight("owner/company/hash", work);
  const second = receiptUploadFlight("owner/company/hash", work);
  assert.equal(first, second); await Promise.resolve(); assert.equal(calls, 1);
  release("https://example.test/receipt"); await first;
  await assert.rejects(receiptUploadFlight("failed", async () => { throw Error("offline"); }), /offline/);
  assert.equal(await receiptUploadFlight("failed", async () => "retried"), "retried");
});

// Execute the actual adapter with injected transports. Any unexpected network
// or Firestore read throws. This checks the normal inline-ACK path end to end.
const compiled = await build({ stdin: { contents: 'export { FirebaseTripSyncAdapter } from "./src/services/sync/FirebaseTripSyncAdapter";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{ name: "isolated-transports", setup(builder) {
    builder.onResolve({ filter: /^firebase\/(firestore|functions)$/ }, args => ({ path: args.path, namespace: "fake" }));
    builder.onLoad({ filter: /.*/, namespace: "fake" }, args => ({ contents: args.path.endsWith("firestore")
      ? 'export const doc=(_db,_collection,id)=>({id}); export const getDocFromServer=(ref)=>globalThis.__qa519.read(ref); export const runTransaction=()=>{throw Error("unexpected transaction")}; export const serverTimestamp=()=>"server";'
      : 'export const httpsCallable=()=>()=>{throw Error("unexpected callable")};' }));
    builder.onLoad({ filter: /src\/lib\/firebase\.ts$/ }, () => ({ contents: 'export const auth={currentUser:null}; export const db={}; export const functions={};', loader: "ts" }));
    builder.onLoad({ filter: /src\/lib\/offlineReceiptStore\.ts$/ }, () => ({ contents: 'export const getOfflineReceipt=()=>{throw Error("unexpected receipt read")}; export const markOfflineReceiptUploaded=()=>{};', loader: "ts" }));
    builder.onLoad({ filter: /src\/services\/uploadService\.ts$/ }, () => ({ contents: 'export const uploadService={uploadImage:()=>{throw Error("unexpected upload")}};', loader: "ts" }));
  } }] });
const modulePath = path.resolve("verification/release-519/adapter-isolated.mjs"); fs.writeFileSync(modulePath, compiled.outputFiles[0].text);
const { FirebaseTripSyncAdapter } = await import(modulePath);
const trip: any = { tripId: "trip519", canonicalTripId: "trip519", driverId: "driver519", companyId: "company519", jobId: "job519", contractId: "contract519", idempotencyKey: "attempt519", origem: "GA", destino: "SP", valor: 95, valorCents: 9500 };
const confirmed = { ...trip, id: trip.tripId, serverValidatedAt: new Date().toISOString(), status: "concluida", operationSlot: 7 };
let reads = 0;
(globalThis as any).__qa519 = { read: async () => { reads++; return { id: trip.tripId, exists: () => true, data: () => confirmed }; } };
await test("Committed inline ACK confirms the trip without a second server read", async () => {
  const adapter = new FirebaseTripSyncAdapter({ firestore: {}, getCurrentUser: () => ({ uid: "driver519" }), registerCanonicalTrip: async () => ({ data: { registered: true, tripId: trip.tripId, canonicalAckVersion: 1, confirmedTrip: confirmed } }) });
  const result = await adapter.push(trip); assert.equal(result.confirmed, true); assert.equal(reads, 0); assert.equal(result.data.operationSlot, 7);
});
await test("An old writer remains compatible and mismatched inline confirmations are rejected", async () => {
  const old = new FirebaseTripSyncAdapter({ firestore: {}, getCurrentUser: () => ({ uid: "driver519" }), registerCanonicalTrip: async () => ({ data: { registered: true, tripId: trip.tripId } }) });
  await old.push(trip); assert.equal(reads, 1);
  const invalid = new FirebaseTripSyncAdapter({ firestore: {}, getCurrentUser: () => ({ uid: "driver519" }), registerCanonicalTrip: async () => ({ data: { registered: true, tripId: trip.tripId, canonicalAckVersion: 1, confirmedTrip: { ...confirmed, companyId: "other" } } }) });
  await assert.rejects(invalid.push(trip), /SCOPE_MISMATCH/); assert.equal(reads, 1);
});
await test("Prepared receipt is reused and is never registered before upload confirmation", async () => {
  let uploaded = false; let uploads = 0; let release!: () => void; let marked = 0;
  const receipt: any = { userId: "driver519", companyId: "company519", blob: new Blob(["test"]), fileName: "receipt.png", contentType: "image/png" };
  const adapter = new FirebaseTripSyncAdapter({ firestore: {}, getCurrentUser: () => ({ uid: "driver519" }), loadOfflineReceipt: async () => receipt,
    markReceiptUploaded: async (_key: string, url: string) => { marked++; receipt.uploadedUrl = url; },
    uploadReceipt: async () => { uploads++; await new Promise<void>(resolve => { release = resolve; }); uploaded = true; return "https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/receipt.png?alt=media"; },
    registerCanonicalTrip: async () => { assert(uploaded); return { data: { registered: true, tripId: trip.tripId, canonicalAckVersion: 1, confirmedTrip: confirmed } }; } });
  const preparation = adapter.prepareReceipt("receipt519", "driver519", "company519");
  await new Promise(resolve => setTimeout(resolve, 0));
  const submission = adapter.push({ ...trip, offlineReceiptKey: "receipt519" });
  await Promise.resolve(); assert.equal(uploads, 1); release(); await preparation; await submission;
  assert.equal(uploads, 1); assert.equal(marked, 1);
  await adapter.push({ ...trip, offlineReceiptKey: "receipt519" }); assert.equal(uploads, 1);
});

const uploadBundle = await build({ entryPoints: ["src/services/uploadService.ts"], bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{ name: "isolated-storage", setup(builder) {
    builder.onResolve({ filter: /^firebase\/(storage|functions)$/ }, args => ({ path: args.path, namespace: "storage-fake" }));
    builder.onLoad({ filter: /.*/, namespace: "storage-fake" }, args => ({ contents: args.path.endsWith("functions")
      ? 'export const httpsCallable=()=>async()=>{const s=globalThis.__upload519;s.ensures++;if(s.refuseRepair)throw Error("membership refused");};'
      : 'export const ref=(_s,path)=>({path}); export const getDownloadURL=async()=>"https://firebasestorage.googleapis.com/v0/b/demo/o/receipt.png?alt=media"; export const uploadBytes=async(ref,file)=>{const s=globalThis.__upload519;s.uploads++;s.bytes=file.size;s.direct=true;if(s.alwaysDenied||(s.denyFirst&&s.uploads===1))throw {code:"storage/unauthorized"};return {ref};}; export const uploadBytesResumable=(ref)=>{const s=globalThis.__upload519;s.uploads++;const denied=s.alwaysDenied||(s.denyFirst&&s.uploads===1);return {snapshot:{ref},cancel(){},on(_name,_progress,error,complete){queueMicrotask(()=>denied?error({code:"storage/unauthorized"}):complete());}}};' }));
    builder.onLoad({ filter: /src\/lib\/firebase\.ts$/ }, () => ({ contents: 'export const auth={authStateReady:async()=>{},get currentUser(){return {uid:"driver519"}}};export const functions={};export const storage={};', loader: "ts" }));
  } }] });
const uploadPath = path.resolve("verification/release-519/upload-isolated.mjs"); fs.writeFileSync(uploadPath, uploadBundle.outputFiles[0].text);
const { uploadService } = await import(uploadPath);
await test("Actual upload service skips membership RPC normally and repairs one Storage denial without relaxing rules", async () => {
  const options = { file: new File(["small receipt"], "receipt.png", { type: "image/png" }), companyId: "company519", userId: "driver519", storageScope: "trip-receipt" };
  let state = (globalThis as any).__upload519 = { uploads: 0, ensures: 0 };
  await uploadService.uploadImage(options); assert.equal(state.uploads, 1); assert.equal(state.ensures, 0); assert.equal(state.direct, true);
  state = (globalThis as any).__upload519 = { uploads: 0, ensures: 0, denyFirst: true };
  await uploadService.uploadImage(options); assert.equal(state.uploads, 2); assert.equal(state.ensures, 1);
  state = (globalThis as any).__upload519 = { uploads: 0, ensures: 0, alwaysDenied: true };
  await assert.rejects(uploadService.uploadImage(options)); assert.equal(state.uploads, 2); assert.equal(state.ensures, 1);
  state = (globalThis as any).__upload519 = { uploads: 0, ensures: 0, denyFirst: true, refuseRepair: true };
  await assert.rejects(uploadService.uploadImage(options), /membership refused/); assert.equal(state.uploads, 1); assert.equal(state.ensures, 1);
});

fs.mkdirSync("reports/release-520", { recursive: true });
fs.writeFileSync("reports/release-520/performance-tests.json", JSON.stringify({ checks: checks.length, passed: checks, metrics, productionBenchmark: false,
  method: "Actual adapter bundled with injected transports; compiled backend with transactional fixtures; controlled 45 ms read latency. No physical-device timing claim." }, null, 2));
console.log("PERFORMANCE_520_PASS", checks.length);
