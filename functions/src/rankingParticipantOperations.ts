import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";

type Data = FirebaseFirestore.DocumentData;
type DB = FirebaseFirestore.Firestore;

/**
 * Ranking projection: for each participant, the few facts the Ranking needs to show "current vehicle" (which operation is
 * current or was used last, with which vehicle and which simulator evidence). It replaces the viewer reading another
 * company's whole job history and vehicle documents. Only the server writes it; every signed-in user may read it.
 *
 * The row keeps exactly the fields the client's selection rules read, so the same code picks the same operation from
 * the projection as from the full history (see scripts/test-ranking-participant-equivalence.mts).
 */
export const COLLECTION = "rankingParticipantOperations";
export const SCHEMA_VERSION = 1;
const OWNER_FIELDS = ["driverId", "motoristaId", "motorista_id", "assignedDriverId", "driver_id"] as const;
const QUERY_FIELDS = [...OWNER_FIELDS, "userId"] as const;
const SIMULATOR_FIELDS = ["simulatorId", "simuladorId", "simulatorName", "simuladorNome", "simulator"] as const;
const RUNNING = ["active", "awaiting_completion", "delayed"];
const NEVER_USED = ["cancelled", "canceled", "invalid"];
/** A participant's rows stay small: running jobs, plus the newest used jobs of each company/simulator. */
const MAX_USED_PER_GROUP = 10, MAX_ROWS = 60;

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const status = (job: Data) => text(job.status).toLowerCase();
const millis = (value: any): number => {
  if (!value) return 0;
  try {
    const result = typeof value?.toMillis === "function" ? value.toMillis() : typeof value?.toDate === "function" ? value.toDate().getTime()
      : typeof value === "object" && "seconds" in value ? Number(value.seconds) * 1000 : typeof value === "number" ? value : new Date(value).getTime();
    return Number.isFinite(result) && result > 0 ? result : 0;
  } catch { return 0; }
};

/** Same owner rule as the client: a driver field wins, `userId` only when no driver field exists. */
export function ownerOfJob(job: Data): string {
  for (const field of OWNER_FIELDS) { const value = text(job[field]); if (value) return value; }
  return text(job.userId);
}
const companyOf = (job: Data) => text(job.companyId) || text(job.empresaId);
const vehicleOf = (job: Data) => text(job.vehicleId) || text(job.veiculoId);
const pick = (source: Data, keys: readonly string[]) => Object.fromEntries(keys.flatMap(key => typeof source[key] === "string" && source[key].trim() ? [[key, source[key].trim()]] : []));

export type Row = Data;

/** The part of a job the Ranking logic reads. Fields that change on every trip (progress, receipts) are not part of it. */
export function reduceJobRow(jobId: string, job: Data): Row | null {
  const owner = ownerOfJob(job), state = status(job);
  if (!owner) return null;
  const startedAt = millis(job.startedAt) || millis(job.started_at), completedAt = millis(job.completedAt) || millis(job.completed_at);
  const used = RUNNING.includes(state) || state === "completed" || ((startedAt || completedAt) && vehicleOf(job) && !NEVER_USED.includes(state));
  if (!used) return null;
  const assignedAt = millis(job.assignedAt), createdAt = millis(job.createdAt);
  const row: Row = { id: jobId, driverId: owner, companyId: companyOf(job), status: state,
    assignedAt: assignedAt || null, startedAt: startedAt || null, createdAt: createdAt || null, completedAt: completedAt || null,
    vehicleId: vehicleOf(job) || null, vehicleName: text(job.vehicleName) || null, ...pick(job, SIMULATOR_FIELDS) };
  if (job.operationalCommandVersion === 1) row.operationalCommandVersion = 1;
  // `updatedAt` only orders a job that has no other timestamp; otherwise it would rewrite the row on every update.
  if (!assignedAt && !millis(job.startedAt) && !createdAt) row.updatedAt = millis(job.updatedAt) || null;
  return row;
}

const assignmentAt = (row: Row) => row.assignedAt || row.startedAt || row.createdAt || row.updatedAt || 0;
const groupOf = (row: Row) => JSON.stringify([row.companyId, ...SIMULATOR_FIELDS.map(key => row[key] || "")]);

/** Applies the size limits. `truncated` tells a later removal that it cannot know what was left out. */
export function limitRows(rows: Row[]): { rows: Row[]; truncated: boolean } {
  const sorted = [...rows].sort((a, b) => assignmentAt(b) - assignmentAt(a) || String(b.id).localeCompare(String(a.id)));
  // Running jobs decide "current operation": they are never dropped. Only the history of used jobs is limited.
  const running = sorted.filter(row => RUNNING.includes(row.status)), used: Row[] = [], seen = new Map<string, number>();
  let truncated = false;
  for (const row of sorted) {
    if (RUNNING.includes(row.status)) continue;
    const group = groupOf(row), count = seen.get(group) || 0;
    if (count >= MAX_USED_PER_GROUP) { truncated = true; continue; }
    seen.set(group, count + 1); used.push(row);
  }
  const room = Math.max(MAX_ROWS - running.length, MAX_USED_PER_GROUP);
  if (used.length > room) { used.length = room; truncated = true; }
  const kept = [...running, ...used].sort((a, b) => assignmentAt(b) - assignmentAt(a) || String(b.id).localeCompare(String(a.id)));
  return { rows: kept, truncated };
}

/** Vehicle facts the client used to read from `veiculos/{id}`: name and simulator evidence. */
async function readVehicles(db: DB, ids: string[]): Promise<Map<string, Data | null>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const result = new Map<string, Data | null>();
  if (!unique.length) return result;
  const snapshots = await db.getAll(...unique.map(id => db.collection("veiculos").doc(id)));
  snapshots.forEach(snapshot => result.set(snapshot.id, snapshot.exists
    ? { id: snapshot.id, ...(text(snapshot.get("name")) ? { name: text(snapshot.get("name")) } : {}), ...pick(snapshot.data() || {}, SIMULATOR_FIELDS) } : null));
  return result;
}
const withVehicle = (row: Row, vehicles: Map<string, Data | null>): Row => ({ ...row, vehicle: row.vehicleId ? vehicles.get(row.vehicleId) ?? null : null });

const projectionRef = (db: DB, uid: string) => db.collection(COLLECTION).doc(uid);
const rowsKey = (rows: Row[]) => JSON.stringify(rows);

/** Full rebuild from the participant's job history. Idempotent; used to create a projection and to repair one. */
export async function rebuildParticipantOperations(db: DB, uid: string, options: { force?: boolean } = {}): Promise<Data> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const before = await projectionRef(db, uid).get();
    if (before.exists && !options.force) return before.data() || {};
    const revision = Number(before.get("revision") || 0);
    const found = new Map<string, Data>();
    for (const snapshot of await Promise.all(QUERY_FIELDS.map(field => db.collection("trabalhos").where(field, "==", uid).get())))
      snapshot.docs.forEach(row => { if (ownerOfJob(row.data()) === uid) found.set(row.id, row.data()); });
    const reduced = [...found].flatMap(([id, job]) => { const row = reduceJobRow(id, job); return row ? [row] : []; });
    const limited = limitRows(reduced);
    const vehicles = await readVehicles(db, limited.rows.map(row => row.vehicleId));
    const doc = { userId: uid, schemaVersion: SCHEMA_VERSION, rows: limited.rows.map(row => withVehicle(row, vehicles)), truncated: limited.truncated,
      revision: revision + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    const written = await db.runTransaction(async tx => {
      const current = await tx.get(projectionRef(db, uid));
      // A trigger changed it while the history was read: read again instead of overwriting newer information.
      if (Number(current.get("revision") || 0) !== revision) return false;
      if (current.exists && !options.force) return false;
      tx.set(projectionRef(db, uid), doc);
      return true;
    });
    if (written) return { ...doc, updatedAt: undefined };
  }
  throw new functions.https.HttpsError("aborted", "A leitura do histórico mudou durante a atualização. Tente novamente.");
}

/** Incremental update for one job: reads the job fresh, so late or repeated events are harmless. */
export async function applyJobToParticipant(db: DB, uid: string, jobId: string): Promise<void> {
  const existing = await projectionRef(db, uid).get();
  if (!existing.exists) { await rebuildParticipantOperations(db, uid); return; }
  let needsRebuild = false;
  await db.runTransaction(async tx => {
    needsRebuild = false;
    const [current, jobSnap] = await Promise.all([tx.get(projectionRef(db, uid)), tx.get(db.collection("trabalhos").doc(jobId))]);
    if (!current.exists) { needsRebuild = true; return; }
    const stored: Row[] = Array.isArray(current.get("rows")) ? current.get("rows") : [];
    const job = jobSnap.exists ? jobSnap.data() || {} : null;
    const base = job && ownerOfJob(job) === uid ? reduceJobRow(jobId, job) : null;
    const previous = stored.find(row => row.id === jobId);
    let vehicles = new Map<string, Data | null>();
    if (base?.vehicleId) { const v = await tx.get(db.collection("veiculos").doc(base.vehicleId)); vehicles = new Map([[base.vehicleId, v.exists
      ? { id: v.id, ...(text(v.get("name")) ? { name: text(v.get("name")) } : {}), ...pick(v.data() || {}, SIMULATOR_FIELDS) } : null]]); }
    const next = base ? withVehicle(base, vehicles) : null;
    if (rowsKey(previous ? [previous] : []) === rowsKey(next ? [next] : [])) return;
    // Removing a row from a truncated list could uncover rows that were left out: rebuild instead of guessing.
    if (!next && previous && current.get("truncated") === true) { needsRebuild = true; return; }
    const rows = [...stored.filter(row => row.id !== jobId), ...(next ? [next] : [])];
    const limited = limitRows(rows);
    tx.set(projectionRef(db, uid), { userId: uid, schemaVersion: SCHEMA_VERSION, rows: limited.rows, truncated: limited.truncated || current.get("truncated") === true,
      revision: Number(current.get("revision") || 0) + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  if (needsRebuild) await rebuildParticipantOperations(db, uid, { force: true });
}

/** The row fields this trigger cares about, to skip the many job updates (progress, receipts) that do not change them. */
const fingerprint = (id: string, job: Data | undefined) => JSON.stringify(job ? [ownerOfJob(job), reduceJobRow(id, job)] : null);

export const syncRankingParticipantOperations = functions.region("us-central1").firestore.document("trabalhos/{jobId}").onWrite(async (change, context) => {
  const jobId = context.params.jobId as string;
  const before = change.before.exists ? change.before.data() : undefined, after = change.after.exists ? change.after.data() : undefined;
  if (fingerprint(jobId, before) === fingerprint(jobId, after)) return;
  const owners = new Set([before, after].flatMap(job => job ? [ownerOfJob(job)] : []).filter(Boolean));
  for (const uid of owners) await applyJobToParticipant(admin.firestore(), uid, jobId);
});

const VEHICLE_FIELDS = ["name", ...SIMULATOR_FIELDS];
/** A renamed vehicle or corrected simulator is part of the participant's rows: rebuild those participants. */
export const syncRankingVehicleChange = functions.region("us-central1").firestore.document("veiculos/{vehicleId}").onUpdate(async (change, context) => {
  const before = change.before.data() || {}, after = change.after.data() || {};
  if (VEHICLE_FIELDS.every(field => text(before[field]) === text(after[field]))) return;
  const db = admin.firestore(), vehicleId = context.params.vehicleId as string;
  const jobs = await db.collection("trabalhos").where("vehicleId", "==", vehicleId).get();
  const owners = [...new Set(jobs.docs.flatMap(row => { const owner = ownerOfJob(row.data()); return owner ? [owner] : []; }))].slice(0, 200);
  for (const uid of owners) {
    if ((await projectionRef(db, uid).get()).exists) await rebuildParticipantOperations(db, uid, { force: true });
  }
});

/**
 * Lazy creation: a viewer asks for a participant whose projection does not exist yet and the server builds it from the
 * history once. Later job changes keep it current through the trigger. Only reads and writes the projection.
 */
export const ensureRankingParticipantOperations = functions.region("us-central1").https.onCall(async (input, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Faça login para continuar.");
  const uid = text(input?.participantId);
  if (!uid || uid.length > 180 || /[\/\0]/.test(uid) || uid === "." || uid === "..") throw new functions.https.HttpsError("invalid-argument", "Participante inválido.");
  const doc = await rebuildParticipantOperations(admin.firestore(), uid);
  return { success: true, participantId: uid, schemaVersion: SCHEMA_VERSION, rows: doc.rows || [], truncated: doc.truncated === true };
});
