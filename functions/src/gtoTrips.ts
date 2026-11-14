import { requireCompanyDriver } from "./companyAccess";
import { operationContractName, operationTrailerId, managedOperationRevisionPatch, operationTarget, operationContractMode } from "./operationSnapshotFields";
import * as functions from "firebase-functions/v1";
import * as admin from "./firebaseAdmin";
import { createHash } from "node:crypto";
import { finalValueCompatibilityIssue, parsePositiveNumber } from "./gtoMoney";
import { reconcileOperationTripsCore } from "./reconcileOperationTrips";
import { operationAwaitingCompletionPatch } from "./operationCompletion";


type CallableContext = functions.https.CallableContext;

const GTO_PROGRESS_SCHEMA_VERSION = 1;

type GtoTripRequest = {
  contractVersion?: unknown;
  sessionId?: unknown;
  driverId?: unknown;
  companyId?: unknown;
  jobId?: unknown;
  contractId?: unknown;
  contractMode?: unknown;
  vehicleId?: unknown;
  trailerId?: unknown;
  cargo?: unknown;
  companyRoute?: unknown;
  originCompany?: unknown;
  destinationCompany?: unknown;
  origin?: unknown;
  destination?: unknown;
  distanceKm?: unknown;
  offeredValue?: unknown;
  rawText?: unknown;
  selectedRow?: unknown;
  freightFingerprint?: unknown;
  finalValue?: unknown;
  completionStatus?: unknown;
  completedAtClient?: unknown;
  freightAuthorityId?: unknown;
  freightAuthorityRevision?: unknown;
  freightSource?: unknown;
  sourceLineIndex?: unknown;
  sourceLineFingerprint?: unknown;
  evidenceFingerprint?: unknown;
};

const text = (value: unknown, maxLength = 180): string => {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
};

const normalizeAlias = (value: unknown): string =>
  text(value, 200)
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const isGtoAlias = (...values: unknown[]): boolean =>
  values.some((value) => {
    const normalized = normalizeAlias(value);
    return normalized === "gto" || normalized === "global-truck-online" || normalized === "global-truck";
  });

const safeClientTimestamp = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const maxFuture = Date.now() + 24 * 60 * 60 * 1000;
  return parsed <= maxFuture ? Math.trunc(parsed) : null;
};

const assertDocumentId = (value: string, field: string): void => {
  if (!value || value.length > 220 || value.includes("/")) {
    throw new functions.https.HttpsError("invalid-argument", `${field} inválido.`);
  }
};

const assertBoundedText = (value: string, field: string, maxLength = 220): void => {
  if (value.length < 1 || value.length > maxLength || /[\u0000-\u001F]/.test(value)) {
    throw new functions.https.HttpsError("invalid-argument", `${field} inválido.`);
  }
};

const gtoPayloadFingerprint = (fields: Record<string, unknown>): string => {
  const ordered = [
    "sessionId", "driverId", "companyId", "jobId", "contractId", "vehicleId", "trailerId",
    "cargo", "companyRoute", "originCompany", "destinationCompany", "origin", "destination",
    "distanceKm", "offeredValue", "rawText", "selectedRow", "finalValue",
    "completionStatus", "completedAtClient",
  ].map((key) => [key, fields[key] ?? null]);
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
};

const freightFingerprintForRequest = (fields: {
  cargo: string;
  companyRoute: string;
  originCompany: string;
  destinationCompany: string;
  origin: string;
  destination: string;
  distanceKmRaw: string;
  offeredValueRaw: string;
  rawText: string;
  selectedRow: number;
}): string => {
  const ordered: Array<[string, string]> = [
    ["cargo", text(fields.cargo, 160)],
    ["companyRoute", text(fields.companyRoute, 220)],
    ["originCompany", text(fields.originCompany, 180)],
    ["destinationCompany", text(fields.destinationCompany, 180)],
    ["origin", text(fields.origin, 180)],
    ["destination", text(fields.destination, 180)],
    ["distanceKm", text(fields.distanceKmRaw, 80)],
    ["offeredValue", text(fields.offeredValueRaw, 80)],
    ["rawText", text(fields.rawText, 1200)],
    ["selectedRow", String(fields.selectedRow)],
  ];
  const canonical = ordered
    .map(([key, value]) => `${key}=${value.length}:${value}|`)
    .join("");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
};

const statusIsTripRecordable = (value: unknown): boolean => {
  const normalized = text(value, 40).toLowerCase();
  return normalized === "active" || normalized === "delayed";
};

const statusIsValidTrip = (value: unknown): boolean => {
  const normalized = normalizeAlias(value);
  return [
    "concluida",
    "concluido",
    "completed",
    "finalizado",
    "finalizada",
    "entregue",
  ].includes(normalized);
};

const hasUsableMetricDate = (data: admin.firestore.DocumentData): boolean => {
  const raw =
    data.completedAt ??
    data.dataFechamento ??
    data.date ??
    data.dataLancamento ??
    data.createdAt;
  if (!raw) return false;
  if (raw instanceof admin.firestore.Timestamp) return raw.toMillis() > 0;
  if (raw instanceof Date) return raw.getTime() > 0;
  if (typeof raw?.toMillis === "function") return Number(raw.toMillis()) > 0;
  if (typeof raw?.toDate === "function") return raw.toDate().getTime() > 0;
  const parsed = new Date(raw);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() > 0;
};

const isValidTripDocument = (data: admin.firestore.DocumentData): boolean => {
  const status = text(data.status, 80);
  const normalizedStatus = normalizeAlias(status);
  const canceled =
    ["cancelado", "cancelada", "canceled", "cancelled", "excluido", "excluida"].includes(
      normalizedStatus,
    ) ||
    data.cancelado === true ||
    data.deleted === true ||
    data.softDeleted === true;

  if (canceled) return false;
  if (statusIsValidTrip(status)) return true;
  return !status && hasUsableMetricDate(data);
};

const safeTripDocumentId = (uid: string, sessionId: string): string => {
  const digest = createHash("sha256")
    .update(`${uid}|${sessionId}`)
    .digest("hex")
    .slice(0, 40);
  return `gto_${uid}_${digest}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180);
};

const requireAuthenticatedUid = (context: CallableContext): string => {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Autenticação obrigatória para registrar a viagem GTO.",
    );
  }
  return uid;
};

const ensureNotSuspended = (user: admin.firestore.DocumentData, now: Date) => {
  const raw = user.operationalSuspendedUntil;
  const suspendedUntil = raw instanceof admin.firestore.Timestamp
    ? raw.toDate()
    : raw?.toDate?.() instanceof Date
      ? raw.toDate()
      : null;
  if (suspendedUntil && suspendedUntil.getTime() > now.getTime()) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "As atividades operacionais deste motorista estão suspensas.",
    );
  }
};

const resolveSimulator = async (
  database: admin.firestore.Firestore,
  company: admin.firestore.DocumentData,
): Promise<{ id: string; name: string; isGto: boolean }> => {
  const simulatorId = text(company.simulatorId ?? company.simuladorId, 180);
  let simulatorName = text(
    company.simulatorName ?? company.simuladorNome ?? company.simulator,
    180,
  );
  let catalog: admin.firestore.DocumentData | null = null;

  if (simulatorId) {
    const snapshot = await database.collection("simulators").doc(simulatorId).get();
    if (snapshot.exists) {
      catalog = snapshot.data() || {};
      simulatorName = text(
        catalog.name ?? catalog.simulatorName ?? catalog.nome ?? simulatorName,
        180,
      );
    }
  }

  return {
    id: simulatorId || "gto",
    name: simulatorName || "GTO",
    isGto: isGtoAlias(
      simulatorId,
      simulatorName,
      company.simulator,
      company.simuladorNome,
      catalog?.name,
      catalog?.simulatorName,
      catalog?.id,
    ),
  };
};

const tripMetricMillis = (data: admin.firestore.DocumentData): number => {
  const raw =
    data.completedAt ??
    data.dataFechamento ??
    data.date ??
    data.dataLancamento ??
    data.createdAt;
  if (!raw) return 0;
  if (raw instanceof admin.firestore.Timestamp) return raw.toMillis();
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw?.toMillis === "function") return Number(raw.toMillis()) || 0;
  if (typeof raw?.toDate === "function") return raw.toDate().getTime();
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const deriveSimpleCompletedRoutes = (
  docs: Array<{ id: string; data(): Record<string, any> }>,
): Array<{ origin: string; destination: string }> => {
  return docs
    .map((document) => ({ id: document.id, data: document.data() || {} }))
    .filter((entry) => isValidTripDocument(entry.data))
    .sort((a, b) => {
      const byTime = tripMetricMillis(a.data) - tripMetricMillis(b.data);
      return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
    })
    .map((entry) => {
      const data = entry.data;
      return {
        origin: text(data.origem ?? data.origin ?? data.gtoOriginCompany ?? data.gtoOrigin, 180),
        destination: text(data.destino ?? data.destination ?? data.gtoDestination, 180),
      };
    })
    .filter((route) => Boolean(route.origin) && Boolean(route.destination));
};

const syncJobProgress = async (
  database: admin.firestore.Firestore,
  jobId: string,
  _totalDeliveries: number,
  contractMode = "",
  uid = "",
): Promise<{ progress: number; jobStatus: string }> => {
  if (!uid) {
    throw new functions.https.HttpsError("unauthenticated", "Faça login para sincronizar a operação.");
  }

  // LIVE progress is rebuilt only from canonical trips already bound to the
  // physical jobId. Legacy/unbound attribution is intentionally outside the
  // live reconciler and requires a separately reviewed migration.
  const reconciliation = await reconcileOperationTripsCore(database, uid, jobId);
  if (reconciliation.status === "conflict") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `OPERATION_RECONCILIATION_REQUIRED:${reconciliation.reason}`,
    );
  }

  const jobRef = database.collection("trabalhos").doc(jobId);
  const freshJobSnapshot = await jobRef.get();
  if (!freshJobSnapshot.exists) {
    throw new functions.https.HttpsError("not-found", "Operação não encontrada.");
  }
  const freshJob = freshJobSnapshot.data() || {};
  const rawProgress = Number(freshJob.progress);
  const progress = Number.isFinite(rawProgress) && rawProgress >= 0
    ? Math.trunc(rawProgress)
    : Math.max(0, Number(reconciliation.serverProgress || reconciliation.confirmedCount || 0));
  const nextStatus = text(freshJob.status, 60);

  const metadataUpdate: Record<string, unknown> = {
    gtoProgressSchemaVersion: GTO_PROGRESS_SCHEMA_VERSION,
    gtoProgressSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (contractMode === "simple") {
    // The bound query is safe for route metadata because LIVE reconciliation
    // never attaches legacy/unbound rows. It is not a separate counter authority.
    const tripsSnapshot = await database
      .collection("historico_viagens")
      .where("jobId", "==", jobId)
      .get();
    metadataUpdate.completedRoutes = deriveSimpleCompletedRoutes(tripsSnapshot.docs);
    metadataUpdate.lastKnownGtoCity = admin.firestore.FieldValue.delete();
    metadataUpdate.gtoRouteContinuityUpdatedAt = admin.firestore.FieldValue.delete();
  }
  await jobRef.set(metadataUpdate, { merge: true });
  return { progress, jobStatus: nextStatus };
};

export const registerGtoTrip = functions.region("us-central1").https.onCall(
  async (rawData: GtoTripRequest, context) => {
    const db = admin.firestore();
    const uid = requireAuthenticatedUid(context);
    const clientContractVersionRaw = Number(rawData?.contractVersion);
    const clientContractVersion = Number.isFinite(clientContractVersionRaw) && clientContractVersionRaw > 0
      ? Math.trunc(clientContractVersionRaw)
      : 17;
    const sessionId = text(rawData?.sessionId, 160);
    const requestedDriverId = text(rawData?.driverId, 180);
    const companyId = text(rawData?.companyId, 180);
    const jobId = text(rawData?.jobId, 180);
    const contractId = text(rawData?.contractId, 180);
    const requestedContractMode = text(rawData?.contractMode, 20).toLowerCase();
    const requestedVehicleId = text(rawData?.vehicleId, 180);
    const requestedTrailerId = text(rawData?.trailerId, 180);
    const cargo = text(rawData?.cargo, 160);
    const companyRoute = text(rawData?.companyRoute, 220);
    const originCompany = text(rawData?.originCompany, 180);
    const destinationCompany = text(rawData?.destinationCompany, 180);
    const origin = text(rawData?.origin, 180);
    const destination = text(rawData?.destination, 180);
    const rawText = text(rawData?.rawText, 1200);
    const selectedRowRaw = Number(rawData?.selectedRow);
    const selectedRow = Number.isFinite(selectedRowRaw) ? Math.trunc(selectedRowRaw) : -1;
    const freightFingerprint = text(rawData?.freightFingerprint, 80);
    const distanceKmRaw = text(rawData?.distanceKm, 80);
    const offeredValueRaw = text(rawData?.offeredValue, 80);
    const distanceKm = parsePositiveNumber(rawData?.distanceKm);
    const offeredValue = parsePositiveNumber(rawData?.offeredValue);
    const finalValue = parsePositiveNumber(rawData?.finalValue);
    const completionStatus = text(rawData?.completionStatus, 80);
    const completedAtClient = safeClientTimestamp(rawData?.completedAtClient);
    const freightAuthorityId = text(rawData?.freightAuthorityId, 180);
    const freightAuthorityRevisionRaw = Number(rawData?.freightAuthorityRevision);
    const freightAuthorityRevision = Number.isFinite(freightAuthorityRevisionRaw)
      ? Math.max(0, Math.trunc(freightAuthorityRevisionRaw))
      : 0;
    const freightSource = text(rawData?.freightSource, 40);
    const sourceLineIndexRaw = Number(rawData?.sourceLineIndex);
    const sourceLineIndex = Number.isFinite(sourceLineIndexRaw) ? Math.trunc(sourceLineIndexRaw) : selectedRow;
    const sourceLineFingerprint = text(rawData?.sourceLineFingerprint, 80);
    const evidenceFingerprint = text(rawData?.evidenceFingerprint, 80);

    if (!/^[A-Za-z0-9_-]{8,160}$/.test(sessionId)) {
      throw new functions.https.HttpsError("invalid-argument", "sessionId inválido.");
    }
    for (const [field, value] of [
      ["companyId", companyId], ["jobId", jobId], ["contractId", contractId],
    ] as const) {
      assertDocumentId(value, field);
    }
    if (clientContractVersion >= 18 && !requestedDriverId) {
      throw new functions.https.HttpsError("invalid-argument", "driverId é obrigatório no contrato FIX18.");
    }
    if (requestedDriverId) assertDocumentId(requestedDriverId, "driverId");
    if (requestedDriverId && requestedDriverId !== uid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "A sessão GTO não pertence ao motorista autenticado.",
      );
    }
    assertBoundedText(cargo, "cargo");
    // Origin is the certified operational route. The company label is optional
    // metadata and must not be required or used to rewrite the route.
    if (originCompany) assertBoundedText(originCompany, "originCompany");
    // HF53 alignment: destinationCompany is optional metadata. Some valid GTO
    // routes (for example rural destinations) do not expose a destination
    // company. Requiring it here keeps a correctly sealed Android delivery in
    // retry forever even though the rest of the freight snapshot is valid.
    if (destinationCompany) assertBoundedText(destinationCompany, "destinationCompany");
    assertBoundedText(origin, "origin");
    assertBoundedText(destination, "destination");
    if (selectedRow < 0) {
      throw new functions.https.HttpsError("invalid-argument", "selectedRow inválido.");
    }
    if (!/^[a-f0-9]{64}$/.test(freightFingerprint)) {
      throw new functions.https.HttpsError("invalid-argument", "freightFingerprint inválido.");
    }
    const expectedFreightFingerprint = freightFingerprintForRequest({
      cargo,
      companyRoute,
      originCompany,
      destinationCompany,
      origin,
      destination,
      distanceKmRaw,
      offeredValueRaw,
      rawText,
      selectedRow,
    });
    if (freightFingerprint !== expectedFreightFingerprint) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "A identidade do frete não corresponde aos dados enviados; registro bloqueado.",
      );
    }
    // Origem and originCompany are different concepts. The certified freight's
    // `origin` is the operational route field; originCompany is optional metadata
    // from the card and must never overwrite the selected route value.
    if (sourceLineIndex !== selectedRow) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "A linha de origem do certificado não corresponde à linha selecionada.",
      );
    }
    if (freightAuthorityId && !/^[A-Za-z0-9_-]{8,180}$/.test(freightAuthorityId)) {
      throw new functions.https.HttpsError("invalid-argument", "freightAuthorityId inválido.");
    }
    if (sourceLineFingerprint && !/^[a-f0-9]{64}$/.test(sourceLineFingerprint)) {
      throw new functions.https.HttpsError("invalid-argument", "sourceLineFingerprint inválido.");
    }
    if (evidenceFingerprint && !/^[a-f0-9]{64}$/.test(evidenceFingerprint)) {
      throw new functions.https.HttpsError("invalid-argument", "evidenceFingerprint inválido.");
    }
    if (distanceKm <= 0 || distanceKm > 50_000 || finalValue <= 0 || finalValue > 1_000_000_000) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Distância ou valor final do frete GTO está fora da faixa válida.",
      );
    }
    if (offeredValue > 1_000_000_000) {
      throw new functions.https.HttpsError("invalid-argument", "Valor ofertado do frete GTO está fora da faixa válida.");
    }
    const moneyCompatibilityIssue = finalValueCompatibilityIssue(offeredValue, finalValue);
    if (moneyCompatibilityIssue) {
      throw new functions.https.HttpsError("failed-precondition", moneyCompatibilityIssue);
    }
    if (completionStatus !== "CONFIRMED_NORMAL") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Somente entregas GTO com recebimento normal podem ser registradas.",
      );
    }
    if (clientContractVersion >= 18 && completedAtClient === null) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "completedAtClient inválido para o contrato FIX18.",
      );
    }

    const payloadFingerprint = gtoPayloadFingerprint({
      sessionId,
      driverId: requestedDriverId || uid,
      companyId,
      jobId,
      contractId,
      vehicleId: requestedVehicleId,
      trailerId: requestedTrailerId,
      cargo,
      companyRoute,
      originCompany,
      destinationCompany,
      origin,
      destination,
      distanceKm,
      freightFingerprint,
      selectedRow,
      offeredValue: offeredValue || null,
      finalValue,
      completionStatus,
      completedAtClient,
    });

    const tripId = safeTripDocumentId(uid, sessionId);
    const tripRef = db.collection("historico_viagens").doc(tripId);
    const jobRef = db.collection("trabalhos").doc(jobId);

    const [
      userSnapshot,
      companySnapshot,
      jobSnapshot,
      contractSnapshot,
      existingTripSnapshot,
    ] = await Promise.all([
      db.collection("users").doc(uid).get(),
      db.collection("frotas").doc(companyId).get(),
      jobRef.get(),
      db.collection("contratos").doc(contractId).get(),
      tripRef.get(),
    ]);

    const contractForRetry = contractSnapshot.exists
      ? contractSnapshot.data() || {}
      : {};
    const retryTotalDeliveries = Math.max(
      0,
      operationTarget(jobSnapshot.data() || {}, contractForRetry),
    );

    // Idempotency must win over current operation state and resource cleanup.
    // If the server already created this exact session but the device missed
    // the response, a retry must still return success even if the first write
    // completed the operation or an administrator later archived its context.
    if (existingTripSnapshot.exists) {
      const existing = existingTripSnapshot.data() || {};
      const belongsToCaller =
        text(existing.driverId ?? existing.motoristaId, 180) === uid &&
        text(existing.gtoTripSessionId ?? existing.gtoSessionId, 160) === sessionId &&
        text(existing.companyId ?? existing.empresaId, 180) === companyId &&
        text(existing.jobId, 180) === jobId &&
        text(existing.contractId ?? existing.contratoId, 180) === contractId;
      const existingFingerprint = text(existing.gtoPayloadFingerprint, 80);

      if (!belongsToCaller || (existingFingerprint && existingFingerprint !== payloadFingerprint)) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "A sessão automática informada não corresponde à viagem existente.",
        );
      }

      if (jobSnapshot.exists) {
        const retryJob = jobSnapshot.data() || {};
        const retryProgress = Number(retryJob.progress);
        const hasCanonicalProgress =
          Number(retryJob.operationReconciliationVersion || 0) >= 4 &&
          Number.isFinite(retryProgress) &&
          retryProgress >= 0;
        if (hasCanonicalProgress) {
          return {
            success: true,
            contractVersion: 18,
            sessionId,
            tripId,
            created: false,
            duplicate: true,
            payloadFingerprint,
            progress: Math.trunc(retryProgress),
            jobStatus: text(retryJob.status, 60),
          };
        }

        // One-time migration/heal for jobs created before HF58. The first retry/
        // delivery scans historical trips, stamps the canonical progress schema,
        // and every subsequent GTO delivery can use the atomic O(1) fast path.
        const synced = await syncJobProgress(
          db,
          jobId,
          retryTotalDeliveries,
          operationContractMode(jobSnapshot.data() || {}, contractForRetry),
          uid,
        );
        return {
          success: true,
          contractVersion: 18,
          sessionId,
          tripId,
          created: false,
          duplicate: true,
          payloadFingerprint,
          progress: synced.progress,
          jobStatus: synced.jobStatus,
        };
      }

      return {
        success: true,
        contractVersion: 18,
        sessionId,
        tripId,
        created: false,
        duplicate: true,
        payloadFingerprint,
        progress: Number(existing.progress || 0),
        jobStatus: "",
      };
    }

    if (!userSnapshot.exists || !companySnapshot.exists || !jobSnapshot.exists || !contractSnapshot.exists) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "O contexto operacional da viagem não está mais disponível.",
      );
    }

    const user = userSnapshot.data() || {};
    const company = companySnapshot.data() || {};
    let job = jobSnapshot.data() || {};
    const contract = contractSnapshot.data() || {};
    const now = new Date();
    const totalDeliveries = Math.max(0, operationTarget(job, contract));

    ensureNotSuspended(user, now);

    const jobDriverId = text(job.driverId ?? job.motoristaId ?? job.userId, 180);
    if (jobDriverId !== uid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "O trabalho ativo não pertence ao motorista autenticado.",
      );
    }
    if (text(job.companyId, 180) !== companyId) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "O trabalho não pertence à empresa informada.",
      );
    }
    if (text(job.contractId, 180) !== contractId || text(contract.companyId, 180) !== companyId) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "O contrato não corresponde ao trabalho atual.",
      );
    }

    // GTO native calls this endpoint directly. Before a NEW trip is accepted,
    // force the same canonical audit used by Print/Pro/web finalization. This
    // closes the path that previously kept using the legacy jobId-only counter.
    if (Number(job.operationReconciliationVersion || 0) < 4) {
      const reconciliation = await reconcileOperationTripsCore(db, uid, jobId);
      if (reconciliation.status === "conflict") {
        throw new functions.https.HttpsError(
          "failed-precondition",
          `OPERATION_RECONCILIATION_REQUIRED:${reconciliation.reason}`,
        );
      }
      const refreshedJob = await jobRef.get();
      if (!refreshedJob.exists) {
        throw new functions.https.HttpsError("not-found", "Operação não encontrada após reconciliação.");
      }
      job = refreshedJob.data() || job;
    }

    if (!statusIsTripRecordable(job.status)) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "A operação não está disponível para registrar novas viagens.",
      );
    }
    if (totalDeliveries > 0 && Number(job.progress || 0) >= totalDeliveries) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "OPERATION_ALREADY_FULL",
      );
    }

    const serverContractMode = operationContractMode(job, contract);
    if (serverContractMode !== "simple" && serverContractMode !== "detailed") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "O contrato não possui um modo operacional válido para registrar a viagem GTO.",
      );
    }
    if (requestedContractMode && requestedContractMode !== serverContractMode) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "O modo do contrato mudou desde o início da sessão GTO.",
      );
    }
    if (serverContractMode === "detailed" && !origin) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "A origem é obrigatória em contratos detalhados.",
      );
    }

    // The selected/certified route is the single source of truth. The company
    // fields remain separate metadata and never rewrite the operational origin.
    const effectiveOrigin = origin;
    const effectiveOriginSource = freightAuthorityId ? "GTO_CERTIFIED_ORIGIN" : "GTO_ORIGIN_LEGACY";

    const simulator = await resolveSimulator(db, company);
    if (!simulator.isGto) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "O lançamento automático é permitido somente para empresas do simulador GTO.",
      );
    }

    const assignedJobVehicleId = text(job.vehicleId, 180);
    const assignedJobTrailerId = operationTrailerId(job, contract);
    if (requestedVehicleId && assignedJobVehicleId && requestedVehicleId !== assignedJobVehicleId) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "O veículo da operação mudou desde o início da viagem GTO.",
      );
    }
    if (requestedTrailerId && assignedJobTrailerId && requestedTrailerId !== assignedJobTrailerId) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "O reboque da operação mudou desde o início da viagem GTO.",
      );
    }

    const vehicleId = assignedJobVehicleId || requestedVehicleId;
    const trailerId = job.operationalCommandVersion === 1 ? assignedJobTrailerId : assignedJobTrailerId || requestedTrailerId;
    const [vehicleSnapshot, trailerSnapshot] = await Promise.all([
      vehicleId ? db.collection("veiculos").doc(vehicleId).get() : Promise.resolve(null),
      trailerId ? db.collection("reboques").doc(trailerId).get() : Promise.resolve(null),
    ]);
    const vehicle = vehicleSnapshot?.exists ? vehicleSnapshot.data() || {} : {};
    const trailer = trailerSnapshot?.exists ? trailerSnapshot.data() || {} : {};

    if (vehicleId && text(vehicle.companyId, 180) && text(vehicle.companyId, 180) !== companyId) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "O veículo não pertence à empresa do trabalho atual.",
      );
    }
    if (trailerId && text(trailer.companyId, 180) && text(trailer.companyId, 180) !== companyId) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "O reboque não pertence à empresa do trabalho atual.",
      );
    }

    const serverNow = admin.firestore.FieldValue.serverTimestamp();
    const driverName = text(user.name ?? user.nome ?? context.auth?.token?.name, 180) || "Motorista";
    const companyName = text(company.companyName ?? company.name ?? company.nome, 180) || "Empresa";
    const contractName = operationContractName(job, contract).slice(0, 180);
    const vehicleName = text(vehicle.name ?? vehicle.nome, 180);
    const trailerName = text(trailer.name ?? trailer.nome, 180);
    const transactionResult = await db.runTransaction(async (transaction) => {
      const [existingTrip, freshJob] = await Promise.all([
        transaction.get(tripRef),
        transaction.get(jobRef),
      ]);

      if (existingTrip.exists) {
        const existing = existingTrip.data() || {};
        const existingFingerprint = text(existing.gtoPayloadFingerprint, 80);
        const sameSession =
          text(existing.driverId ?? existing.motoristaId, 180) === uid &&
          text(existing.gtoTripSessionId ?? existing.gtoSessionId, 160) === sessionId &&
          text(existing.companyId ?? existing.empresaId, 180) === companyId &&
          text(existing.jobId, 180) === jobId &&
          text(existing.contractId ?? existing.contratoId, 180) === contractId;
        if (!sameSession || (existingFingerprint && existingFingerprint !== payloadFingerprint)) {
          throw new functions.https.HttpsError(
            "already-exists",
            "A chave desta sessão GTO já está vinculada a dados diferentes.",
          );
        }
        return { created: false, progressFastPath: false, progress: -1, jobStatus: "" };
      }

      await requireCompanyDriver(db, transaction, uid, companyId);
      const freshJobData = freshJob.exists ? freshJob.data() || {} : {};
      const freshDriverId = text(
        freshJobData.driverId ?? freshJobData.motoristaId ?? freshJobData.userId,
        180,
      );
      if (!freshJob.exists || freshDriverId !== uid || !statusIsTripRecordable(freshJobData.status)) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "A operação mudou antes da confirmação da viagem.",
        );
      }

      const currentProgress = Number(freshJobData.progress);
      if (totalDeliveries > 0 && Number.isFinite(currentProgress) && currentProgress >= totalDeliveries) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "OPERATION_ALREADY_FULL",
        );
      }
      const progressFastPath =
        Number(freshJobData.operationReconciliationVersion || 0) >= 4 &&
        Number.isFinite(currentProgress) &&
        currentProgress >= 0;
      let fastProgress = -1;
      let fastJobStatus = text(freshJobData.status, 60);

      if (progressFastPath) {
        fastProgress = Math.trunc(currentProgress) + 1;
        const progressUpdate: Record<string, unknown> = {
          ...managedOperationRevisionPatch(freshJobData),
          progress: fastProgress,
          operationReconciliationVersion: 4,
          gtoProgressSchemaVersion: GTO_PROGRESS_SCHEMA_VERSION,
          gtoProgressSyncedAt: serverNow,
        };

        if (serverContractMode === "simple") {
          const existingRoutes = Array.isArray(freshJobData.completedRoutes)
            ? freshJobData.completedRoutes
                .map((route: any) => ({
                  origin: text(route?.origin, 180),
                  destination: text(route?.destination, 180),
                }))
                .filter((route: { origin: string; destination: string }) =>
                  Boolean(route.origin) && Boolean(route.destination),
                )
            : [];
          progressUpdate.completedRoutes = [
            ...existingRoutes,
            { origin: effectiveOrigin, destination },
          ];
          progressUpdate.lastKnownGtoCity = admin.firestore.FieldValue.delete();
          progressUpdate.gtoRouteContinuityUpdatedAt = admin.firestore.FieldValue.delete();
        }

        if (
          totalDeliveries > 0 &&
          fastProgress >= totalDeliveries &&
          ["active", "delayed", "pending", "awaiting_completion"].includes(fastJobStatus)
        ) {
          // Final receipt atomically locks additional trips and exposes the
          // driver confirmation step. Terminal completion remains explicit.
          Object.assign(progressUpdate, operationAwaitingCompletionPatch(freshJobData, contract, fastProgress, totalDeliveries));
          fastJobStatus = "awaiting_completion";
        } else if (fastJobStatus === "pending" && fastProgress > 0) {
          fastJobStatus = "active";
          progressUpdate.status = fastJobStatus;
        }

        // Same transaction as the idempotent trip create: duplicate retries can
        // never increment progress twice, and a successful trip cannot exist without
        // its corresponding progress update once the job has been migrated to HF58.
        transaction.set(jobRef, progressUpdate, { merge: true });
      }

      transaction.create(tripRef, {
        tripId,
        empresaId: companyId,
        companyId,
        empresaNome: companyName,
        simulatorId: simulator.id,
        simulatorName: simulator.name,
        simuladorNome: simulator.name,
        motoristaId: uid,
        driverId: uid,
        motoristaNome: driverName,
        contratoId: contractId,
        contractId,
        contratoNumero: contractName,
        contratoDescricao: "",
        jobId,
        operationId: jobId,
        trabalhoId: jobId,
        canonicalTripId: tripId,
        deterministicTripId: tripId,
        recordStatus: "concluida",
        syncStatus: "synced",
        offlineSyncStatus: "synced",
        serverValidatedAt: serverNow,
        serverUpdatedAt: serverNow,
        operationSlot: fastProgress > 0 ? fastProgress : Math.max(1, Math.trunc(Number(freshJobData.progress) || 0) + 1),
        operationSlotKey: tripId,
        operationProjectionVersion: 4,
        veiculoId: vehicleId,
        veiculoNome: vehicleName,
        veiculoPlaca: text(vehicle.plate, 80),
        reboqueId: trailerId,
        reboqueNome: trailerName,
        carga: cargo,
        origem: effectiveOrigin,
        origemConhecida: Boolean(effectiveOrigin),
        origemFonte: effectiveOriginSource,
        destino: destination,
        distanciaPercorrida: distanceKm,
        valor: finalValue,
        valorPrevisto: offeredValue || null,
        status: "concluida",
        criadoPor: uid,
        dataLancamento: serverNow,
        completedAt: serverNow,
        createdAt: serverNow,
        updatedAt: serverNow,
        uploadedAt: serverNow,
        uploadedBy: uid,
        comprovanteUrl: "",
        comprovanteTituloOriginal: "",
        source: "gto_auto",
        registroAutomatico: true,
        automationSource: "gto-native-v1",
        gtoContractVersion: clientContractVersion,
        gtoPayloadFingerprint: payloadFingerprint,
        gtoTripSessionId: sessionId,
        gtoSessionId: sessionId,
        gtoCargo: cargo,
        gtoCompanyRoute: companyRoute,
        gtoOriginCompany: originCompany,
        gtoDestinationCompany: destinationCompany,
        gtoRequestOrigin: origin,
        gtoOrigin: effectiveOrigin,
        gtoOriginKnown: Boolean(effectiveOrigin),
        gtoOriginSource: effectiveOriginSource,
        gtoDestination: destination,
        gtoDistanceKm: distanceKm,
        gtoOfferedValue: offeredValue || null,
        gtoRawText: rawText,
        gtoSelectedRow: selectedRow,
        gtoFreightFingerprint: freightFingerprint,
        gtoFreightAuthorityId: freightAuthorityId || null,
        gtoFreightAuthorityRevision: freightAuthorityRevision || null,
        gtoFreightSource: freightSource || null,
        gtoSourceLineIndex: sourceLineIndex,
        gtoSourceLineFingerprint: sourceLineFingerprint || null,
        gtoEvidenceFingerprint: evidenceFingerprint || null,
        gtoFinalValue: finalValue,
        gtoMoneySchemaVersion: 2,
        gtoCompletionStatus: completionStatus,
        gtoCompletedAtClient: completedAtClient,
      });

      // Slot claim is written in the same transaction as the canonical trip and
      // progress. The job document serializes concurrent GTO receipts, so two
      // successful receipts cannot consume the same progress/slot.
      const operationSlot = fastProgress > 0 ? fastProgress : Math.max(1, Math.trunc(Number(freshJobData.progress) || 0) + 1);
      transaction.create(db.collection("trip_operation_slots").doc(tripId), {
        jobId, operationId: jobId, trabalhoId: jobId, driverId: uid, companyId, contractId,
        operationSlot, tripId, createdAt: serverNow, schemaVersion: 4,
      });

      return {
        created: true,
        progressFastPath,
        progress: fastProgress,
        jobStatus: fastJobStatus,
      };
    });

    const synced = transactionResult.progressFastPath
      ? { progress: transactionResult.progress, jobStatus: transactionResult.jobStatus }
      : await syncJobProgress(db, jobId, totalDeliveries, serverContractMode, uid);

    return {
      success: true,
      contractVersion: 18,
      sessionId,
      tripId,
      created: transactionResult.created,
      duplicate: !transactionResult.created,
      payloadFingerprint,
      progress: synced.progress,
      jobStatus: synced.jobStatus,
    };
  },
);
