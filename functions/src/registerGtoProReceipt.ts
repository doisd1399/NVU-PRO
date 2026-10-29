import { requireCompanyDriver } from "./companyAccess";
import { operationContractName, operationTrailerId, managedOperationRevisionPatch } from "./operationSnapshotFields";
import * as admin from "./firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import * as functions from "firebase-functions/v1";
import { createHash } from "node:crypto";
import { buildCanonicalOperationProjection, active, field } from "./canonicalOperationProjection";
import { isCanonicalConfirmedTrip } from "./isCanonicalConfirmedTrip";
import { readGtoReceiptAmountCents } from "./gtoReceiptValidation";
import { allocateOperationSlot } from "./operationSlotAllocator";
import { operationAwaitingCompletionPatch } from "./operationCompletion";
import { reconcileOperationTripsCore } from "./reconcileOperationTrips";
import { isOperationallySuspended, isSupportedReceiptCurrency, proReceiptEventKey, proReceiptEventFingerprints, readSimpleReceiptCurrency } from "./tripReceiptPolicy";
import { proSubmissionReasonCode } from "./proSubmissionFailure";

type Data = FirebaseFirestore.DocumentData;

const fail = (code: functions.https.FunctionsErrorCode, message: string, reasonCode = proSubmissionReasonCode(message)): never => {
  throw new functions.https.HttpsError(code, message, {
    reasonCode, stage: "CALLABLE_REGISTRATION", callable: "registerGtoProReceipt", validationVersion: 2,
  });
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const slotId = (jobId: string, slot: number): string => {
  const normalized = jobId.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 96) || "job";
  let value = 2166136261;
  for (let i = 0; i < jobId.length; i++) value = Math.imul(value ^ jobId.charCodeAt(i), 16777619) >>> 0;
  return `nvu_${normalized}_${value.toString(36)}_${slot}`;
};
const activeRow = (row: Data): boolean => active(row);

async function readReplayOperation(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore,
  jobRef: FirebaseFirestore.DocumentReference) {
  // Replay is part of the LIVE operational path. Only the physical jobId may
  // define membership here; legacy aliases are audit/migration evidence only.
  const [jobDoc, byJob] = await Promise.all([
    tx.get(jobRef),
    tx.get(db.collection("historico_viagens").where("jobId", "==", jobRef.id)),
  ]);
  const job = jobDoc.data() || {};
  const rows = new Map<string, Data>();
  byJob.docs.forEach((doc) => rows.set(doc.id, doc.data()));
  const projection = buildCanonicalOperationProjection({ physicalJobId: jobRef.id, operation: { ...job, id: jobRef.id },
    confirmedHistory: [...rows].map(([id, data]) => ({ id, data })) });
  return { progress: projection.confirmedTripCount, total: projection.totalDeliveries, jobStatus: field(job, "status") };
}

// Confirm the GTO amount on the saved result screen, independently of the
// Android OCR snapshot. Do not persist raw OCR text in Firestore.
const receiptAmount = readGtoReceiptAmountCents;

// Reuse the canonical server confirmation rule, including trusted GTO legacy
// records created atomically by the old server writer.
const confirmedRow = (row: Data, jobId: string, uid: string, companyId: string, contractId: string): boolean =>
  isCanonicalConfirmedTrip(row, { operationId: jobId, driverId: uid, companyId, contractId });

const matches = (row: Data, expectedId: string, uid: string, jobId: string,
  companyId: string, contractId: string, attemptId: string, amountCents: number): boolean =>
  field(row, "driverId", "motoristaId") === uid &&
  field(row, "companyId", "empresaId") === companyId &&
  field(row, "contractId", "contratoId") === contractId &&
  field(row, "jobId") === jobId &&
  row.simpleReceiptCaptureAttemptId === attemptId && row.valorCents === amountCents &&
  row.origem && row.destino && row.simulatorKey === "global-truck" &&
  row.operationSlotKey === expectedId && confirmedRow(row, jobId, uid, companyId, contractId);

/** One authenticated, atomic registration for the immutable GTO Pro receipt.
 * The confirmed history is read in the transaction and owns both the limit and
 * the next slot. Legacy expectedProgress is accepted only for compatibility
 * and diagnostics; it is never an authority.
 */
export const registerGtoProReceipt = functions.region("us-central1").https.onCall(
  async (raw: unknown, context) => {
    const uid = context.auth?.uid;
    if (!uid) return fail("unauthenticated", "Faça login para enviar a viagem.");
    const input = (raw || {}) as Data;
    // Authenticated capability negotiation is read-only; it never creates a trip ACK.
    if (Object.prototype.hasOwnProperty.call(input, "compatibilityProbe")) {
      if (input.compatibilityProbe !== "gto-contract-v2")
        return fail("invalid-argument", "Protocolo de registro GTO incompatível.", "GTO_PROTOCOL_UNSUPPORTED");
      return { compatible: true, callable: "registerGtoProReceipt", contractVersion: "gto-contract-v2",
        allowsUnknownCurrency: true, validationVersion: 2 };
    }
    const jobId = input.jobId, companyId = input.companyId, contractId = input.contractId;
    const attemptId = input.attemptId, epoch = input.contextEpoch;
    const origin = input.origin, destination = input.destination;
    const text = input.receiptText;
    const expectedProgress = input.expectedProgress;
    const amountCents = input.amountCents;
    const previousTripId = input.previousTripId || "";
    const suppliedCurrency = typeof input.currency === "string" ? input.currency.trim().toUpperCase() : "";
    const receiptCurrency = readSimpleReceiptCurrency("global-truck", typeof text === "string" ? text : "");
    const currencyConflict = receiptCurrency.status === "conflict" ||
      (receiptCurrency.status === "known" && Boolean(suppliedCurrency) && suppliedCurrency !== receiptCurrency.currency);
    const currencyEvidenceStatus = currencyConflict ? "conflict" : receiptCurrency.status;
    const canonicalCurrency = currencyEvidenceStatus === "known" ? receiptCurrency.currency || "" : "";
    const currencyEvidenceSource = currencyConflict ? "server_receipt_or_client_alias_conflict" : receiptCurrency.source;
    const id = /^[A-Za-z0-9_-]{8,180}$/;
    // Keep the acceptance contract intact, but identify each rejected field.
    const invalid = (reason: string, detail: string): never => fail("invalid-argument",
      `Recibo ou contexto GTO inválido: ${detail}.`, reason);
    if (![jobId, companyId, contractId, attemptId].every((v) => typeof v === "string" && id.test(v)) ||
        typeof epoch !== "string" || !/^[A-Za-z0-9_:-]{8,180}$/.test(epoch))
      return invalid("GTO_CONTEXT_INVALID", "identificadores da captura ausentes ou fora do formato esperado");
    if (typeof origin !== "string" || typeof destination !== "string" || !origin.trim() || !destination.trim() ||
        origin.trim().toLowerCase() === destination.trim().toLowerCase() || origin.length > 180 || destination.length > 180)
      return invalid("GTO_ROUTE_INVALID", "origem e destino ausentes, iguais ou excessivamente longos");
    if (typeof text !== "string" || !text || text.length > 5000)
      return invalid("GTO_RECEIPT_INVALID", "texto do comprovante ausente ou excessivamente longo");
    if (expectedProgress !== undefined && (!Number.isInteger(expectedProgress) || expectedProgress < 0 || expectedProgress > 9999))
      return invalid("GTO_CONTEXT_INVALID", "progresso legado fora do formato esperado");
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > 1_000_000_000 || receiptAmount(text) !== amountCents)
      return invalid("GTO_AMOUNT_INVALID", "valor salvo não corresponde ao valor a receber do comprovante");
    if (input.driverId !== uid)
      return invalid("DRIVER_SCOPE_MISMATCH", "motorista da captura não corresponde à sessão autenticada");
    if (input.simulatorKey !== "global-truck" || input.simulatorCode !== "GTO" || input.packageId !== "com.stargamesapps.gto")
      return invalid("GTO_SIMULATOR_INVALID", "simulador ou pacote da captura incompatível com GTO");
    if (input.currency !== undefined && (typeof input.currency !== "string" ||
        (suppliedCurrency !== "" && !isSupportedReceiptCurrency(suppliedCurrency))))
      return invalid("GTO_CURRENCY_INVALID", "campo de moeda fora do formato esperado");
    if (currencyConflict)
      return invalid("GTO_CURRENCY_CONFLICT", "evidências explícitas de moeda contraditórias");
    if (!["NONE", "ZERO_LABEL", "OFFER_ONLY"].includes(input.bonusEvidence))
      return invalid("GTO_BONUS_INVALID", "evidência de bônus incompatível com o registro");
    if (previousTripId !== "" && (typeof previousTripId !== "string" || previousTripId.length > 180 ||
        !/^[A-Za-z0-9_-]+$/.test(previousTripId) || (!previousTripId.startsWith(`nvu_${jobId}_`) && !previousTripId.startsWith("simple_"))))
      return invalid("GTO_PREVIOUS_TRIP_INVALID", "referência anterior não pertence ao formato desta operação");
    const db = admin.firestore();
    const jobRef = db.collection("trabalhos").doc(jobId);
    const contractRef = db.collection("contratos").doc(contractId);
    const attemptRef = db.collection("pro_trip_attempts").doc(hash(`${uid}|${attemptId}`));
    const oldRef = previousTripId ? db.collection("historico_viagens").doc(previousTripId) : null;
    const userRef = db.collection("users").doc(uid);
    const companyRef = db.collection("frotas").doc(companyId);
    const fingerprint = hash(JSON.stringify([uid, jobId, companyId, contractId, attemptId,
      epoch, origin.trim(), destination.trim(), amountCents, hash(text)]));
    const eventKey = proReceiptEventKey([uid, companyId, contractId, jobId, "global-truck", epoch], input.capturedAt);
    const eventRef = eventKey ? db.collection("pro_receipt_events").doc(eventKey) : null;
    const eventFingerprints = proReceiptEventFingerprints({ uid, jobId, companyId, contractId,
      simulator: "global-truck", epoch, origin, destination, amountCents,
      currencyStatus: currencyEvidenceStatus, currency: canonicalCurrency, suppliedCurrency: suppliedCurrency || String(input.currency).toUpperCase() });
    const eventFingerprint = eventFingerprints[0];
    const time = FieldValue.serverTimestamp();
    const storedCurrencyMatches = (row: Data): boolean => {
      if (row.currencyEvidenceVersion === 1) {
        return row.currencyEvidenceStatus === currencyEvidenceStatus &&
          [row.currency, row.simpleReceiptCurrency].every((value) => canonicalCurrency
            ? value === canonicalCurrency : value == null || value === "");
      }
      // The old writer stored only the explicit client alias. Preserve its
      // original replay guard without retroactively inventing receipt evidence.
      if (row.currencyEvidenceVersion !== undefined) return false;
      return isSupportedReceiptCurrency(row.simpleReceiptCurrency) &&
        row.simpleReceiptCurrency === suppliedCurrency &&
        (row.currency == null || row.currency === row.simpleReceiptCurrency);
    };

    // Preserve exact replay semantics, but migrate every old operation before a
    // genuinely new Pro receipt. Users must not hit a manual reconciliation
    // error merely because their operation was created by a previous release.
    const [preflightAttempt, preflightEvent, preflightJob] = await Promise.all([
      attemptRef.get(),
      eventRef ? eventRef.get() : Promise.resolve(null),
      jobRef.get(),
    ]);
    if (!preflightAttempt.exists && !preflightEvent?.exists && preflightJob.exists) {
      const preflightData = preflightJob.data() || {};
      if (Number(preflightData.operationReconciliationVersion || 0) < 4 && Number(preflightData.progress || 0) > 0) {
        const reconciliation = await reconcileOperationTripsCore(db, uid, jobId);
        if (reconciliation.status === "conflict") {
          return fail("failed-precondition", `OPERATION_RECONCILIATION_REQUIRED:${reconciliation.reason}`);
        }
      }
    }

    const result = await db.runTransaction(async (tx) => {
      const attempt = await tx.get(attemptRef);
      if (attempt.exists) {
        const saved = attempt.data() || {};
        if (saved.fingerprint !== fingerprint || typeof saved.tripId !== "string")
          return fail("failed-precondition", "A tentativa salva diverge do registro anterior.");
        const acknowledged = await tx.get(db.collection("historico_viagens").doc(saved.tripId));
        if (!acknowledged.exists || !matches(acknowledged.data() || {}, saved.tripId, uid, jobId,
          companyId, contractId, saved.originalAttemptId || attemptId, amountCents) ||
          !storedCurrencyMatches(acknowledged.data() || {}))
          return fail("failed-precondition", "Viagem anterior alterada ou excluída; revisão necessária.");
        const replay = await readReplayOperation(tx, db, jobRef);
        return { registered: true, duplicate: true, tripId: saved.tripId,
          ...replay };
      }

      const event = eventRef ? await tx.get(eventRef) : null;
      if (event?.exists) {
        const saved = event.data() || {};
        if (!eventFingerprints.includes(saved.fingerprint) || typeof saved.tripId !== "string")
          return fail("failed-precondition", "A captura salva diverge da viagem registrada.");
        const acknowledged = await tx.get(db.collection("historico_viagens").doc(saved.tripId));
        const originalAttemptId = saved.attemptId || acknowledged.get("simpleReceiptCaptureAttemptId");
        if (!acknowledged.exists || !matches(acknowledged.data() || {}, saved.tripId, uid, jobId,
          companyId, contractId, originalAttemptId, amountCents) ||
          !storedCurrencyMatches(acknowledged.data() || {}))
          return fail("failed-precondition", "Viagem anterior alterada ou excluída; revisão necessária.");
        const replay = await readReplayOperation(tx, db, jobRef);
        tx.create(attemptRef, { fingerprint, tripId: saved.tripId, jobId, driverId: uid,
          originalAttemptId, createdAt: time });
        return { registered: true, duplicate: true, receiptEventDuplicate: true, tripId: saved.tripId, ...replay };
      }

      // Old Android builds may have committed the same receipt at another slot
      // and lost their ACK. Adopt only the exact same immutable attempt.
      if (oldRef) {
        const old = await tx.get(oldRef);
        if (old.exists) {
          const oldData = old.data() || {};
          if (!matches(oldData, oldRef.id, uid, jobId, companyId, contractId, attemptId, amountCents) ||
              !storedCurrencyMatches(oldData))
            return fail("failed-precondition", "Slot anterior não pertence a esta tentativa.");
          if (oldData.origem !== origin.trim() || oldData.destino !== destination.trim() ||
              oldData.simpleReceiptCaptureContextEpoch !== epoch || oldData.simpleReceiptHash !== hash(text))
            return fail("failed-precondition", "Comprovante anterior não corresponde à tentativa salva.");
          const replay = await readReplayOperation(tx, db, jobRef);
          tx.create(attemptRef, { fingerprint, tripId: oldRef.id, jobId, driverId: uid,
            progress: replay.progress, createdAt: time });
          return { registered: true, duplicate: true, tripId: oldRef.id,
            ...replay };
        }
      }

      // Live operational authorization is scoped strictly by the physical jobId.
      // Legacy aliases (operationId/trabalhoId) belong to audit/migration paths only:
      // allowing them here lets historical rows veto a valid receipt for a new execution.
      const [jobDoc, contractDoc, userDoc, companyDoc, sameJob, claimsByJob] = await Promise.all([
        tx.get(jobRef), tx.get(contractRef), tx.get(userRef), tx.get(companyRef),
        tx.get(db.collection("historico_viagens").where("jobId", "==", jobId)),
        tx.get(db.collection("trip_operation_slots").where("jobId", "==", jobId)),
      ]);
      await requireCompanyDriver(db, tx, uid, companyId);
      if (!jobDoc.exists || !contractDoc.exists || !companyDoc.exists)
        return fail("failed-precondition", "Operação, contrato ou empresa não disponíveis.");
      const job = jobDoc.data() || {}, contract = contractDoc.data() || {}, company = companyDoc.data() || {};
      if (field(job, "driverId", "motoristaId", "userId") !== uid ||
          field(job, "companyId", "empresaId") !== companyId ||
          field(job, "contractId", "contratoId") !== contractId ||
          field(contract, "companyId", "empresaId") !== companyId)
        return fail("permission-denied", "Os vínculos da operação não pertencem ao motorista.");
      const simulatorAlias = [company.simulatorId, company.simuladorId, company.simulatorName,
        company.simuladorNome, company.simulator].filter((v) => typeof v === "string")
        .map((v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
      const catalogId = field(company, "simulatorId", "simuladorId");
      const catalog = catalogId ? await tx.get(db.collection("simulators").doc(catalogId)) : null;
      simulatorAlias.push(...[catalog?.get("name"), catalog?.get("simulatorName"), catalog?.get("nome")]
        .filter((v) => typeof v === "string")
        .map((v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, "-")));
      if (!simulatorAlias.some((v: string) => ["gto", "global-truck", "global-truck-online"].includes(v)))
        return fail("failed-precondition", "Empresa não vinculada ao GTO.");
      if (isOperationallySuspended(userDoc.data() || {}))
        return fail("permission-denied", "Atividades operacionais suspensas.");

      const sameSlot = sameJob.docs;
      const operationClaims = claimsByJob.docs;
      // Only canonical confirmed history and claims backed by that history may
      // consume live operation capacity. Same-job pending/failed historical
      // debris is preserved for audit but cannot reserve a slot forever.
      const canonicalRows = sameSlot.filter((doc) => confirmedRow(doc.data(), jobId, uid, companyId, contractId));
      const canonicalIds = new Set(canonicalRows.map((doc) => doc.id));
      const canonicalClaims = operationClaims.filter((claim) => {
        const data = claim.data();
        return activeRow(data) &&
          field(data, "driverId", "motoristaId", "userId") === uid &&
          field(data, "companyId", "empresaId") === companyId &&
          field(data, "contractId", "contratoId") === contractId &&
          canonicalIds.has(field(data, "tripId", "canonicalTripId"));
      });
      // Legacy operations created before canonical binding must be audited
      // before accepting another receipt. This prevents a previously corrupted
      // 3/12 projection from creating duplicate trips while 9 old server rows
      // are still unbound to the operation.
      if (Number(job.operationReconciliationVersion || 0) < 4 && Number(job.progress || 0) > 0) {
        return fail("failed-precondition", "OPERATION_RECONCILIATION_REQUIRED");
      }
      const projection = buildCanonicalOperationProjection({
        physicalJobId: jobId,
        operation: { ...job, id: jobId },
        confirmedHistory: sameSlot.map((doc) => ({ id: doc.id, data: doc.data() })),
      });
      // A previous Print is an independent trip. Price and entry mode do not
      // reject a new receipt or authorize deletion of confirmed history.
      const total = Number(job.totalDeliveries ?? contract.totalDeliveries);
      if (!Number.isInteger(total) || total < 1 ||
          projection.confirmedTripCount >= total ||
          !["active", "delayed", "awaiting_completion"].includes(String(job.status)))
        return fail("failed-precondition", "Operação encerrada ou sem entregas disponíveis.");

      const operationSlot = allocateOperationSlot([
        ...canonicalRows.map((doc) => doc.data()), ...canonicalClaims.map((doc) => doc.data()),
      ], total);
      if (!Number.isInteger(operationSlot) || operationSlot < 1 || operationSlot > total || operationSlot > 10_000)
        return fail("failed-precondition", "Numeração da operação inválida; revisão necessária.");
      const tripId = `${slotId(jobId, operationSlot)}_${hash(attemptId).slice(0, 12)}`;
      const tripRef = db.collection("historico_viagens").doc(tripId);
      const slotRef = db.collection("trip_operation_slots").doc(tripId);
      const claimDoc = await tx.get(slotRef);
      const tripDoc = await tx.get(tripRef);
      if (tripDoc.exists) {
        if (!matches(tripDoc.data() || {}, tripId, uid, jobId, companyId, contractId, attemptId, amountCents) ||
            !storedCurrencyMatches(tripDoc.data() || {}))
          return fail("failed-precondition", "Slot ocupado por outra viagem.");
        const confirmedProgress = projection.confirmedTripIds.includes(tripId)
          ? projection.confirmedTripCount : projection.confirmedTripCount + 1;
        tx.create(attemptRef, { fingerprint, tripId, jobId, driverId: uid,
          progress: confirmedProgress, createdAt: time });
        return { registered: true, duplicate: true, tripId,
          progress: confirmedProgress, total, jobStatus: field(job, "status") };
      }
      if (claimDoc.exists) return fail("failed-precondition", "Slot reservado por outra viagem.");

      if (sameSlot.some((doc) => activeRow(doc.data()) &&
          (field(doc.data(), "driverId", "motoristaId", "userId", "criadoPor") !== uid ||
           (field(doc.data(), "companyId", "empresaId") && field(doc.data(), "companyId", "empresaId") !== companyId) ||
           (field(doc.data(), "contractId", "contratoId") && field(doc.data(), "contractId", "contratoId") !== contractId))))
        return fail("failed-precondition", "SCOPE_MISMATCH: registro vinculado ao job físico possui identidade divergente.");
      const unresolvedClaims = operationClaims.filter((claim) => {
        const data = claim.data();
        if (!activeRow(data) || field(data, "driverId", "motoristaId") !== uid) return false;
        const claimTripId = field(data, "tripId", "canonicalTripId");
        return !sameSlot.some((row) => row.id === claimTripId && activeRow(row.data()));
      });
      if (unresolvedClaims.length > 0)
        return fail("failed-precondition", "Há uma reserva operacional sem histórico confirmado; reconcilie a operação antes do envio.");

      // Only canonically confirmed rows own live capacity. A same-job stale or
      // validation_failed row remains preserved for audit but cannot collide
      // with the newly allocated slot after its derived claim is reclaimed.
      const other = canonicalRows.filter((doc) => doc.id !== tripId &&
        doc.get("operationSlot") === operationSlot && activeRow(doc.data()));
      if (other.length) return fail("failed-precondition", "Outra viagem ocupa o mesmo slot.");
      const confirmedProgress = projection.confirmedTripCount + 1;
      const vehicleId = field(job, "vehicleId", "veiculoId");
      const trailerId = operationTrailerId(job, contract);
      const driverName = field(userDoc.data() || {}, "displayName", "name", "nome") || "Motorista";
      const trip = {
        tripId, canonicalTripId: tripId, empresaId: companyId, companyId,
        empresaNome: field(company, "companyName", "name", "nome") || "Empresa", motoristaId: uid, driverId: uid,
        motoristaNome: driverName, contratoId: contractId, contractId,
        contratoNumero: operationContractName(job, contract), contratoDescricao: operationContractName(job, contract),
        jobId, operationId: jobId, trabalhoId: jobId, origem: origin.trim(), destino: destination.trim(),
        valor: amountCents / 100, valorCents: amountCents,
        valorDeteccaoMetodo: "simple_native_ocr", valorDetectadoAutomaticamente: true,
        valorBloqueadoPorDeteccao: true, status: "concluida", recordStatus: "concluida",
        source: "gto_auto", registroAutomatico: true, automationSource: "simple-native-v1",
        criadoPor: uid, dataLancamento: time, completedAt: time, createdAt: time,
        ...(typeof input.capturedAt === "number" && input.capturedAt > 0 && input.capturedAt <= Date.now() + 300_000
          ? { createdAtLocal: new Date(input.capturedAt).toISOString(), completedAtLocal: new Date(input.capturedAt).toISOString() } : {}),
        serverValidatedAt: time, serverUpdatedAt: time, uploadedAt: time,
        syncStatus: "synced", offlineSyncStatus: "synced", operationProjectionVersion: 4,
        simulatorKey: "global-truck", simulatorId: "global-truck", simulatorCode: "GTO",
        simulatorName: "GTO", simuladorNome: "GTO", simuladorCodigo: "GTO",
        veiculoId: vehicleId, veiculoNome: field(job, "vehicleName", "veiculoNome") || String(input.vehicleName || "").slice(0, 120),
        reboqueId: trailerId, reboqueNome: field(job, "trailerName", "reboqueNome") || String(input.trailerName || "").slice(0, 120),
        simpleAutomation: true, simpleAutomationVersion: "v3-native-immediate",
        ...(canonicalCurrency ? { currency: canonicalCurrency, simpleReceiptCurrency: canonicalCurrency } : {}),
        currencyEvidenceVersion: 1, currencyEvidenceStatus, currencyEvidenceSource,
        simpleReceiptResultScreenConfirmed: true,
        simpleReceiptBonusEvidence: input.bonusEvidence, simpleReceiptConfidence: 1,
        simpleReceiptCapturedAt: Number.isSafeInteger(input.capturedAt) ? input.capturedAt : 0,
        simpleReceiptCaptureAttemptId: attemptId, simpleReceiptCaptureContextEpoch: epoch,
        simpleReceiptHash: hash(text), idempotencyKey: `simple:${jobId}:${uid}:${attemptId}`,
        ...(eventKey ? { receiptEventKey: eventKey } : {}),
        simpleDuplicateGuardKey: `simple-value:${jobId}:${uid}:${amountCents}`,
        operationSlot, operationSlotKey: tripId, deterministicTripId: tripId,
        syncVersion: 1, clientUpdatedAt: Date.now(), nativeSubmission: true, nativeSubmissionVersion: 3,
      };
      tx.create(tripRef, trip);
      tx.create(slotRef, { jobId, operationId: jobId, trabalhoId: jobId, driverId: uid, companyId, contractId, operationSlot, tripId, schemaVersion: 4, createdAt: time });
      tx.update(jobRef, {
        ...managedOperationRevisionPatch(job),
        ...operationAwaitingCompletionPatch(job, contract, confirmedProgress, total),
        progress: confirmedProgress, lastValidatedTripId: tripId, progressUpdatedAt: time,
        operationReconciliationVersion: 4,
        operationProgressReconciled: true, operationProgressReconciledAt: time,
      });
      tx.create(attemptRef, { fingerprint, tripId, jobId, driverId: uid,
        progress: confirmedProgress, createdAt: time });
      if (eventRef) tx.create(eventRef, { fingerprint: eventFingerprint, tripId, attemptId,
        jobId, driverId: uid, companyId, createdAt: time });
      return { registered: true, duplicate: false, tripId, progress: confirmedProgress,
        total, jobStatus: confirmedProgress >= total ? "awaiting_completion" : field(job, "status"), reconciledLegacyPrint: false };
    });
    functions.logger.info("gto_pro_registration", { decision: result.duplicate ? "REPLAY" : "CREATED",
      reconciledLegacyPrint: Boolean(result.reconciledLegacyPrint) });
    return result;
  },
);
