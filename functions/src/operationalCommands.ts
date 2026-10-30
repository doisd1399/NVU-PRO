import { resolveAutomaticStart } from "./operationalQueues";
import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";
import { createHash } from "node:crypto";
import { text, field, fail, id, millis, manager, membership, assertAccount, assertCompany, driverEligibility, simulatorKey, maintenance, snapshot, assets, readOperationalPreparation } from "./operationalCommandPolicy";

type Data = Record<string, any>;
type Tx = FirebaseFirestore.Transaction;
type DB = FirebaseFirestore.Firestore;
type Context = functions.https.CallableContext;
type Action = "assign" | "start" | "startAutomatic" | "cancel" | "archive" | "changeVehicle";
const running = ["active", "delayed", "awaiting_completion"];
const terminal = ["completed", "cancelled"];
const digest = (v: unknown): string => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export const operationalDriverStateId = (companyId: string, driverId: string): string => digest([companyId, driverId]);
export const operationalCompletionId = (companyId: string, driverId: string, contractId: string): string => digest([companyId, driverId, contractId]);
function publicJob(job: Data, jobId: string): Data {
  const convert = (value: any): any => {
    if (value?.toDate && typeof value.toDate === "function") return value.toDate().toISOString();
    if (Array.isArray(value)) return value.map(convert);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convert(v)]));
    return value;
  };
  return { ...convert(job), id: jobId };
}
async function liveJobs(tx: Tx, db: DB, companyId: string, uid: string): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  // Activation rejects noncanonical open scopes. All subsequent managed writes
  // use these indexed fields; history is never scanned on each start.
  const rows = await tx.get(db.collection("trabalhos").where("companyId", "==", companyId).where("driverId", "==", uid).where("status", "in", running));
  return rows.docs.filter(row => row.get("deleted") !== true);
}
/** Reads only. Call before any transaction writes in the completion callable. */
export async function readOperationalCompletion(tx: Tx, db: DB, job: Data): Promise<{
  stateRef: FirebaseFirestore.DocumentReference; state: Data; progressRef: FirebaseFirestore.DocumentReference; progress: Data;
}> {
  const companyId = id(field(job, "companyId", "empresaId"), "Empresa");
  const driverId = id(field(job, "driverId", "motoristaId"), "Motorista");
  const contractId = id(field(job, "contractId", "contratoId"), "Operação");
  const stateRef = db.collection("operationalDriverStates").doc(operationalDriverStateId(companyId, driverId));
  const progressRef = db.collection("driverOperationCompletions").doc(operationalCompletionId(companyId, driverId, contractId));
  const [state, progress] = await Promise.all([tx.get(stateRef), tx.get(progressRef)]);
  return { stateRef, state: state.data() || {}, progressRef, progress: progress.data() || {} };
}
/** Applied with the canonical terminal transition, never by a delayed trigger. */
export function applyOperationalCompletion(tx: Tx, jobId: string, job: Data, data: Awaited<ReturnType<typeof readOperationalCompletion>>): void {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const companyId = field(job, "companyId", "empresaId"), driverId = field(job, "driverId", "motoristaId"), contractId = field(job, "contractId", "contratoId");
  if (data.state.currentJobId === jobId) tx.set(data.stateRef, { currentJobId: null, updatedAt: now }, { merge: true });
  tx.set(data.progressRef, { companyId, driverId, contractId, simulatorId: text(job.simulatorId) || null, completed: true,
    firstCompletedAt: data.progress.firstCompletedAt || now, lastCompletedAt: now, proofJobId: jobId, proofSource: "canonical-explicit-completion-v1", schemaVersion: 1 }, { merge: true });
}

/** A single transaction boundary reused by all v1 client operational actions. */
export async function executeOperationalCommand(db: DB, input: unknown, context: Context): Promise<Data> {
  const uid = context.auth?.uid;
  if (!uid) fail("unauthenticated", "Faça login para confirmar a operação.");
  const data = input && typeof input === "object" && !Array.isArray(input) ? input as Data : {};
  const action = text(data.action) as Action;
  if (!["assign", "start", "startAutomatic", "cancel", "archive", "changeVehicle"].includes(action)) fail("invalid-argument", "Ação operacional inválida.");
  const companyId = id(data.companyId, "Empresa"), requestId = id(data.requestId, "Pedido");
  const automatic = action === "startAutomatic";
  const creates = action === "assign" || automatic;
  const args: Data = automatic ? { companyId, queueId: id(data.queueId, "Fila"), contractId: id(data.contractId, "Operação"), vehicleId: id(data.vehicleId, "Veículo"), previewToken: id(data.previewToken, "Confirmação da fila"), configRevision: Number(data.configRevision) } : action === "assign" ? { companyId, contractId: id(data.contractId, "Operação"), driverId: id(data.driverId, "Motorista"), vehicleId: id(data.vehicleId, "Veículo"),
    trailerId: text(data.trailerId) || null, deadlineDays: data.deadlineDays == null ? null : Number(data.deadlineDays) } : action === "changeVehicle" ? { companyId, jobId: id(data.jobId, "Trabalho"), vehicleId: id(data.vehicleId, "Veículo") } : { companyId, jobId: id(data.jobId, "Trabalho") };
  const fingerprint = digest([action, args]);
  const requestRef = db.collection("operationalCommandRequests").doc(digest([uid, requestId]));
  // Deterministic across transport retries and processes, but bound to the actor.
  const generatedJobRef = db.collection("trabalhos").doc(`oc1_${digest([uid, requestId])}`);
  return db.runTransaction(async tx => {
    const previous = await tx.get(requestRef);
    if (previous.exists) {
      if (previous.get("actorId") !== uid || previous.get("fingerprint") !== fingerprint || previous.get("companyId") !== companyId) fail("failed-precondition", "Este pedido já foi utilizado com outros dados.");
      const saved = previous.get("result");
      const latest = await tx.get(db.collection("trabalhos").doc(saved.jobId));
      if (!latest.exists || field(latest.data() || {}, "companyId", "empresaId") !== companyId) fail("failed-precondition", "O trabalho confirmado precisa de conferência.");
      return { ...saved, currentJob: publicJob(latest.data() || {}, latest.id), replayed: true };
    }
    const [companyDoc, actorDoc, actorMembers] = await Promise.all([tx.get(db.collection("frotas").doc(companyId)), tx.get(db.collection("users").doc(uid!)), membership(tx, db, companyId, uid!)]);
    if (!companyDoc.exists || !actorDoc.exists) fail("permission-denied", "Conta ou empresa não encontrada.");
    const company = companyDoc.data() || {};
    assertAccount(actorDoc.data() || {});
    // Changing the vehicle of an existing job is also available to companies that have not opted in to the managed
    // commands: their jobs cannot be edited from the client (security rules), so this callable is the only writer.
    assertCompany(company, action !== "changeVehicle");
    const authorization = await tx.get(db.doc(`company_access/${companyId}/members/${uid}`));
    const isManager = manager(context, company, actorMembers, authorization.data() || {});
    const jobRef = creates ? generatedJobRef : db.collection("trabalhos").doc(args.jobId);
    const existing = creates ? null : await tx.get(jobRef);
    const old = existing?.data() || {};
    if (!creates && (!existing?.exists || field(old, "companyId", "empresaId") !== companyId)) fail("not-found", "O trabalho não pertence à empresa selecionada.");
    const driverId = automatic ? uid! : action === "assign" ? args.driverId : id(field(old, "driverId", "motoristaId"), "Motorista");
    if (((action === "start" || automatic) && driverId !== uid) || (action !== "start" && !automatic && !isManager)) fail("permission-denied", "Você não pode realizar esta ação nesta empresa.");
    const stateRef = db.collection("operationalDriverStates").doc(operationalDriverStateId(companyId, driverId));
    const stateDoc = await tx.get(stateRef), state = stateDoc.data() || {};
    const now = new Date().toISOString();
    let job: Data;
    const automaticSource = automatic ? await resolveAutomaticStart(tx, db, companyId, driverId, company, args) : null;
    if (action === "assign" || action === "start" || automatic) {
      if (action === "start" && running.includes(text(old.status))) {
        job = old; // Re-entering an existing operation does not allocate another.
      } else {
        if (action === "start" && old.status !== "pending") fail("failed-precondition", "A operação não está aguardando início.");
        await driverEligibility(tx, db, companyId, driverId);
        const contractId = creates ? args.contractId : id(field(old, "contractId", "contratoId"), "Operação");
        const contractDoc = await tx.get(db.collection("contratos").doc(contractId));
        const catalog = contractDoc.data() || {};
        if (!contractDoc.exists || catalog.companyId !== companyId || (creates && (catalog.deleted === true || catalog.status === "completed"))) fail("failed-precondition", "A operação não está disponível nesta empresa.");
        const immutable = old.operationalCommandVersion === 1 && old.contractSnapshot?.snapshotVersion === 1 ? old.contractSnapshot as Data : null;
        const key = await simulatorKey(tx, db, company, immutable || catalog);
        await maintenance(tx, db, key);
        const frozen = immutable || snapshot(catalog, contractId, companyId, key, action === "start" ? old.totalDeliveries : undefined);
        const vehicleId = creates ? args.vehicleId : id(field(old, "vehicleId", "veiculoId"), "Veículo");
        const trailerId = creates ? frozen.trailerId : old.operationalCommandVersion === 1 ? old.trailerId ?? null : frozen.trailerId;
        if (action === "assign" && args.trailerId !== trailerId) fail("failed-precondition", "O reboque da operação mudou. Atualize a seleção.");
        const resources = await assets(tx, db, companyId, vehicleId, trailerId);
        const days = action === "assign" && args.deadlineDays != null ? args.deadlineDays : frozen.deadlineDays;
        if (!Number.isSafeInteger(days) || days < 1 || !Number.isFinite(new Date(Date.now() + days * 86_400_000).getTime())) fail("invalid-argument", "Prazo inválido.");
        const oldDue = old.dueAt || old.deadlineDate;
        if (action === "start" && oldDue && !Number.isFinite(millis(oldDue))) fail("failed-precondition", "O prazo existente precisa ser conferido pela empresa.");
        const due = action === "start" && oldDue ? new Date(millis(oldDue)).toISOString() : new Date(Date.now() + days * 86_400_000).toISOString();
        const toISO = (value: any): string => Number.isFinite(millis(value)) ? new Date(millis(value)).toISOString() : now;
        job = { ...old, companyId, contractId, driverId, motoristaId: driverId, assignedDriverId: driverId, userId: old.userId || uid,
          vehicleId, vehicleName: immutable ? old.vehicleName : text(resources.vehicle.name), vehiclePlate: immutable ? old.vehiclePlate : text(resources.vehicle.plate),
          trailerId, trailerName: immutable ? old.trailerName : text(resources.trailer.name),
          contractName: frozen.name, contractNameSnapshot: frozen.name, contractSnapshot: { ...frozen, deadlineDays: days }, simulatorId: key,
          totalDeliveries: frozen.totalDeliveries, status: action === "assign" ? "pending" : "active", progress: Number(old.progress || 0),
          createdAt: toISO(old.createdAt), assignedAt: toISO(old.assignedAt), dueAt: due, deadlineDate: due,
          operationalCommandVersion: 1, operationalRevision: Number(old.operationalRevision || 0) + 1, operationReconciliationVersion: old.operationReconciliationVersion || 4,
          operationProgressReconciled: old.operationProgressReconciled ?? true, operationProjectionSource: old.operationProjectionSource || "new-operation-v4",
          ...(action === "start" || automatic ? { startedAt: old.startedAt || now } : {}),
          ...(automaticSource ? { queueId: automaticSource.queueId, queueRevision: automaticSource.configRevision, operationSource: "operational-queue-v1" } : {}), updatedAt: now };
        if (action === "start" || automatic) {
          const current = await liveJobs(tx, db, companyId, driverId);
          if (current.some(row => row.id !== jobRef.id)) fail("failed-precondition", "Você já possui uma operação em andamento. Finalize-a antes de iniciar outra.");
          // Also reject a live guard that cannot be accounted for by the query.
          if (text(state.currentJobId) && state.currentJobId !== jobRef.id) {
            const guarded = await tx.get(db.collection("trabalhos").doc(id(state.currentJobId, "Trabalho corrente")));
            if (!guarded.exists || !terminal.includes(text(guarded.get("status")))) fail("failed-precondition", "A operação corrente precisa ser conferida antes de outro início.");
          }
          tx.set(stateRef, { companyId, driverId, currentJobId: jobRef.id, assignmentRevision: Number(state.assignmentRevision || 0), updatedAt: admin.firestore.FieldValue.serverTimestamp(), schemaVersion: 1 });
          tx.update(db.collection("veiculos").doc(vehicleId), { status: "in_use" });
          if (trailerId) tx.update(db.collection("reboques").doc(trailerId), { status: "in_use" });
          if (automatic) tx.create(jobRef, job); else tx.set(jobRef, job);
        } else {
          const demands = await tx.get(db.collection("jobDemands").where("companyId", "==", companyId).where("driverId", "==", driverId).where("status", "==", "pending"));
          tx.set(stateRef, { companyId, driverId, assignmentRevision: Number(state.assignmentRevision || 0) + 1, schemaVersion: 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          tx.create(jobRef, job);
          demands.docs.forEach(demand => tx.update(demand.ref, { status: "reviewed" }));
        }
      }
    } else if (action === "archive") {
      if (!terminal.includes(text(old.status))) fail("failed-precondition", "Somente trabalhos encerrados podem ser retirados da listagem.");
      job = { ...old, archived: true, archivedAt: old.archivedAt || now, operationalRevision: Number(old.operationalRevision || 0) + 1 };
      tx.update(jobRef, { archived: true, archivedAt: job.archivedAt, operationalRevision: job.operationalRevision });
    } else if (action === "changeVehicle") {
      // Only the vehicle link changes: deliveries, deadline, progress and every recorded trip stay as they are.
      if (![...running, "pending"].includes(text(old.status))) fail("failed-precondition", "Somente trabalhos pendentes ou em andamento podem trocar de veículo.");
      const previousVehicleId = text(field(old, "vehicleId", "veiculoId"));
      if (args.vehicleId === previousVehicleId) fail("failed-precondition", "Este já é o veículo da operação.");
      const next = await assets(tx, db, companyId, args.vehicleId, null);
      const live = running.includes(text(old.status));
      const [previousAsset, others] = live && previousVehicleId
        ? await Promise.all([tx.get(db.collection("veiculos").doc(previousVehicleId)), tx.get(db.collection("trabalhos").where("companyId", "==", companyId).where("vehicleId", "==", previousVehicleId).where("status", "in", running))])
        : [null, null];
      const revision = Number(old.operationalRevision || 0) + 1;
      const changes = { vehicleId: args.vehicleId, vehicleName: text(next.vehicle.name), vehiclePlate: text(next.vehicle.plate), previousVehicleId: previousVehicleId || null, vehicleChangedAt: now, vehicleChangedBy: uid, operationalRevision: revision, updatedAt: now };
      job = { ...old, ...changes };
      tx.update(jobRef, changes);
      if (live) {
        tx.update(db.collection("veiculos").doc(args.vehicleId), { status: "in_use" });
        // A shared vehicle stays in use while another running job still links to it.
        if (previousAsset?.exists && previousAsset.get("companyId") === companyId && previousAsset.get("status") === "in_use" && !others!.docs.some(row => row.id !== jobRef.id && row.get("deleted") !== true))
          tx.update(previousAsset.ref, { status: "available" });
      }
    } else {
      if (old.status === "completed") fail("failed-precondition", "Uma operação concluída não pode ser cancelada.");
      if (![...running, "pending", "cancelled"].includes(text(old.status))) fail("failed-precondition", "Estado de trabalho inválido.");
      const resources = [
        { collection: "veiculos", id: field(old, "vehicleId", "veiculoId"), key: "vehicleId" },
        { collection: "reboques", id: field(old, "trailerId", "reboqueId"), key: "trailerId" },
      ].filter(r => r.id);
      const usage = await Promise.all(resources.map(async r => {
        const [asset, others] = await Promise.all([tx.get(db.collection(r.collection).doc(id(r.id, "Recurso"))), tx.get(db.collection("trabalhos").where("companyId", "==", companyId).where(r.key, "==", r.id).where("status", "in", running))]);
        return { asset, others: others.docs.filter(row => row.id !== jobRef.id && row.get("deleted") !== true) };
      }));
      job = { ...old, status: "cancelled", cancelledAt: old.cancelledAt || now, cancelledBy: uid, operationalRevision: Number(old.operationalRevision || 0) + 1 };
      tx.update(jobRef, { status: "cancelled", cancelledAt: job.cancelledAt, cancelledBy: uid, operationalRevision: job.operationalRevision });
      if (state.currentJobId === jobRef.id) tx.set(stateRef, { currentJobId: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      usage.forEach(({ asset, others }) => {
        if (asset.exists && asset.get("companyId") === companyId && asset.get("status") === "in_use" && !others.length) tx.update(asset.ref, { status: "available" });
      });
    }
    const result = { success: true, version: 1, action, requestId, jobId: jobRef.id, job: publicJob(job!, jobRef.id) };
    tx.create(requestRef, { actorId: uid, companyId, driverId, action, fingerprint, result, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return result;
  });
}

export const operationalCommand = functions.region("us-central1").https.onCall((input, context) => executeOperationalCommand(admin.firestore(), input, context));

export async function settleOperationalAssignment(db: DB, jobId: string): Promise<boolean> {
  return db.runTransaction(async tx => {
    const row = await tx.get(db.collection("trabalhos").doc(jobId)), job = row.data() || {};
    if (!row.exists || job.operationalCommandVersion !== 1 || job.status !== "pending") return false;
    const target = id(job.driverId, "Motorista"), companyId = id(job.companyId, "Empresa");
    const ref = db.collection("notifications").doc(`NEW_OPERATION_${jobId}_${target}`);
    const existing = await tx.get(ref);
    if (existing.exists) return false;
    const message = `Você recebeu a operação ${text(job.contractSnapshot?.name) || text(job.contractName)}.`;
    tx.create(ref, { userId: target, companyId, actorUserId: text(job.userId), targetProfile: "driver", type: "NEW_OPERATION",
      title: "Nova operação recebida", message, titulo: "Nova operação recebida", mensagem: message, tipo: "NEW_OPERATION",
      metadata: { jobId, contractId: job.contractId, vehicleId: job.vehicleId, trailerId: job.trailerId ?? null },
      dedupeKey: `NEW_OPERATION_${jobId}`, schemaVersion: 3, read: false, lida: false, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return true;
  });
}
export const notifyOperationalAssignment = functions.region("us-central1").runWith({ failurePolicy: true })
  .firestore.document("trabalhos/{jobId}").onCreate((_, context) => settleOperationalAssignment(admin.firestore(), context.params.jobId));

/** Explicit opt-in only. Dry-run is the default and never changes any data. */
export const prepareCompanyOperationalCommands = functions.region("us-central1").https.onCall(async (input: Data, context) => {
  const uid = context.auth?.uid;
  if (!uid) fail("unauthenticated", "Autenticação obrigatória.");
  const companyId = id(input?.companyId, "Empresa"), db = admin.firestore();
  return db.runTransaction(async tx => {
    const [companyDoc, actorDoc, members, authorization] = await Promise.all([
      tx.get(db.collection("frotas").doc(companyId)), tx.get(db.collection("users").doc(uid!)), membership(tx, db, companyId, uid!),
      tx.get(db.doc(`company_access/${companyId}/members/${uid}`)),
    ]);
    if (!companyDoc.exists || !actorDoc.exists || !manager(context, companyDoc.data() || {}, members, authorization.data() || {})) fail("permission-denied", "Permissão administrativa da empresa obrigatória.");
    assertAccount(actorDoc.data() || {});
    if (![undefined, 0, 1].includes(companyDoc.get("operationalCommandVersion"))) fail("failed-precondition", "Esta empresa usa outra versão da confirmação operacional.");
    const preparation = await readOperationalPreparation(tx, db, companyId);
    if (input?.enable === true) {
      if (!preparation.ready)
        fail(
          "failed-precondition",
          `A ativação precisa de revisão: ${preparation.conflicts.length} motorista(s) com trabalhos simultâneos e ${preparation.invalidScopes.length} trabalho(s) com cadastro inconsistente.`,
          {
            reasonCode: "LEGACY_OPERATION_PREPARATION_REQUIRED",
            conflictCount: preparation.conflicts.length,
            invalidCount: preparation.invalidScopes.length,
          },
        );
      if (companyDoc.get("operationalCommandVersion") !== 1) tx.update(companyDoc.ref, { operationalCommandVersion: 1, operationalCommandsEnabledAt: admin.firestore.FieldValue.serverTimestamp(), operationalCommandsEnabledBy: uid });
    }
    return {
      success: true,
      companyId,
      ...preparation,
      enabled: input?.enable === true || companyDoc.get("operationalCommandVersion") === 1,
      version: 1,
    };
  });
});
