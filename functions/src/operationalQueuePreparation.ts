import * as admin from "./firebaseAdmin";
import { createHash } from "node:crypto";
import { driverEligibility, fail, field, id, text } from "./operationalCommandPolicy";
import type { OperationalPreparation } from "./operationalPreparationModel";

type Data = Record<string, any>;
type Write = { ref: FirebaseFirestore.DocumentReference; data: Data; merge?: boolean };

/** Plan a manager-confirmed repair; reads only until the queue transaction commits. */
export async function planQueuePreparationRepair(
  tx: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  companyId: string,
  uid: string,
  input: Data,
  preparation: OperationalPreparation,
): Promise<{ writes: Write[]; audit: Data }> {
  if (input.confirmed !== true)
    fail("invalid-argument", "Confirme a revisão dos trabalhos indicados.");
  if (!text(input.preparationToken) || input.preparationToken !== preparation.token)
    fail("aborted", "Os trabalhos mudaram. Atualize a conferência antes de confirmar.");
  const now = admin.firestore.FieldValue.serverTimestamp(), writes: Write[] = [];
  if (input.action === "normalizeLegacyJobs") {
    if (!Array.isArray(input.jobIds) || !input.jobIds.length || input.jobIds.length > 30)
      fail("invalid-argument", "Selecione de 1 a 30 trabalhos para corrigir.");
    const selected: string[] = input.jobIds.map((value: unknown) => id(value, "Trabalho"));
    if (new Set(selected).size !== selected.length)
      fail("invalid-argument", "Há trabalhos repetidos na seleção.");
    const before: Data[] = [];
    for (const jobId of selected) {
      const diagnostic = preparation.jobs.find((job) => job.jobId === jobId);
      if (!diagnostic?.canNormalize)
        fail("failed-precondition", "Este trabalho exige revisão dos dados pela empresa.");
      const row = await tx.get(db.doc(`trabalhos/${jobId}`)), data = row.data() || {};
      const normalized = { ...data, ...diagnostic!.patch };
      const refs = [db.doc(`contratos/${id(normalized.contractId, "Operação")}`),
        db.doc(`veiculos/${id(normalized.vehicleId, "Veículo")}`),
        ...(text(normalized.trailerId) ? [db.doc(`reboques/${id(normalized.trailerId, "Reboque")}`)] : [])];
      const references = await tx.getAll(...refs);
      if (references.some((ref) => !ref.exists || ref.get("companyId") !== companyId || ref.get("deleted") === true))
        fail("failed-precondition", `O cadastro da operação, veículo ou reboque do trabalho ${jobId} precisa ser conferido.`);
      await driverEligibility(tx, db, companyId, id(normalized.driverId, "Motorista"), true);
      // Only explicitly derived scope fields and spelling of an existing state change.
      // Progress, receipts, deadlines, physical job ID and snapshots are preserved.
      writes.push({ ref: row.ref, data: { ...diagnostic!.patch,
        operationalScopeNormalizedAt: now, operationalScopeNormalizedBy: uid } });
      before.push({ jobId, before: Object.fromEntries(Object.keys(diagnostic!.patch)
        .map((key) => [key, data[key] ?? null])), patch: diagnostic!.patch });
    }
    return { writes, audit: { normalizedJobs: before } };
  }
  const driverId = id(input.driverId, "Motorista"), keepJobId = id(input.keepJobId, "Trabalho a manter");
  const conflict = preparation.conflicts.find((row) => row.driverId === driverId);
  if (!conflict || !conflict.jobIds.includes(keepJobId) || conflict.jobIds.length > 30)
    fail("failed-precondition", "Escolha o trabalho a manter entre as operações em conflito (até 30 por revisão).");
  if (conflict!.jobIds.some((jobId) => preparation.invalidScopes.includes(jobId)))
    fail("failed-precondition", "Confira os identificadores desses trabalhos antes de resolver a duplicidade.");
  const cancelIds = conflict!.jobIds.filter((jobId) => jobId !== keepJobId);
  const rows = await tx.getAll(...cancelIds.map((jobId) => db.doc(`trabalhos/${jobId}`)));
  const remaining = preparation.jobs.filter((job) => !cancelIds.includes(job.jobId) && job.status !== "pending");
  const resourceRefs = new Map<string, { ref: FirebaseFirestore.DocumentReference; key: "vehicleIds" | "trailerIds"; id: string }>();
  for (const row of rows) {
    const job = row.data() || {};
    if (!row.exists || job.companyId !== companyId || job.driverId !== driverId)
      fail("aborted", "O vínculo do trabalho mudou. Confira novamente.");
    writes.push({ ref: row.ref, data: { status: "cancelled", cancelledAt: now,
      cancelledBy: uid, cancellationSource: "queue-preparation-manager-review",
      operationalRevision: Number(job.operationalRevision || 0) + 1 } });
    for (const [collection, key, canonical, alias] of [
      ["veiculos", "vehicleIds", "vehicleId", "veiculoId"],
      ["reboques", "trailerIds", "trailerId", "reboqueId"],
    ] as const) {
      const resourceId = field(job, canonical, alias);
      if (resourceId && !remaining.some((other) => other[key].includes(resourceId))) {
        const ref = db.doc(`${collection}/${id(resourceId, "Recurso")}`);
        resourceRefs.set(ref.path, { ref, key, id: resourceId });
      }
    }
  }
  if (resourceRefs.size) {
    const assets = await tx.getAll(...[...resourceRefs.values()].map((entry) => entry.ref));
    for (const asset of assets)
      if (asset.exists && asset.get("companyId") === companyId && asset.get("status") === "in_use")
        writes.push({ ref: asset.ref, data: { status: "available" } });
  }
  const stateRef = db.doc(`operationalDriverStates/${createHash("sha256").update(JSON.stringify([companyId, driverId])).digest("hex")}`);
  const state = await tx.get(stateRef);
  if (state.exists && cancelIds.includes(text(state.get("currentJobId"))))
    writes.push({ ref: stateRef, data: { currentJobId: keepJobId, updatedAt: now } });
  return { writes, audit: { driverId, keptJobId: keepJobId, cancelledJobIds: cancelIds,
    previousJobs: rows.map((row) => ({ jobId: row.id, status: row.get("status"),
      contractId: row.get("contractId"), vehicleId: row.get("vehicleId") })) } };
}
