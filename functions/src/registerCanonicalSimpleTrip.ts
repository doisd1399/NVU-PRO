import { canonicalTripAck } from "./canonicalTripAck";
import { driverDisplayIdentity } from "./driverDisplayIdentity";
import { assertCompanyDriver, readCompanyAccess } from "./companyAccess";
import { operationContractName, operationTrailerId, managedOperationRevisionPatch } from "./operationSnapshotFields";
import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";
import { createHash } from "node:crypto";
import { allocateOperationSlot } from "./operationSlotAllocator";
import { readGtoReceiptAmountCents } from "./gtoReceiptValidation";
import { readGtoPrintEvidence } from "./gtoPrintEvidence";
import { operationAwaitingCompletionPatch } from "./operationCompletion";
import { isOperationallySuspended, isSupportedReceiptCurrency, proReceiptEventKey, proReceiptEventFingerprints, readSimpleReceiptAmountCents, readSimpleReceiptCurrency } from "./tripReceiptPolicy";
import { verifyPrintReceipt } from "./printReceiptEvidence";
import {
  buildCanonicalOperationProjection,
  field,
  type CanonicalOperationTrip,
} from "./canonicalOperationProjection";
import { isCanonicalConfirmedTrip } from "./isCanonicalConfirmedTrip";
import { reconcileOperationTripsCore } from "./reconcileOperationTrips";
import { normalizeSimulatorKey } from "./operationalWorkModePolicy";

type Data = FirebaseFirestore.DocumentData;
const text = (value: unknown, max = 220): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const fail = (code: functions.https.FunctionsErrorCode, message: string): never => {
  const reasonCode = message.startsWith("CANONICAL_TRIP_CURRENCY_CONFLICT") ? "CURRENCY_CONFLICT"
    : message.startsWith("CANONICAL_TRIP_CURRENCY_UNSUPPORTED") ? "CURRENCY_UNSUPPORTED"
      : code === "permission-denied" ? "AUTHORIZATION_REJECTED"
        : code === "failed-precondition" ? "SERVER_PRECONDITION_REJECTED"
          : code === "unauthenticated" ? "AUTHENTICATION_REQUIRED"
            : code === "invalid-argument" ? "REQUEST_INVALID" : "REGISTRATION_REJECTED";
  const action = code === "permission-denied" ? "verify_account_and_operation_link"
    : code === "failed-precondition" ? "review_operation_and_prior_attempts"
      : code === "unauthenticated" ? "reauthenticate"
        : code === "invalid-argument" ? "review_captured_evidence" : "contact_support";
  throw new functions.https.HttpsError(code, message, {
    reasonCode,
    stage: "CALLABLE_REGISTRATION",
    retryable: ["unavailable", "deadline-exceeded", "internal"].includes(code),
    action,
  });
};
const boundedId = (value: unknown, name: string): string => {
  const result = text(value);
  if (!result || result.includes("/") || result.length > 220) fail("invalid-argument", `${name} inválido.`);
  return result;
};
const activeStatus = (value: unknown): boolean =>
  ["active", "delayed", "awaiting_completion"].includes(text(value, 50).toLowerCase());
const positiveCents = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > 1_000_000_000) {
    fail("invalid-argument", "Valor inválido.");
  }
  return Number(value);
};
const normalizeAmount = (trip: Data): number => {
  const cents = positiveCents(trip.valorCents);
  const amount = Number(trip.valor);
  if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== cents) {
    fail("invalid-argument", "Valor e centavos incoerentes.");
  }
  return cents;
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const stableFingerprint = (trip: Data, identity: string[]) => hash(JSON.stringify({
  identity,
  origin: text(trip.origem || trip.origin, 180),
  destination: text(trip.destino || trip.destination, 180),
  amountCents: Number(trip.valorCents),
  receiptHash: text(trip.simpleReceiptHash || trip.imageHash, 240),
  attemptId: text(trip.simpleReceiptCaptureAttemptId || trip.attemptId, 180),
}));
const allowedFields = new Set([
  "tripId", "canonicalTripId", "deterministicTripId", "clientRequestId", "idempotencyKey",
  "source", "driverId", "motoristaId", "companyId", "empresaId", "contractId", "contratoId", "currency", "moeda", "moneyCurrency", "receiptCurrency",
  "jobId", "operationId", "trabalhoId", "origem", "origin", "destino", "destination", "valor",
  "valorCents", "earnings", "comprovanteUrl", "comprovanteTituloOriginal", "imageHash",
  "receiptText", "simpleAutomation", "simpleAutomationVersion", "simpleReceiptCurrency",
  "simpleReceiptSourceField", "simpleReceiptResultScreenConfirmed", "simpleReceiptBonusEvidence",
  "simpleReceiptConfidence", "simpleReceiptCapturedAt", "simpleReceiptCaptureAttemptId",
  "simpleReceiptCaptureContextEpoch", "simpleReceiptHash", "simpleDuplicateGuardKey",
  "gtoEntryMode", "gtoReceiptAnalyzed", "valorDetectadoAutomaticamente", "valorDeteccaoMetodo",
  "simulatorKey", "simulatorId", "simulatorCode", "simulatorName", "simuladorNome", "simuladorCodigo",
  "veiculoId", "veiculoNome", "veiculoPlaca", "reboqueId", "reboqueNome", "registroAutomatico",
  "motoristaNome",
  "automationSource", "nativeSubmission", "nativeSubmissionVersion", "createdAtClient",
  "completedAtClient", "createdAtLocal", "completedAtLocal", "empresaNome", "contratoNumero",
  "contratoDescricao", "distanciaPercorrida", "gtoRewardedAdDetected", "gtoReceiptValidationMode",
  "gtoReceiptManualConfirmation",
  "gtoReceiptEvidence",
]);
const forbiddenFields = new Set([
  "deleted", "deletedAt", "deletedBy", "serverValidatedAt", "serverUpdatedAt", "operationSlot",
  "operationSlotKey", "progress", "jobProgress", "expectedProgress", "recordStatus", "status",
  "syncStatus", "offlineSyncStatus", "rankingEligible", "eligibleForRanking", "confirmed",
  "confirmationStatus", "lastValidatedTripId", "tripOperationSlot", "lockId",
]);
const canonicalSimulator = (trip: Data): string => text(
  trip.simulatorKey || trip.simulatorCode || trip.simuladorCodigo || trip.simuladorNome || trip.simulatorId,
  80,
).toLowerCase();
const hasReceiptEvidence = (trip: Data, isPrint: boolean): boolean => {
  const url = text(trip.comprovanteUrl, 2500);
  const hasHash = text(trip.imageHash, 240).length > 0 || text(trip.simpleReceiptHash, 240).length > 0;
  return isPrint ? hasHash && Boolean(url) : trip.simpleAutomation === true &&
    trip.simpleReceiptResultScreenConfirmed === true;
};

/** Server-authoritative canonical registration for Web/Print/Pro/offline. Client counters and status fields are never trusted. */
export const registerCanonicalSimpleTrip = functions.region("us-central1").https.onCall(
  async (rawData: { trip?: Record<string, unknown> }, context) => {
    const authenticatedUid = context.auth?.uid;
    if (!authenticatedUid) fail("unauthenticated", "Autenticação necessária.");
    const uid = String(authenticatedUid || "");
    if (!uid) fail("unauthenticated", "Autenticação necessária.");
    const rawTrip = rawData?.trip && typeof rawData.trip === "object" ? rawData.trip : rawData as unknown as Record<string, unknown>;
    if (!rawTrip || typeof rawTrip !== "object" || Array.isArray(rawTrip)) fail("invalid-argument", "Viagem inválida.");
    const incoming = rawTrip as Data;
    const isSimple = incoming.simpleAutomation === true;
    const simulator = canonicalSimulator(incoming);
    const observed = ["currency", "moeda", "simpleReceiptCurrency", "moneyCurrency", "receiptCurrency"]
      .map((field) => ({ field, currency: text(incoming[field], 10).toUpperCase() }))
      .filter((item) => item.currency);
    const uniqueCurrencies = [...new Set(observed.map((item) => item.currency))];
    const printReading = incoming.gtoEntryMode === "print" && incoming.gtoReceiptAnalyzed === true
      ? readGtoPrintEvidence(incoming.receiptText, incoming.gtoReceiptEvidence) : null;
    const receiptCurrency = printReading?.currencyConflict
      ? { status: "conflict" as const, source: "server_receipt_text_conflict" as const, currency: undefined }
      : printReading?.currency
      ? { status: "known" as const, currency: printReading.currency, source: "server_receipt_text_explicit" as const }
      : readSimpleReceiptCurrency(simulator, text(incoming.receiptText, 5000));
    let canonicalCurrency = "";
    let currencyEvidenceStatus: "known" | "unknown" | "conflict" = "unknown";
    let currencyEvidenceSource = "server_currency_unresolved";
    if (uniqueCurrencies.length > 1) {
      currencyEvidenceStatus = "conflict";
      currencyEvidenceSource = "server_alias_conflict";
    } else if (receiptCurrency.status === "conflict" ||
        (receiptCurrency.status === "known" && uniqueCurrencies.length === 1 && uniqueCurrencies[0] !== receiptCurrency.currency)) {
      currencyEvidenceStatus = "conflict";
      currencyEvidenceSource = "server_receipt_or_alias_conflict";
    } else if (receiptCurrency.status === "known" && receiptCurrency.currency) {
      canonicalCurrency = receiptCurrency.currency;
      currencyEvidenceStatus = "known";
      currencyEvidenceSource = "server_receipt_text_explicit";
    } else if (isSimple && uniqueCurrencies.length === 1) {
      currencyEvidenceSource = "server_simple_alias_unverified";
    } else if (!isSimple && uniqueCurrencies.length === 1 && isSupportedReceiptCurrency(uniqueCurrencies[0])) {
      canonicalCurrency = uniqueCurrencies[0];
      currencyEvidenceStatus = "known";
      currencyEvidenceSource = "server_canonical_alias";
    } else if (receiptCurrency.source === "server_receipt_text_unverified") {
      currencyEvidenceSource = receiptCurrency.source;
    }
    const trip = { ...(rawTrip as Data), ...(canonicalCurrency ? { currency: canonicalCurrency } : {}) } as Data;
    for (const key of Object.keys(trip)) {
      if (forbiddenFields.has(key) || !allowedFields.has(key)) fail("invalid-argument", `Campo não permitido: ${key}.`);
    }
    const isPrint = text(trip.gtoEntryMode, 30).toLowerCase() === "print" ||
      text(trip.source, 80).toUpperCase().includes("PRINT") || Boolean(trip.imageHash);
    const isGeneric = !isPrint && !isSimple;
    if (isSimple && (trip.simpleReceiptResultScreenConfirmed !== true ||
        !["NONE", "ZERO_LABEL", "OFFER_ONLY"].includes(text(trip.simpleReceiptBonusEvidence, 30)))) {
      fail("invalid-argument", "Evidência Simple não confirmada.");
    }
    const driverId = boundedId(trip.driverId || trip.motoristaId || uid, "driverId");
    if (driverId !== uid) fail("permission-denied", "A viagem não pertence ao usuário autenticado.");
    const companyId = boundedId(trip.companyId || trip.empresaId, "companyId");
    const jobId = boundedId(trip.jobId, "jobId");
    const contractId = boundedId(trip.contractId || trip.contratoId, "contractId");
    const tripId = boundedId(trip.canonicalTripId || trip.tripId || trip.deterministicTripId || trip.idempotencyKey, "tripId");
    const idempotencyKey = boundedId(trip.idempotencyKey || trip.clientRequestId || tripId, "idempotencyKey");
    const origin = text(trip.origem || trip.origin, 180);
    const destination = text(trip.destino || trip.destination, 180);
    if (!origin || !destination || origin.toLowerCase() === destination.toLowerCase()) fail("invalid-argument", "Rota inválida.");
    if (!simulator && !isPrint) fail("invalid-argument", "Simulador não informado.");
    const amountCents = normalizeAmount(trip);
    if (isSimple && trip.receiptText && readSimpleReceiptAmountCents(simulator, text(trip.receiptText, 5000)) !== amountCents) {
      fail("invalid-argument", "O ganho do recibo não corresponde ao valor da viagem.");
    }
    if (!isGeneric && !hasReceiptEvidence(trip, isPrint)) fail("invalid-argument", "Comprovante não confirmado.");
    if (text(trip.gtoEntryMode, 30).toLowerCase() === "print") {
      if (trip.gtoReceiptAnalyzed !== true || trip.gtoRewardedAdDetected === true) {
        fail("invalid-argument", "GTO_RECEIPT_ANALYSIS_REQUIRED");
      }
      if (readGtoPrintEvidence(trip.receiptText, trip.gtoReceiptEvidence).amountCents !== amountCents) {
        fail("invalid-argument", "GTO_RECEIPT_AMOUNT_OR_BONUS_INVALID");
      }
    }
    if (trip.distanciaPercorrida != null && (!Number.isFinite(Number(trip.distanciaPercorrida)) ||
        Number(trip.distanciaPercorrida) <= 0 || Number(trip.distanciaPercorrida) > 50_000)) {
      fail("invalid-argument", "Distância inválida.");
    }
    const fingerprint = stableFingerprint(trip, [uid, companyId, contractId, jobId, tripId, idempotencyKey]);
    const db = admin.firestore();
    const tripRef = db.collection("historico_viagens").doc(tripId);
    const jobRef = db.collection("trabalhos").doc(jobId);
    const lockRef = db.collection("trip_request_locks").doc(encodeURIComponent(idempotencyKey));
    const attemptRef = db.collection("canonical_trip_attempts").doc(hash(`${uid}|${idempotencyKey}`));
    // Existing ACKs stay replayable even if an old image is later unavailable.
    const startedAt = Date.now();
    const [prior, preflightJob] = await Promise.all([tripRef.get(), jobRef.get()]);
    const preflightMs = Date.now() - startedAt;
    const canonicalScope = { operationId: jobId, driverId: uid, companyId, contractId };
    // Migrate old operations before a NEW receipt enters the transaction. Exact
    // replays keep their idempotent fast path and are never blocked by migration.
    const migrateOperation = async () => { if (!isCanonicalConfirmedTrip(prior.data() || {}, canonicalScope)) {
      const preflightData = preflightJob.data() || {};
      if (preflightJob.exists && Number(preflightData.operationReconciliationVersion || 0) < 4 && Number(preflightData.progress || 0) > 0) {
        const reconciliation = await reconcileOperationTripsCore(db, uid, jobId);
        if (reconciliation.status === "conflict") {
          fail("failed-precondition", `OPERATION_RECONCILIATION_REQUIRED:${reconciliation.reason}`);
        }
      }
    } };
    const [storageReceiptKey] = await Promise.all([
      isPrint && !isCanonicalConfirmedTrip(prior.data() || {}, canonicalScope)
        ? verifyPrintReceipt(text(trip.comprovanteUrl, 2500), companyId, uid) : Promise.resolve(""),
      migrateOperation(),
    ]);
    const evidenceMs = Date.now() - startedAt - preflightMs;
    const receiptEventKey = isSimple ? proReceiptEventKey(
      [uid, companyId, contractId, jobId, simulator, text(trip.simpleReceiptCaptureContextEpoch, 180)],
      trip.simpleReceiptCapturedAt,
    ) : null;
    const eventRef = receiptEventKey ? db.collection("pro_receipt_events").doc(receiptEventKey) : null;
    const receiptObjectRef = storageReceiptKey ? db.collection("print_receipt_objects").doc(hash(storageReceiptKey)) : null;
    const eventFingerprints = proReceiptEventFingerprints({ uid, companyId, contractId, jobId, simulator,
      epoch: text(trip.simpleReceiptCaptureContextEpoch, 180), origin, destination, amountCents,
      currencyStatus: currencyEvidenceStatus, currency: canonicalCurrency,
      suppliedCurrency: text(incoming.simpleReceiptCurrency, 10).toUpperCase() });
    const eventFingerprint = eventFingerprints[0];
    let transactionAttempts = 0;
    const result = await db.runTransaction(async (tx) => {
      transactionAttempts++;
      const companyRead = tx.get(db.collection("frotas").doc(companyId));
      const userRead = tx.get(db.collection("users").doc(uid));
      const [jobSnapshot, contractSnapshot, companySnapshot, userSnapshot, existingSnapshot, lockSnapshot, attemptSnapshot, eventSnapshot, receiptObjectSnapshot,
        sameJob, claims, receiptMatches, access] = await Promise.all([
        tx.get(jobRef),
        tx.get(db.collection("contratos").doc(contractId)),
        companyRead,
        userRead,
        tx.get(tripRef),
        tx.get(lockRef),
        tx.get(attemptRef),
        eventRef ? tx.get(eventRef) : Promise.resolve(null),
        receiptObjectRef ? tx.get(receiptObjectRef) : Promise.resolve(null),
        // Live writes are authorized only by the physical execution id.
        tx.get(db.collection("historico_viagens").where("jobId", "==", jobId)),
        tx.get(db.collection("trip_operation_slots").where("jobId", "==", jobId)),
        trip.imageHash ? tx.get(db.collection("historico_viagens").where("imageHash", "==", trip.imageHash)) : Promise.resolve(null),
        readCompanyAccess(db, tx, uid, companyId, companyRead, userRead),
      ]);
      const job = { id: jobId, ...jobSnapshot.data() } as Data;
      const contract = contractSnapshot.data() || {};
      const rows = new Map<string, CanonicalOperationTrip>();
      sameJob.docs.forEach((doc) => rows.set(doc.id, { id: doc.id, data: doc.data() }));
      const existing = existingSnapshot.data() || {};
      if (eventSnapshot?.exists && eventSnapshot.get("tripId") !== tripId) {
        const acknowledgedId = eventSnapshot.get("tripId");
        if (!eventFingerprints.includes(eventSnapshot.get("fingerprint")) || typeof acknowledgedId !== "string")
          fail("failed-precondition", "A captura salva diverge da viagem registrada.");
        const acknowledged = await tx.get(db.collection("historico_viagens").doc(acknowledgedId));
        const saved = acknowledged.data() || {};
        if (!acknowledged.exists || !isCanonicalConfirmedTrip(saved, canonicalScope) ||
            saved.receiptEventKey !== receiptEventKey || field(saved, "driverId", "motoristaId") !== uid ||
            field(saved, "companyId", "empresaId") !== companyId || field(saved, "jobId") !== jobId ||
            field(saved, "contractId", "contratoId") !== contractId || saved.valorCents !== amountCents ||
            saved.origem !== origin || saved.destino !== destination)
          fail("failed-precondition", "Viagem anterior alterada ou excluída; revisão necessária.");
        const projection = buildCanonicalOperationProjection({ physicalJobId: jobId, operation: job, confirmedHistory: [...rows.values()] });
        return { registered: true, canonicalAckVersion: 1, confirmedTrip: canonicalTripAck({ ...saved, id: acknowledgedId, tripId: acknowledgedId, canonicalTripId: acknowledgedId }), duplicate: true, receiptEventDuplicate: true, tripId: acknowledgedId,
          confirmedTripCount: projection.confirmedTripCount,
          total: Number(job.totalDeliveries ?? contract.totalDeliveries ?? 0), jobStatus: text(job.status, 50) };
      }
      if (existingSnapshot.exists && (isCanonicalConfirmedTrip(existing, canonicalScope) ||
          existing.deleted === true || existing.status === "DELETED")) {
        const sameOwner = field(existing, "driverId", "motoristaId") === uid &&
          field(existing, "companyId", "empresaId") === companyId &&
          field(existing, "jobId") === jobId &&
          field(existing, "contractId", "contratoId") === contractId;
        const sameRequest = text(existing.idempotencyKey || existing.clientRequestId) === idempotencyKey;
        if (!sameOwner || !sameRequest || existing.deleted === true || existing.status === "DELETED" ||
            (existing.fingerprint && existing.fingerprint !== fingerprint) ||
            Number(existing.valorCents ?? Math.round(Number(existing.valor) * 100)) !== amountCents ||
            existing.origem !== origin || existing.destino !== destination) {
          fail("permission-denied", "Replay não pertence à tentativa original.");
        }
        const projection = buildCanonicalOperationProjection({ physicalJobId: jobId, operation: job, confirmedHistory: [...rows.values()] });
        return { registered: true, canonicalAckVersion: 1, confirmedTrip: canonicalTripAck({ ...existing, id: tripId, tripId, canonicalTripId: tripId }), duplicate: true, tripId, confirmedTripCount: projection.confirmedTripCount,
          total: Number(job.totalDeliveries ?? contract.totalDeliveries ?? 0), jobStatus: text(job.status, 50) };
      }
      if (attemptSnapshot.exists) {
        const saved = attemptSnapshot.data() || {};
        if (saved.fingerprint !== fingerprint || saved.tripId !== tripId) fail("failed-precondition", "Tentativa idempotente divergente.");
      }
      if (lockSnapshot.exists && !existingSnapshot.exists) fail("failed-precondition", "Reserva sem histórico confirmado; reconciliação necessária.");
      if (existingSnapshot.exists || attemptSnapshot.exists) fail("failed-precondition", "Tentativa existente sem confirmação válida; revisão necessária.");
      if (receiptObjectSnapshot?.exists) fail("already-exists", "Este comprovante já pertence a uma viagem registrada.");
      if (eventSnapshot?.exists) fail("failed-precondition", "Captura reservada sem histórico confirmado; revisão necessária.");
      if (receiptMatches?.docs.some((doc) => doc.id !== tripId && doc.get("deleted") !== true &&
          field(doc.data(), "driverId", "motoristaId") === uid && field(doc.data(), "companyId", "empresaId") === companyId)) {
        fail("already-exists", "Este comprovante já pertence a outra viagem.");
      }
      assertCompanyDriver(access);
      if (!jobSnapshot.exists || !contractSnapshot.exists || !companySnapshot.exists) fail("failed-precondition", "Operação, contrato ou empresa não disponíveis.");
      if (field(job, "driverId", "motoristaId", "userId") !== uid ||
          field(job, "companyId", "empresaId") !== companyId || field(job, "contractId", "contratoId") !== contractId ||
          field(contract, "companyId", "empresaId") !== companyId) fail("permission-denied", "Vínculo da operação inválido.");
      if (!activeStatus(job.status)) fail("failed-precondition", "Operação não iniciada ou não disponível.");
      const serverSimulator = [job.contractSnapshot?.simulatorId, job.contractSnapshot?.simulator,
        job.simulatorId, contract.simulatorId, contract.simulator,
        companySnapshot.get("simulatorId"), companySnapshot.get("simulatorName")]
        .map(normalizeSimulatorKey).find(Boolean);
      if (serverSimulator && normalizeSimulatorKey(simulator) && normalizeSimulatorKey(simulator) !== serverSimulator)
        fail("invalid-argument", "O simulador do comprovante não corresponde à operação.");
      if (serverSimulator === "gto") {
        // The client cannot evade the GTO evidence policy by relabelling its
        // source as generic/manual or removing gtoEntryMode from a Print.
        const evidence = typeof trip.receiptText === "string" ? trip.receiptText : "";
        const readAmount = isPrint ? readGtoPrintEvidence(evidence, trip.gtoReceiptEvidence).amountCents
          : readGtoReceiptAmountCents(evidence);
        if (isGeneric || !evidence || readAmount !== amountCents ||
            (isPrint && (trip.gtoEntryMode !== "print" || trip.gtoReceiptAnalyzed !== true || trip.gtoRewardedAdDetected === true)))
          fail("invalid-argument", "GTO_RECEIPT_ANALYSIS_REQUIRED");
      }
      if (isOperationallySuspended(userSnapshot.data() || {})) {
        fail("permission-denied", "Atividades operacionais suspensas.");
      }
      // Legacy operations created before canonical binding must be audited
      // before accepting another receipt. This prevents a previously corrupted
      // 3/12 projection from creating duplicate trips while old server rows are
      // still unbound to the operation. Replay paths above remain idempotent.
      if (Number(job.operationReconciliationVersion || 0) < 4 && Number(job.progress || 0) > 0) {
        fail("failed-precondition", "OPERATION_RECONCILIATION_REQUIRED");
      }
      const projection = buildCanonicalOperationProjection({ physicalJobId: jobId, operation: job, confirmedHistory: [...rows.values()] });
      const total = Number(job.totalDeliveries ?? contract.totalDeliveries);
      if (!Number.isInteger(total) || total < 1 || projection.confirmedTripCount >= total) fail("failed-precondition", "Limite da operação atingido.");
      // Capacity belongs to the canonical projection, not to stale/pending rows.
      // A historical same-job row without server confirmation is preserved for
      // audit but must never consume one of the live operation slots.
      const canonicalIds = new Set(projection.confirmedTripIds);
      const canonicalRows = [...rows.values()].filter((row) => canonicalIds.has(row.id));
      const canonicalClaims = claims.docs.filter((claim) => {
        const data = claim.data();
        return data.deleted !== true &&
          field(data, "driverId", "motoristaId", "userId") === uid &&
          field(data, "companyId", "empresaId") === companyId &&
          field(data, "contractId", "contratoId") === contractId &&
          canonicalIds.has(field(data, "tripId", "canonicalTripId"));
      });
      const operationSlot = allocateOperationSlot([
        ...canonicalRows.map((row) => row.data),
        ...canonicalClaims.map((doc) => doc.data()),
      ], total);
      if (operationSlot > total) fail("failed-precondition", "Não há slot livre para a operação.");
      const payload = Object.fromEntries(Object.entries(trip).filter(([key, value]) => value !== undefined && allowedFields.has(key) && !forbiddenFields.has(key)));
      delete payload.receiptText;
      delete payload.gtoReceiptEvidence;
      if (currencyEvidenceStatus !== "known") {
        for (const field of ["currency", "moeda", "simpleReceiptCurrency", "moneyCurrency", "receiptCurrency"]) delete payload[field];
      }
      const localTimestamp = (value: unknown): string | undefined => {
        const millis = typeof value === "number" ? value : Date.parse(String(value || ""));
        return Number.isFinite(millis) && millis > 0 && millis <= Date.now() + 5 * 60_000
          ? new Date(millis).toISOString() : undefined;
      };
      const completedAtLocal = localTimestamp(trip.completedAtLocal ?? trip.completedAtClient ?? trip.simpleReceiptCapturedAt);
      const createdAtLocal = localTimestamp(trip.createdAtLocal ?? trip.createdAtClient) || completedAtLocal;
      const vehicleId = field(job, "vehicleId", "veiculoId");
      const trailerId = operationTrailerId(job, contract);
      const vehicleMatches = Boolean(vehicleId) && text(trip.veiculoId) === vehicleId;
      const trailerMatches = Boolean(trailerId) && text(trip.reboqueId) === trailerId;
      delete payload.createdAtLocal;
      delete payload.completedAtLocal;
      const registeredAt = admin.firestore.Timestamp.now();
      const serverTrip = {
        ...payload, id: tripId, tripId, canonicalTripId: tripId, deterministicTripId: tripId,
        companyId, empresaId: companyId, driverId, motoristaId: driverId, jobId, operationId: jobId, trabalhoId: jobId,
        contractId, contratoId: contractId, origem: origin, destino: destination, valorCents: amountCents,
        valor: amountCents / 100, operationSlot, operationSlotKey: tripId, fingerprint,
        currencyEvidenceVersion: 1, currencyEvidenceStatus, currencyEvidenceSource,
        criadoPor: uid, dataLancamento: registeredAt,
        ...(createdAtLocal ? { createdAtLocal } : {}), ...(completedAtLocal ? { completedAtLocal } : {}),
        empresaNome: field(companySnapshot.data() || {}, "companyName", "name", "nome") || "Empresa",
        motoristaNome: driverDisplayIdentity(userSnapshot.data()).name,
        contratoNumero: operationContractName(job, contract),
        veiculoId: vehicleId,
        veiculoNome: field(job, "vehicleName", "veiculoNome") || (vehicleMatches ? text(trip.veiculoNome) : ""),
        veiculoPlaca: field(job, "vehiclePlate", "veiculoPlaca") || (vehicleMatches ? text(trip.veiculoPlaca) : ""),
        reboqueId: trailerId,
        reboqueNome: field(job, "trailerName", "reboqueNome") || field(contract, "trailerName", "reboqueNome") || (trailerMatches ? text(trip.reboqueNome) : ""),
        ...(storageReceiptKey ? { storageReceiptKey } : {}),
        ...(receiptEventKey ? { receiptEventKey } : {}),
        ...(canonicalCurrency ? { currency: canonicalCurrency } : {}),
        ...(isSimple && canonicalCurrency ? { simpleReceiptCurrency: canonicalCurrency } : {}),
        status: "concluida", recordStatus: "concluida",
        source: isGeneric ? (text(trip.source, 80) || "canonical_app") : "gto_auto",
        syncStatus: "synced", offlineSyncStatus: "synced",
        idempotencyKey, createdAt: registeredAt, completedAt: registeredAt,
        uploadedAt: registeredAt,
        serverValidatedAt: registeredAt, serverUpdatedAt: registeredAt,
        operationProjectionVersion: 4,
      };
      const slotRef = db.collection("trip_operation_slots").doc(tripId);
      tx.create(tripRef, serverTrip);
      tx.create(slotRef, { jobId, operationId: jobId, trabalhoId: jobId, driverId: uid, companyId, contractId, operationSlot, tripId, schemaVersion: 4, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.create(lockRef, { driverId: uid, companyId, jobId, idempotencyKey, tripId, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.create(attemptRef, { fingerprint, tripId, jobId, driverId: uid, idempotencyKey, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      if (eventRef) tx.create(eventRef, { fingerprint: eventFingerprint, tripId, jobId, driverId: uid, companyId,
        attemptId: text(trip.simpleReceiptCaptureAttemptId, 180),
        createdAt: admin.firestore.FieldValue.serverTimestamp() });
      if (receiptObjectRef) tx.create(receiptObjectRef, { tripId, jobId, driverId: uid, companyId,
        storageReceiptKey, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.update(jobRef, {
        ...managedOperationRevisionPatch(job),
        ...operationAwaitingCompletionPatch(job, contract, projection.confirmedTripCount + 1, total),
        progress: projection.confirmedTripCount + 1,
        lastValidatedTripId: tripId,
        operationReconciliationVersion: 4,
        operationProgressReconciled: true,
        operationProgressReconciledAt: admin.firestore.FieldValue.serverTimestamp(),
        progressUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { registered: true, canonicalAckVersion: 1, confirmedTrip: canonicalTripAck(serverTrip), duplicate: false, tripId, confirmedTripCount: projection.confirmedTripCount + 1, total,
        jobStatus: projection.confirmedTripCount + 1 >= total ? "awaiting_completion" : text(job.status, 50) };
    });
    functions.logger.info("NVU_TRIP_TIMING_520", { elapsedMs: Date.now() - startedAt, preflightMs,
      evidenceMs, transactionMs: Date.now() - startedAt - preflightMs - evidenceMs,
      transactionAttempts, duplicate: result.duplicate });
    return result;
  },
);
