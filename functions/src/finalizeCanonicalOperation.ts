import { operationTrailerId } from "./operationSnapshotFields";
import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";
import { active, buildCanonicalOperationProjection, field } from "./canonicalOperationProjection";

const safeId = (value: string) => value && !value.includes("/") ? value : "";
const notificationId = (uid: string, jobId: string) =>
  `${uid}_OPERATION_COMPLETED_${jobId}_${uid}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 1400);

/** Retryable server side effects; completion never depends on an open WebView. */
export async function settleCanonicalOperationCompletion(db: FirebaseFirestore.Firestore, jobId: string) {
  const jobRef = db.collection("trabalhos").doc(jobId);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(jobRef);
    const job = snapshot.data() || {};
    if (!snapshot.exists || job.status !== "completed" || job.deleted === true ||
        job.operationStatusUpdatedByCanonicalGateway !== true || job.operationCompletionEffectsCompletedAt) return false;
    const companyId = safeId(field(job, "companyId", "empresaId"));
    const contractId = safeId(field(job, "contractId", "contratoId"));
    const uid = safeId(field(job, "driverId", "motoristaId", "userId"));
    if (!companyId || !contractId || !uid) throw new Error("OPERATION_COMPLETION_SCOPE_INVALID");
    const [company, contract, driver, members, byJob, companyJobs, legacyJobs] = await Promise.all([
      tx.get(db.collection("frotas").doc(companyId)), tx.get(db.collection("contratos").doc(contractId)),
      tx.get(db.collection("users").doc(uid)),
      tx.get(db.collection("companyMembers").where("companyId", "==", companyId)),
      // Terminal effects must use the same physical execution boundary as the writers.
      tx.get(db.collection("historico_viagens").where("jobId", "==", jobId)),
      tx.get(db.collection("trabalhos").where("companyId", "==", companyId)),
      tx.get(db.collection("trabalhos").where("empresaId", "==", companyId)),
    ]);
    if (!company.exists || !contract.exists || field(contract.data() || {}, "companyId", "empresaId") !== companyId)
      throw new Error("OPERATION_COMPLETION_BINDING_INVALID");
    const rows = new Map(byJob.docs.map((row) => [row.id, row.data()]));
    const total = Number(job.totalDeliveries ?? contract.get("totalDeliveries"));
    const projection = buildCanonicalOperationProjection({ physicalJobId: jobId, operation: { ...job, id: jobId, totalDeliveries: total },
      confirmedHistory: [...rows].map(([id, data]) => ({ id, data })) });
    if (!Number.isInteger(total) || total < 1 || projection.confirmedTripCount < total) return false;

    const resources = [
      { collection: "veiculos", id: safeId(field(job, "vehicleId", "veiculoId")), keys: ["vehicleId", "veiculoId"] },
      { collection: "reboques", id: safeId(operationTrailerId(job, contract.data() || {})), keys: ["trailerId", "reboqueId"] },
    ].filter((resource) => resource.id);
    const assets = await Promise.all(resources.map((resource) => tx.get(db.collection(resource.collection).doc(resource.id))));
    const recipients = new Set<string>();
    for (const key of ["ownerId", "userId"]) {
      const recipient = safeId(field(company.data() || {}, key));
      if (recipient) recipients.add(recipient);
    }
    for (const member of members.docs) {
      const data = member.data();
      if ((data.status == null || data.status === "active") && Array.isArray(data.roles) && data.roles.includes("admin")) {
        const recipient = safeId(field(data, "userId"));
        if (recipient) recipients.add(recipient);
      }
    }
    const notifications = await Promise.all([...recipients].map(async (recipient) => {
      const ref = db.collection("notifications").doc(notificationId(recipient, jobId));
      return { recipient, ref, exists: (await tx.get(ref)).exists };
    }));
    const liveOtherJobs = [...companyJobs.docs, ...legacyJobs.docs].filter((row) => {
      const status = String(row.get("status") || "").toLowerCase();
      // Managed assignments reserve no resource before explicit start. Keep
      // the previous reservation interpretation for legacy jobs only.
      return row.id !== jobId && active(row.data()) && !["completed", "cancelled"].includes(status) &&
        (row.get("operationalCommandVersion") !== 1 || ["active", "delayed", "awaiting_completion"].includes(status));
    });
    const otherContractIds = [...new Set(liveOtherJobs.filter((row) => !field(row.data(), "trailerId", "reboqueId"))
      .map((row) => safeId(field(row.data(), "contractId", "contratoId"))).filter(Boolean))];
    const otherContracts = await Promise.all(otherContractIds.map((id) => tx.get(db.collection("contratos").doc(id))));
    const contractTrailers = new Map(otherContracts.filter((row) => row.exists &&
      field(row.data() || {}, "companyId", "empresaId") === companyId)
      .map((row) => [row.id, field(row.data() || {}, "trailerId", "reboqueId")]));
    for (const [index, asset] of assets.entries()) {
      const resource = resources[index];
      const shared = liveOtherJobs.some((row) => (field(row.data(), ...resource.keys) ||
        (resource.collection === "reboques" && row.get("operationalCommandVersion") !== 1 ? contractTrailers.get(field(row.data(), "contractId", "contratoId")) : "")) === resource.id);
      if (asset.exists && !shared && field(asset.data() || {}, "companyId", "empresaId") === companyId && asset.get("status") === "in_use")
        tx.update(asset.ref, { status: "available" });
    }
    const contractName = String(job.contractNameSnapshot || contract.get("name") || contract.get("nome") || "Contrato");
    const message = `${field(driver.data() || {}, "name", "displayName", "nome") || "O motorista"} concluiu a operação ${contractName}.`;
    const now = admin.firestore.FieldValue.serverTimestamp();
    for (const notification of notifications) {
      if (notification.exists) continue;
      tx.create(notification.ref, {
        userId: notification.recipient, companyId, targetProfile: "corporate", type: "OPERATION_COMPLETED",
        title: "Operação concluída", message, titulo: "Operação concluída", mensagem: message,
        tipo: "OPERATION_COMPLETED", read: false, lida: false, actorUserId: uid,
        metadata: { jobId, driverId: uid, contractId },
        dedupeKey: `OPERATION_COMPLETED_${jobId}_${notification.recipient}`, schemaVersion: 3,
        createdAt: now, createdAtIso: new Date().toISOString(),
      });
    }
    tx.update(jobRef, { operationCompletionEffectsCompletedAt: now });
    return true;
  });
}

export const finalizeCanonicalOperation = functions.region("us-central1").runWith({ failurePolicy: true })
  .firestore.document("trabalhos/{jobId}").onUpdate(async (change, context) => {
    const job = change.after.data();
    if (job.status !== "completed" || job.operationStatusUpdatedByCanonicalGateway !== true || job.operationCompletionEffectsCompletedAt) return;
    await settleCanonicalOperationCompletion(admin.firestore(), context.params.jobId);
  });
