import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";
import { createHash } from "node:crypto";
import {
  assertAccount,
  assertCompany,
  driverEligibility,
  fail,
  field,
  id,
  manager,
  membership,
  millis,
  readOperationalPreparation,
  roles,
  companySimulatorKey,
  snapshot,
  text,
} from "./operationalCommandPolicy";
import { normalizeSimulatorKey } from "./operationalWorkModePolicy";
import { buildCanonicalOperationProjection } from "./canonicalOperationProjection";
import { isTrustedServerConfirmedTrip } from "./isCanonicalConfirmedTrip";
import { planQueuePreparationRepair } from "./operationalQueuePreparation";
import {
  emptyQueueSettings,
  orderQueueContracts,
  queueApplies,
  visibleVehicleIds,
  type DriverQueueView,
  type OperationalQueue,
  type QueueCatalog,
  type QueueContract,
  type QueueItem,
  type QueueSettings,
} from "./operationalQueueModel";

type Data = Record<string, any>;
type DB = FirebaseFirestore.Firestore;
type Tx = FirebaseFirestore.Transaction;
type Context = functions.https.CallableContext;
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const running = ["active", "delayed", "awaiting_completion"];
const isLive = (row: Data) =>
  row.deleted !== true && row.softDeleted !== true && row.cancelado !== true;
const companyOf = (row: Data) => field(row, "companyId", "empresaId");
const driverOf = (row: Data) =>
  field(row, "driverId", "motoristaId", "userId", "criadoPor");
const contractOf = (row: Data) => field(row, "contractId", "contratoId");
const contractFields = [
  "companyId",
  "name",
  "sequenceId",
  "sequenceOrder",
  "simulator",
  "simulatorId",
  "mode",
  "totalDeliveries",
  "deadlineDays",
  "trailerId",
  "deliveries",
  "status",
  "deleted",
];
const historyFields = [
  "jobId",
  "operationId",
  "companyId",
  "empresaId",
  "driverId",
  "motoristaId",
  "userId",
  "criadoPor",
  "contractId",
  "contratoId",
  "recordStatus",
  "status",
  "source",
  "serverValidatedAt",
  "serverUpdatedAt",
  "uploadedAt",
  "offlineSyncStatus",
  "syncStatus",
  "validationStatus",
  "deleted",
  "softDeleted",
  "cancelado",
  "canonicalTripId",
  "tripId",
  "operationSlot",
  "operationSlotKey",
];
const jobFields = [
  "companyId",
  "empresaId",
  "driverId",
  "motoristaId",
  "userId",
  "contractId",
  "contratoId",
  "status",
  "deleted",
  "softDeleted",
  "cancelado",
  "totalDeliveries",
  "vehicleId",
  "assignedAt",
  "createdAt",
  "startedAt",
  "completedAt",
  "operationalCommandVersion",
  "operationSource",
  "operationStatusUpdatedByCanonicalGateway",
  "manualCompletionConfirmedAt",
  "completionSource",
];

function ids(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) fail("invalid-argument", `${label} inválidos.`);
  const result = (value as unknown[]).map((v) => id(v, label));
  if (result.length !== new Set(result).size)
    fail("invalid-argument", `${label} repetidos.`);
  return result;
}
function settingsOf(data: Data | undefined, companyId: string): QueueSettings {
  if (!data) return emptyQueueSettings(companyId);
  if (
    data.schemaVersion !== 1 ||
    data.companyId !== companyId ||
    !Number.isSafeInteger(data.revision)
  )
    fail(
      "failed-precondition",
      "A configuração das filas precisa ser conferida.",
    );
  return {
    companyId,
    schemaVersion: 1,
    revision: data.revision,
    queues: data.queues || [],
    vehicleIds: data.vehicleIds ?? null,
    driverVehicles: data.driverVehicles || [],
  };
}
export async function operationalQueueActor(
  tx: Tx,
  db: DB,
  companyId: string,
  context: Context,
  requireManager = false,
) {
  const uid = context.auth?.uid;
  if (!uid)
    fail("unauthenticated", "Faça login para consultar seus trabalhos.");
  const [companyDoc, account, members] = await Promise.all([
    tx.get(db.doc(`frotas/${companyId}`)),
    tx.get(db.doc(`users/${uid}`)),
    membership(tx, db, companyId, uid!),
  ]);
  if (!companyDoc.exists || !account.exists)
    fail("permission-denied", "Conta ou empresa não encontrada.");
  const company = companyDoc.data() || {};
  assertAccount(account.data() || {});
  assertCompany(company, false);
  const authorization = await tx.get(db.doc(`company_access/${companyId}/members/${uid}`));
  const isManager = manager(context, company, members, authorization.data() || {});
  if (requireManager && !isManager)
    fail(
      "permission-denied",
      "Somente a gestão da empresa pode alterar as filas.",
    );
  return { uid: uid!, company, isManager };
}
async function sources(tx: Tx, db: DB, companyId: string) {
  const [cfg, contracts, folders, vehicles, trailers] = await Promise.all([
    tx.get(db.doc(`operationalQueueSettings/${companyId}`)),
    tx.get(
      db
        .collection("contratos")
        .where("companyId", "==", companyId)
        .select(...contractFields),
    ),
    tx.get(
      db
        .collection("sequencias")
        .where("companyId", "==", companyId)
        .select("name", "scope", "deleted"),
    ),
    tx.get(
      db
        .collection("veiculos")
        .where("companyId", "==", companyId)
        .select("name", "plate", "status", "deleted", "companyId"),
    ),
    tx.get(
      db
        .collection("reboques")
        .where("companyId", "==", companyId)
        .select("name", "status", "deleted"),
    ),
  ]);
  const items = contracts.docs.map(
    (row) => ({ ...row.data(), id: row.id }) as QueueContract,
  );
  const folderRows = folders.docs
    .filter(
      (row) =>
        row.get("deleted") !== true &&
        [undefined, null, "operations"].includes(row.get("scope")),
    )
    .map((row) => ({
      id: row.id,
      name: text(row.get("name")),
      token: hash([
        row.id,
        row.data(),
        items
          .filter((c) => c.sequenceId === row.id && !c.deleted)
          .sort((a, b) => a.id.localeCompare(b.id)),
      ]),
    }));
  return {
    settings: settingsOf(cfg.data(), companyId),
    contracts: items,
    folders: folderRows,
    vehicles: vehicles.docs
      .filter((row) => row.get("deleted") !== true)
      .map((row) => ({ ...row.data(), id: row.id })),
    trailers: new Map(trailers.docs.map((row) => [row.id, row.data()])),
  };
}

/** Exhaustive server reads; a client cache or a limited query is never proof
 * that an original operation has not been completed. */
async function driverHistory(
  tx: Tx,
  db: DB,
  companyId: string,
  driverId: string,
  contracts: QueueContract[],
) {
  const [jobQueries, tripQueries, proofs, reviewDoc] = await Promise.all([
    Promise.all(
      ["driverId", "motoristaId", "userId"].map((key) =>
        tx.get(
          db
            .collection("trabalhos")
            .where(key, "==", driverId)
            .select(...jobFields),
        ),
      ),
    ),
    Promise.all(
      ["driverId", "motoristaId", "userId", "criadoPor"].map((key) =>
        tx.get(
          db
            .collection("historico_viagens")
            .where(key, "==", driverId)
            .select(...historyFields),
        ),
      ),
    ),
    tx.get(
      db
        .collection("driverOperationCompletions")
        .where("companyId", "==", companyId)
        .where("driverId", "==", driverId),
    ),
    tx.get(
      db.doc(`automaticQueueHistoryReviews/${hash([companyId, driverId])}`),
    ),
  ]);
  const contractIds = new Set(contracts.map((c) => c.id));
  const jobMap = new Map(
    jobQueries
      .flatMap((q) => q.docs)
      .filter(
        (row) =>
          companyOf(row.data()) === companyId &&
          driverOf(row.data()) === driverId,
      )
      .map((row) => [row.id, { ...row.data(), id: row.id } as Data]),
  );
  const trips = [
    ...new Map(
      tripQueries
        .flatMap((q) => q.docs)
        .filter(
          (row) =>
            driverOf(row.data()) === driverId &&
            (companyOf(row.data()) === companyId ||
              (!companyOf(row.data()) &&
                contractIds.has(contractOf(row.data())))),
        )
        .map((row) => [row.id, { id: row.id, data: row.data() }]),
    ).values(),
  ];
  const done = new Map<
    string,
    "canonical" | "legacy-ledger" | "manager-review"
  >();
  proofs.docs.forEach((row) => {
    if (
      row.get("completed") === true &&
      row.get("schemaVersion") === 1 &&
      row.get("proofSource") === "canonical-explicit-completion-v1" &&
      text(row.get("proofJobId"))
    )
      done.set(text(row.get("contractId")), "canonical");
  });
  const ambiguous = new Set<string>(),
    evidence: unknown[] = [];
  let unscoped = false;
  for (const job of jobMap.values()) {
    if (text(job.status).toLowerCase() !== "completed") continue;
    const contractId = contractOf(job);
    if (
      job.operationalCommandVersion === 1 &&
      job.operationStatusUpdatedByCanonicalGateway === true &&
      job.manualCompletionConfirmedAt &&
      job.completionSource === "driver-explicit-confirmation" &&
      done.get(contractId) === "canonical"
    )
      continue;
    const total = Number(job.totalDeliveries);
    const rows = trips.filter((row) => field(row.data, "jobId") === job.id);
    const projection =
      Number.isSafeInteger(total) && total > 0
        ? buildCanonicalOperationProjection({
            physicalJobId: job.id,
            operation: { ...job, companyId, driverId, contractId },
            confirmedHistory: rows,
          })
        : null;
    if (contractId && projection?.confirmedTripCount === total) {
      if (!done.has(contractId)) done.set(contractId, "legacy-ledger");
      continue;
    }
    if (contractId) ambiguous.add(contractId);
    else unscoped = true;
    evidence.push([
      "job",
      job.id,
      contractId,
      total || null,
      rows
        .map((row) => [row.id, row.data])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ]);
  }
  for (const trip of trips) {
    if (!isTrustedServerConfirmedTrip(trip.data)) continue;
    const jobId = field(trip.data, "jobId"),
      contractId = contractOf(trip.data);
    if (jobId && jobMap.has(jobId)) continue;
    if (contractId) ambiguous.add(contractId);
    else unscoped = true;
    evidence.push(["unbound", trip.id, trip.data]);
  }
  // New valid executions/receipts do not invalidate a review of old ambiguity.
  const historyToken = hash(
    evidence.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
  const review = reviewDoc.data() || {};
  const reviewValid =
    review.historyToken === historyToken &&
    review.companyId === companyId &&
    review.driverId === driverId;
  const reviewedIds = new Set<string>(
    reviewValid ? review.reviewedIds || [] : [],
  );
  if (reviewValid)
    (review.doneIds || []).forEach((cid: string) => {
      if (!done.has(cid)) done.set(cid, "manager-review");
    });
  const needsReview = (cid: string) =>
    !done.has(cid) && (ambiguous.has(cid) || unscoped) && !reviewedIds.has(cid);
  return {
    jobs: [...jobMap.values()],
    done,
    needsReview,
    historyToken,
    review,
    reviewValid,
  };
}

export async function readDriverQueueView(
  tx: Tx,
  db: DB,
  companyId: string,
  driverId: string,
  company: Data,
): Promise<DriverQueueView> {
  await driverEligibility(tx, db, companyId, driverId, true);
  const source = await sources(tx, db, companyId),
    settings = source.settings;
  const history = await driverHistory(
    tx,
    db,
    companyId,
    driverId,
    source.contracts,
  );
  const jobs = history.jobs.filter(isLive),
    current = jobs
      .filter((j) => running.includes(text(j.status).toLowerCase()))
      .sort(
        (a, b) =>
          millis(b.assignedAt || b.createdAt) -
          millis(a.assignedAt || a.createdAt),
      )[0];
  const manualPendingIds = jobs
    .filter((j) => j.status === "pending")
    .map((j) => j.id)
    .sort();
  const items: QueueItem[] = [],
    queues: DriverQueueView["queues"] = [];
  let next: DriverQueueView["next"] = null,
    blockedByReview = false;
  const allowedIds = visibleVehicleIds(settings, driverId);
  const companyKey = await companySimulatorKey(tx, db, company);
  const vehicles = source.vehicles
    .filter((v: Data) => allowedIds.has(v.id) && v.status !== "maintenance")
    .map((v: Data) => ({ id: v.id, name: text(v.name), plate: text(v.plate) }));
  for (const queue of settings.queues.filter((q) =>
    queueApplies(q, driverId),
  )) {
    const folder = source.folders.find((f) => f.id === queue.folderId);
    if (!folder) continue;
    const ordered = orderQueueContracts(
      source.contracts.filter((c) => !c.deleted && c.sequenceId === folder.id),
      queue.orderIds,
    );
    const rows: QueueItem[] = [];
    for (const [position, contract] of ordered.entries()) {
      let issue = "";
      try {
        if (
          normalizeSimulatorKey(
            (contract as Data).simulatorId || contract.simulator,
          ) !== companyKey
        )
          throw new Error("O simulador desta operação precisa de conferência.");
        if (contract.status !== "completed")
          snapshot(contract, contract.id, companyId, companyKey);
        if (
          contract.status !== "completed" &&
          !history.done.has(contract.id) &&
          contractOf(current || {}) !== contract.id &&
          text(contract.trailerId)
        ) {
          const trailer = source.trailers.get(text(contract.trailerId));
          if (!trailer || trailer.deleted === true)
            throw new Error(
              "O reboque desta operação precisa ser conferido pela empresa.",
            );
          if (trailer.status === "maintenance")
            throw new Error("O reboque desta operação está em manutenção.");
        }
      } catch (error) {
        issue =
          error instanceof Error
            ? error.message
            : "Os dados desta operação precisam de conferência.";
      }
      const state =
        current && contractOf(current) === contract.id
          ? "current"
          : history.done.has(contract.id)
            ? "done"
            : history.needsReview(contract.id)
              ? "review"
              : contract.status === "completed" || issue
                ? "unavailable"
                : "pending";
      rows.push({
        ...contract,
        queueId: queue.id,
        folderName: folder.name,
        position,
        state,
        ...(issue ? { issue } : {}),
        ...(history.done.has(contract.id)
          ? { completionSource: history.done.get(contract.id) }
          : {}),
        trailerName: text(source.trailers.get(text(contract.trailerId))?.name),
      });
      if (
        !next &&
        queue.state === "active" &&
        !current &&
        !manualPendingIds.length &&
        !blockedByReview
      ) {
        if (state === "review" || (state === "unavailable" && issue))
          blockedByReview = true;
        else if (state === "pending")
          next = {
            queueId: queue.id,
            contractId: contract.id,
            configRevision: settings.revision,
            previewToken: hash([
              companyId,
              driverId,
              settings.revision,
              queue,
              contract,
              [...allowedIds].sort(),
              history.historyToken,
            ]),
          };
      }
    }
    items.push(...rows);
    queues.push({
      id: queue.id,
      name: folder.name,
      state: queue.state,
      audience: queue.audience,
      count: rows.length,
      done: rows.filter(
        (r) => r.state === "done" || Boolean(r.completionSource),
      ).length,
      review: rows.filter((r) => r.state === "review").length,
    });
  }
  const last = [...history.jobs]
    .filter((j) => text(j.vehicleId))
    .sort(
      (a, b) =>
        (millis(b.assignedAt || b.createdAt) || 0) -
        (millis(a.assignedAt || a.createdAt) || 0),
    )[0];
  const reason: DriverQueueView["reason"] = current
    ? "running"
    : manualPendingIds.length
      ? "manual_pending"
      : blockedByReview
        ? "review"
        : !queues.length
          ? "no_queues"
          : !next
            ? "complete"
            : settings.vehicleIds === null
              ? "vehicles_unconfigured"
              : !vehicles.length
                ? "no_vehicles"
                : "ready";
  const model = {
    companyId,
    driverId,
    simulatorId: companyKey,
    configRevision: settings.revision,
    historyToken: history.historyToken,
    ...(history.reviewValid
      ? { reviewedAt: text(history.review.reviewedAt) }
      : {}),
    queues,
    items,
    vehicles,
    next,
    currentJob: current
      ? {
          id: current.id,
          contractId: contractOf(current),
          status: text(current.status),
        }
      : null,
    manualPendingIds,
    lastVehicleId: text(last?.vehicleId),
    reason,
  };
  return {
    ...model,
    viewToken: hash(model),
    generatedAt: new Date().toISOString(),
  };
}

/** Read-only part of the same transaction that creates an active execution. */
export async function resolveAutomaticStart(
  tx: Tx,
  db: DB,
  companyId: string,
  driverId: string,
  company: Data,
  args: Data,
) {
  const view = await readDriverQueueView(tx, db, companyId, driverId, company);
  if (!view.next || view.reason !== "ready")
    fail(
      "failed-precondition",
      view.reason === "manual_pending"
        ? "Inicie primeiro o trabalho encaminhado pela empresa."
        : view.reason === "running"
          ? "Finalize sua operação atual antes de iniciar outra."
          : view.reason === "review"
            ? "A empresa precisa conferir os trabalhos antigos antes do próximo início."
            : "Não há operação e veículo disponíveis para um novo início.",
    );
  if (
    view.configRevision !== args.configRevision ||
    view.next!.queueId !== args.queueId ||
    view.next!.contractId !== args.contractId ||
    view.next!.previewToken !== args.previewToken
  )
    fail(
      "aborted",
      "A fila foi atualizada pela empresa. Confira a próxima operação e confirme novamente.",
    );
  if (!view.vehicles.some((v) => v.id === args.vehicleId))
    fail("aborted", "A lista de veículos foi atualizada. Escolha novamente.");
  return { queueId: view.next!.queueId, configRevision: view.configRevision };
}

async function readCatalog(
  tx: Tx,
  db: DB,
  companyId: string,
): Promise<QueueCatalog> {
  const source = await sources(tx, db, companyId);
  const members = await tx.get(
    db.collection("companyMembers").where("companyId", "==", companyId),
  );
  const driverIds = [
    ...new Set(
      members.docs
        .filter(
          (row) =>
            row.get("status") === "active" &&
            roles(row.data()).includes("driver"),
        )
        .map((row) => text(row.get("userId")))
        .filter(Boolean),
    ),
  ];
  const users = driverIds.length
    ? await tx.getAll(
        ...driverIds.map((uid) => db.doc(`users/${id(uid, "Motorista")}`)),
      )
    : [];
  const drivers = users
    .filter(
      (row) =>
        row.exists &&
        ![
          "inactive",
          "suspended",
          "deleted",
          "removed",
          "blocked",
          "pending",
          "rejected",
        ].includes(text(row.get("status"))),
    )
    .map((row) => ({
      id: row.id,
      name:
        field(row.data() || {}, "name", "displayName", "nome") || "Motorista",
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const contracts = source.contracts.filter((c) => !c.deleted);
  const model = {
    companyId,
    configRevision: source.settings.revision,
    settings: source.settings,
    folders: source.folders,
    contracts,
    vehicles: source.vehicles as QueueCatalog["vehicles"],
    drivers,
  };
  return { ...model, viewToken: hash(model) };
}

export const getOperationalQueues = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onCall(async (input: Data, context) => {
    const companyId = id(input?.companyId, "Empresa"),
      db = admin.firestore();
    return db.runTransaction(
      async (tx) => {
        const actor = await operationalQueueActor(tx, db, companyId, context);
        const kind = text(input.kind);
        if (kind === "preparation") {
          if (!actor.isManager)
            fail("permission-denied", "A conferência dos trabalhos pertence à gestão da empresa.");
          return { success: true, version: 1, companyId,
            enabled: actor.company.operationalCommandVersion === 1,
            ...await readOperationalPreparation(tx, db, companyId) };
        }
        if (kind === "settings") {
          if (!actor.isManager)
            fail(
              "permission-denied",
              "A configuração pertence à gestão da empresa.",
            );
          const row = await tx.get(
            db.doc(`operationalQueueSettings/${companyId}`),
          );
          return {
            success: true,
            version: 1,
            companyId,
            settings: settingsOf(row.data(), companyId),
          };
        }
        const target = input.driverId
          ? id(input.driverId, "Motorista")
          : actor.uid;
        if ((kind === "catalog" || target !== actor.uid) && !actor.isManager)
          fail("permission-denied", "Você não pode consultar esta fila.");
        if (!["catalog", "driver"].includes(kind))
          fail("invalid-argument", "Consulta de fila inválida.");
        const model =
          kind === "catalog"
            ? await readCatalog(tx, db, companyId)
            : await readDriverQueueView(
                tx,
                db,
                companyId,
                target,
                actor.company,
              );
        const offset = Number(input.offset || 0),
          all =
            kind === "catalog"
              ? (model as QueueCatalog).contracts
              : (model as DriverQueueView).items;
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > all.length)
          fail("invalid-argument", "Página inválida.");
        if (input.viewToken && input.viewToken !== model.viewToken)
          fail(
            "aborted",
            "A fila mudou durante a atualização. Atualize a lista.",
          );
        if (offset && !input.viewToken)
          fail("invalid-argument", "Confirmação da lista obrigatória.");
        const page: typeof all = [];
        let size = 0;
        for (const item of all.slice(offset, offset + 100)) {
          const bytes = Buffer.byteLength(JSON.stringify(item));
          if (page.length && size + bytes > 650_000) break;
          if (bytes > 650_000)
            fail(
              "failed-precondition",
              "Uma operação é extensa demais para a fila. Revise seu roteiro.",
            );
          page.push(item as any);
          size += bytes;
        }
        const { items: _items, contracts: _contracts, ...view } = model as any;
        return {
          success: true,
          version: 1,
          companyId,
          kind,
          viewToken: model.viewToken,
          totalItems: all.length,
          offset,
          nextOffset:
            offset + page.length < all.length ? offset + page.length : null,
          view,
          items: page,
        };
      },
      { readOnly: true },
    );
  });

function signal(tx: Tx, db: DB, companyId: string) {
  tx.set(
    db.doc(`operationalQueueSignals/${companyId}`),
    {
      companyId,
      revision: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
export const operationalQueueSignal = signal;

export const configureOperationalQueues = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onCall(async (input: Data, context) => {
    const companyId = id(input?.companyId, "Empresa"),
      requestId = id(input?.requestId, "Pedido"),
      uid = context.auth?.uid;
    if (!uid) fail("unauthenticated", "Faça login para configurar as filas.");
    const db = admin.firestore(),
      requestRef = db.doc(
        `operationalQueueMutations/${hash([uid, requestId])}`,
      );
    // Object order has no business meaning; array order does (queue/item order).
    const stable = (v: any): any =>
      Array.isArray(v)
        ? v.map(stable)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .filter((k) => v[k] !== undefined)
                .map((k) => [k, stable(v[k])]),
            )
          : v;
    const fingerprint = hash(stable(input));
    return db.runTransaction(async (tx) => {
      const previous = await tx.get(requestRef);
      if (previous.exists) {
        if (
          previous.get("actorId") !== uid ||
          previous.get("fingerprint") !== fingerprint
        )
          fail(
            "failed-precondition",
            "Este pedido já foi usado com outros dados.",
          );
        return { ...previous.get("result"), replayed: true };
      }
      const actor = await operationalQueueActor(
          tx,
          db,
          companyId,
          context,
          true,
        ),
        catalog = await readCatalog(tx, db, companyId),
        settings = catalog.settings;
      const expected = Number(input.expectedRevision);
      if (!Number.isSafeInteger(expected) || expected !== settings.revision)
        fail(
          "aborted",
          "Outro gestor atualizou as filas. Confira a configuração atual.",
        );
      const action = text(input.action);
      const preparationAction = ["normalizeLegacyJobs", "resolveLegacyConflict"].includes(action);
      let preparationRepair: Awaited<ReturnType<typeof planQueuePreparationRepair>> | null = null;
      let reviewWrite: {
          ref: FirebaseFirestore.DocumentReference;
          data: Data;
        } | null = null;
      if (preparationAction) {
        if (![undefined, 0, 1].includes(actor.company.operationalCommandVersion))
          fail("failed-precondition", "Esta empresa usa outra versão da confirmação operacional.");
        preparationRepair = await planQueuePreparationRepair(tx, db, companyId, uid!, input,
          await readOperationalPreparation(tx, db, companyId));
      } else if (action === "saveQueue") {
        const q = input.queue || {},
          folderId = id(q.folderId, "Pasta"),
          folder = catalog.folders.find((f) => f.id === folderId);
        if (!folder)
          fail(
            "failed-precondition",
            "Escolha uma pasta de operações desta empresa.",
          );
        if (input.folderToken !== folder!.token)
          fail(
            "aborted",
            "A pasta mudou. Confira novamente a sequência de trabalhos.",
          );
        const orderIds = ids(q.orderIds, "Operações"),
          actual = catalog.contracts
            .filter((c) => c.sequenceId === folderId)
            .map((c) => c.id);
        if (
          orderIds.length !== actual.length ||
          actual.some((cid) => !orderIds.includes(cid))
        )
          fail(
            "aborted",
            "A pasta mudou. Atualize a sequência antes de salvar.",
          );
        if (
          !["active", "paused"].includes(q.state) ||
          !["all", "selected"].includes(q.audience)
        )
          fail("invalid-argument", "Escolha o público e o estado da fila.");
        const participants =
          q.audience === "all" ? [] : ids(q.driverIds, "Motoristas");
        if (
          q.audience === "selected" &&
          (!participants.length ||
            participants.some(
              (d) => !catalog.drivers.some((row) => row.id === d),
            ))
        )
          fail(
            "failed-precondition",
            "Escolha motoristas com vínculo ativo na empresa.",
          );
        if (q.state === "active" && !actual.length)
          fail(
            "failed-precondition",
            "Adicione operações à pasta antes de ativar a fila.",
          );
        if (q.state === "active") {
          const key = await companySimulatorKey(tx, db, actor.company);
          for (const c of catalog.contracts.filter(
            (c) => c.sequenceId === folderId && c.status !== "completed",
          )) {
            if (
              normalizeSimulatorKey((c as Data).simulatorId || c.simulator) !==
              key
            )
              fail(
                "failed-precondition",
                "Há uma operação de outro simulador nesta pasta.",
              );
            snapshot(c, c.id, companyId, key);
          }
        }
        const next: OperationalQueue = {
          id: folderId,
          folderId,
          state: q.state,
          audience: q.audience,
          driverIds: participants,
          orderIds,
        };
        const index = settings.queues.findIndex((row) => row.id === folderId);
        if (index >= 0) settings.queues[index] = next;
        else settings.queues.push(next);
      } else if (action === "setState") {
        const queueId = id(input.queueId, "Fila"),
          row = settings.queues.find((q) => q.id === queueId);
        if (!row || !["active", "paused", "archived"].includes(input.state))
          fail("invalid-argument", "Fila inválida.");
        if (
          input.state === "active" &&
          !catalog.folders.some((f) => f.id === row!.folderId)
        )
          fail(
            "failed-precondition",
            "A pasta desta fila não está disponível.",
          );
        if (input.state === "active") {
          const contracts = catalog.contracts.filter(
            (c) => c.sequenceId === row!.folderId,
          );
          if (!contracts.length)
            fail(
              "failed-precondition",
              "Adicione operações à pasta antes de retomar a fila.",
            );
          const key = await companySimulatorKey(tx, db, actor.company);
          for (const c of contracts.filter((c) => c.status !== "completed")) {
            if (
              normalizeSimulatorKey((c as Data).simulatorId || c.simulator) !==
              key
            )
              fail(
                "failed-precondition",
                "Há uma operação de outro simulador nesta pasta.",
              );
            snapshot(c, c.id, companyId, key);
          }
        }
        row!.state = input.state;
      } else if (action === "reorderQueues") {
        const order = ids(input.queueIds, "Filas"),
          active = settings.queues.filter((q) => q.state !== "archived");
        if (
          active.length !== order.length ||
          active.some((q) => !order.includes(q.id))
        )
          fail(
            "aborted",
            "A lista de filas mudou. Atualize antes de organizar.",
          );
        settings.queues = [
          ...order.map((qid) => active.find((q) => q.id === qid)!),
          ...settings.queues.filter((q) => q.state === "archived"),
        ];
      } else if (action === "saveVehicles") {
        const target = input.driverId ? id(input.driverId, "Motorista") : "";
        if (target && !catalog.drivers.some((d) => d.id === target))
          fail(
            "failed-precondition",
            "O motorista não possui vínculo ativo com a empresa.",
          );
        const chosen = ids(input.vehicleIds || [], "Veículos");
        if (chosen.some((vid) => !catalog.vehicles.some((v) => v.id === vid)))
          fail(
            "failed-precondition",
            "A lista de veículos mudou. Confira a seleção.",
          );
        if (
          target &&
          chosen.some((vid) => !(settings.vehicleIds || []).includes(vid))
        )
          fail(
            "failed-precondition",
            "A seleção do motorista deve usar os veículos disponíveis na frota.",
          );
        if (!target) settings.vehicleIds = chosen;
        else {
          settings.driverVehicles = settings.driverVehicles.filter(
            (row) => row.driverId !== target,
          );
          if (input.useDefault !== true)
            settings.driverVehicles.push({
              driverId: target,
              vehicleIds: chosen,
            });
        }
      } else if (action === "reviewHistory") {
        const driverId = id(input.driverId, "Motorista"),
          view = await readDriverQueueView(
            tx,
            db,
            companyId,
            driverId,
            actor.company,
          );
        if (
          !text(input.historyToken) ||
          input.historyToken !== view.historyToken
        )
          fail("aborted", "O histórico mudou. Confira novamente os trabalhos.");
        if (input.confirmed !== true)
          fail("invalid-argument", "Confirme a conferência do histórico.");
        const reviewedIds = ids(input.reviewedIds, "Operações conferidas"),
          doneIds = ids(input.doneIds, "Operações realizadas");
        if (
          !reviewedIds.length ||
          reviewedIds.some(
            (cid) => !view.items.some((item) => item.id === cid),
          ) ||
          doneIds.some((cid) => !reviewedIds.includes(cid))
        )
          fail(
            "invalid-argument",
            "A conferência deve corresponder às operações desta fila.",
          );
        const ref = db.doc(
            `automaticQueueHistoryReviews/${hash([companyId, driverId])}`,
          ),
          previousReview = (await tx.get(ref)).data() || {};
        const same = previousReview.historyToken === view.historyToken;
        const previouslyReviewed = new Set<string>(
          same ? previousReview.reviewedIds || [] : [],
        );
        if (
          reviewedIds.some(
            (cid) =>
              !view.items.some(
                (item) =>
                  item.id === cid &&
                  (item.state === "review" ||
                    item.completionSource === "manager-review" ||
                    previouslyReviewed.has(cid)),
              ),
          )
        )
          fail(
            "failed-precondition",
            "A conferência se aplica aos registros antigos indicados na fila.",
          );
        const reviewed = new Set<string>(
            same ? previousReview.reviewedIds || [] : [],
          ),
          completed = new Set<string>(same ? previousReview.doneIds || [] : []);
        reviewedIds.forEach((cid) => {
          reviewed.add(cid);
          if (doneIds.includes(cid)) completed.add(cid);
          else completed.delete(cid);
        });
        reviewWrite = {
          ref,
          data: {
            companyId,
            driverId,
            schemaVersion: 1,
            historyToken: view.historyToken,
            reviewedIds: [...reviewed],
            doneIds: [...completed],
            reviewedBy: uid,
            reviewedAt: new Date().toISOString(),
          },
        };
      } else fail("invalid-argument", "Configuração de fila inválida.");
      const activationRequested =
        (action === "saveQueue" && text(input.queue?.state) === "active") ||
        (action === "setState" && text(input.state) === "active");
      if (activationRequested && actor.company.operationalCommandVersion !== 1) {
        if (![undefined, 0].includes(actor.company.operationalCommandVersion))
          fail(
            "failed-precondition",
            "Esta empresa usa outra versão da confirmação operacional.",
          );
        const preparation = await readOperationalPreparation(tx, db, companyId);
        if (!preparation.ready)
          fail(
            "failed-precondition",
            `A ativação precisa de revisão: ${preparation.conflicts.length} motorista(s) com trabalhos simultâneos e ${preparation.invalidScopes.length} trabalho(s) com cadastro inconsistente. Abra a conferência de trabalhos.`,
            { reasonCode: "LEGACY_OPERATION_PREPARATION_REQUIRED",
              conflictCount: preparation.conflicts.length, invalidCount: preparation.invalidScopes.length },
          );
        fail(
          "failed-precondition",
          "Confirme a habilitação dos comandos operacionais separadamente antes de ativar a fila.",
          { reasonCode: "OPERATIONAL_COMMANDS_NOT_ENABLED" },
        );
      }
      settings.revision++;
      if (
        Buffer.byteLength(JSON.stringify(settings)) > 650_000 ||
        (reviewWrite &&
          Buffer.byteLength(JSON.stringify(reviewWrite.data)) > 650_000)
      )
        fail(
          "resource-exhausted",
          "A configuração ficou muito extensa. Divida os trabalhos em outras pastas.",
        );
      // All reads precede writes, including readiness, catalog and history.
      for (const write of preparationRepair?.writes || [])
        tx.update(write.ref, write.data);
      tx.update(db.doc(`frotas/${companyId}`), {
        automaticQueuesConfigured: true,
      });
      tx.set(db.doc(`operationalQueueSettings/${companyId}`), {
        ...settings,
        updatedBy: uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (reviewWrite) tx.set(reviewWrite.ref, reviewWrite.data);
      signal(tx, db, companyId);
      const result = {
        success: true,
        version: 1,
        companyId,
        requestId,
        action,
        settings,
      };
      tx.create(requestRef, {
        actorId: uid,
        companyId,
        fingerprint,
        action,
        result,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.create(db.doc(`operationalQueueAudits/${hash([uid, requestId])}`), {
        companyId,
        actorId: uid,
        action,
        revision: settings.revision,
        ...(preparationRepair ? { preparationReview: preparationRepair.audit,
          preparationToken: input.preparationToken } : {}),
        ...(reviewWrite
          ? {
              driverId: reviewWrite.data.driverId,
              historyToken: reviewWrite.data.historyToken,
              reviewedIds: reviewWrite.data.reviewedIds,
              doneIds: reviewWrite.data.doneIds,
            }
          : {}),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return result;
    });
  });

async function sourceChanged(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
  kind: "contract" | "folder" | "vehicle" | "trailer",
) {
  const before = change.before.data() || {},
    after = change.after.data() || {};
  const relevant = (d: Data) =>
    kind === "contract"
      ? Object.fromEntries(contractFields.map((k) => [k, d[k] ?? null]))
      : kind === "folder"
        ? [d.companyId, d.name, d.scope, d.deleted]
        : [d.companyId, d.name, d.plate, d.deleted, d.status === "maintenance"];
  if (hash(relevant(before)) === hash(relevant(after))) return;
  const db = admin.firestore();
  for (const cid of new Set(
    [companyOf(before), companyOf(after)].filter(Boolean),
  )) {
    await db.runTransaction(async (tx) => {
      const cfg = await tx.get(
        db.doc(`operationalQueueSettings/${id(cid, "Empresa")}`),
      );
      if (cfg.exists) signal(tx, db, cid);
    });
  }
}
export const refreshOperationalQueueContract = functions
  .region("us-central1")
  .runWith({ failurePolicy: true })
  .firestore.document("contratos/{id}")
  .onWrite((change) => sourceChanged(change, "contract"));
export const refreshOperationalQueueFolder = functions
  .region("us-central1")
  .runWith({ failurePolicy: true })
  .firestore.document("sequencias/{id}")
  .onWrite((change) => sourceChanged(change, "folder"));
export const refreshOperationalQueueVehicle = functions
  .region("us-central1")
  .runWith({ failurePolicy: true })
  .firestore.document("veiculos/{id}")
  .onWrite((change) => sourceChanged(change, "vehicle"));
export const refreshOperationalQueueTrailer = functions
  .region("us-central1")
  .runWith({ failurePolicy: true })
  .firestore.document("reboques/{id}")
  .onWrite((change) => sourceChanged(change, "trailer"));
