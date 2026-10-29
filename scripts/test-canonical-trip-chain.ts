import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDocFromServer, setDoc, updateDoc } from "firebase/firestore";
import { FirebaseTripSyncAdapter } from "../src/services/sync/FirebaseTripSyncAdapter";
import { SyncEngine } from "../src/services/sync/SyncEngine";
import { OfflineDatabase } from "../src/services/offline/OfflineDatabase";
import { OfflineFirstTripRepository } from "../src/services/offline/OfflineFirstTripRepository";
import { OfflineFirstCanonicalTripGateway } from "../src/application/trip/persistence/OfflineFirstCanonicalTripGateway";
import { CanonicalTripCommandService } from "../src/application/trip/CanonicalTripCommandService";
import { CanonicalTripOperationService } from "../src/application/trip/CanonicalTripOperationService";
import { CanonicalTripQueryService } from "../src/application/trip/CanonicalTripQueryService";
import { listenCanonicalTripsForScope } from "../src/application/trip/CanonicalTripRealtimeFirebaseAdapter";
import { canonicalTripRealtimeService } from "../src/application/trip/CanonicalTripRealtimeService";
import { TripEventBus } from "../src/domain/events/TripEventBus";
import { canonicalTripStore } from "../src/lib/CanonicalTripStore";
import { normalizeTrip } from "../src/lib/tripNormalizer";
import { buildDriverRankingPageData } from "../src/lib/rankingPageEngine";
import { rankingProjectionService } from "../src/application/ranking/RankingProjectionService";
import { beginAuthTeardown, endAuthTeardown } from "../src/lib/authLifecycle";
import { filterTombstonedTrips, tripTombstoneContract } from "../src/lib/tripTombstones";
import { createEmulatorReceipt } from "./helpers/emulatorReceipt";

const projectId = "demo-nvu-v36-4-staging";
const uid = "driver-1";
const companyId = "company-1";
const authUser = { uid };
const require = createRequire(import.meta.url);
const { registerCanonicalSimpleTrip } = require("../functions/lib/registerCanonicalSimpleTrip.js");
const admin = require("../functions/lib/firebaseAdmin");
if (!admin.apps.length) admin.initializeApp({ projectId });
const registerCanonicalTrip = async (data: Record<string, unknown>) => ({
  data: await registerCanonicalSimpleTrip.run(data, { auth: authUser }),
});
// Execute the real server reconciliation directly against the demo emulator.
// No fixture may fall back to the production Cloud Functions client.
const { reconcileOperationTripsCore } = require("../functions/lib/reconcileOperationTrips.js");
const createIsolatedAdapter = (dependencies: ConstructorParameters<typeof FirebaseTripSyncAdapter>[0]) => {
  assert.match(String(process.env.FIRESTORE_EMULATOR_HOST || ""), /^(127\.0\.0\.1|localhost):\d+$/);
  assert.equal(admin.app().options.projectId || process.env.GCLOUD_PROJECT, projectId);
  return new FirebaseTripSyncAdapter({
    ...dependencies,
    reconcileOperation: ({ jobId }) => reconcileOperationTripsCore(
      admin.firestore(), dependencies?.getCurrentUser?.()?.uid || uid, jobId,
    ),
  });
};
const sleep = (ms = 35) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (test: () => boolean, message: string) => {
  const until = Date.now() + 5_000;
  while (Date.now() < until) {
    if (test()) return;
    await sleep();
  }
  assert.ok(test(), message);
};

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Start Firestore Emulator via npm run verify:firestore-security");
}
if (!String(process.env.GCLOUD_PROJECT || process.env.FIREBASE_CONFIG || "").includes(projectId)) {
  throw new Error("The canonical trip-chain test requires the isolated demo Firebase project.");
}
const environment = await initializeTestEnvironment({
  projectId,
  firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
});

try {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", uid), { role: "driver", companyId, name: "Teste NVU" });
    await setDoc(doc(db, "users", "company-editor"), { role: "driver", companyId });
    await setDoc(doc(db, "users", "senior-editor"), { role: "senior", status: "active", name: "Senior E2E" });
    await setDoc(doc(db, "frotas", companyId), { companyId, userId: "company-owner-test" });
    await setDoc(doc(db, "companyMembers", `${uid}_${companyId}`), { userId: uid, companyId, status: "active", roles: ["driver"] });
    await setDoc(doc(db, "company_access", companyId, "members", uid), { userId: uid, companyId, status: "active", roles: ["driver"] });
    await setDoc(doc(db, "simulator_members", `company-editor_${companyId}`), {
      userId: "company-editor", companyId, role: "admin", status: "active",
    });
    for (const jobId of [
      "job-print-e2e",
      "job-pro-e2e",
      "job-offline-e2e",
      "job-duplicate-e2e",
      "job-network-e2e",
      "job-offline-delete-e2e",
    ]) {
      await setDoc(doc(db, "trabalhos", jobId), {
        driverId: uid,
        companyId,
        contractId: `contract-${jobId}`,
        status: "active",
        totalDeliveries: jobId === "job-duplicate-e2e" ? 2 : 1,
        progress: 0,
      });
      await setDoc(doc(db, "contratos", `contract-${jobId}`), {
        companyId, empresaId: companyId, status: "active", name: `Contrato ${jobId}`,
      });
    }
  });

  const driverDb = environment.authenticatedContext(uid).firestore();
  const operationService = new CanonicalTripOperationService({
    firestore: driverDb,
    getCurrentUser: () => authUser,
  });
const confirmedReceipts = new Set<string>();

  async function runScenario({
    name,
    jobId,
    tripId,
    value,
    offline = false,
    receiptKey,
  }: {
    name: "PRINT" | "PRO" | "OFFLINE";
    jobId: string;
    tripId: string;
    value: number;
    offline?: boolean;
    receiptKey?: string;
  }) {
    const inMemory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => inMemory.get(key) || null,
      setItem: (key: string, value: string) => { inMemory.set(key, value); },
    };
    const offlineDatabase = new OfflineDatabase();
    const receiptUrl = await createEmulatorReceipt(admin, companyId, uid, tripId);
    const adapter = createIsolatedAdapter({
      firestore: driverDb,
      getCurrentUser: () => authUser,
      loadOfflineReceipt: async (key) => receiptKey === key
        ? { key, userId: uid, companyId, fileName: `${tripId}.png`, contentType: "image/png", blob: new Blob(["receipt"]) }
        : undefined,
      markReceiptUploaded: async (key, url) => {
        assert.equal(key, receiptKey);
        assert.match(url, /^https:\/\//);
        confirmedReceipts.add(key);
      },
      uploadReceipt: async () => receiptUrl,
      registerCanonicalTrip,
    });
    const engine = new SyncEngine({ adapter, getCurrentUser: () => authUser, offlineDatabase, storage });
    const repository = new OfflineFirstTripRepository(offlineDatabase, engine);
    const gateway = new OfflineFirstCanonicalTripGateway(repository);
    let isOffline = offline;
    const command = new CanonicalTripCommandService(gateway, {
      getCurrentUser: () => authUser,
      isOffline: () => isOffline,
      sync: engine,
    });

    const realtime = new Set<string>();
    const stopRealtime = listenCanonicalTripsForScope(
      { driverId: uid },
      (trips) => trips.forEach((trip) => realtime.add(trip.tripId)),
      (error) => { throw error; },
      { firestore: driverDb, getCurrentUser: () => authUser },
    );
    const registeredEvents: any[] = [];
    const stopEvents = TripEventBus.subscribe((event) => {
      if (event.trip.tripId === tripId) registeredEvents.push(event);
    });

    try {
      await waitFor(() => true, "listener startup");
      const completedAt = new Date().toISOString();
      const trip: Record<string, unknown> = {
        tripId,
        clientRequestId: tripId,
        idempotencyKey: `${name.toLowerCase()}:${jobId}:${uid}`,
        source: name === "PRO" ? "PRO_SIMPLE_AUTOMATION" : "PRINT_PRO_REGISTRATION",
        driverId: uid,
        motoristaId: uid,
        companyId,
        empresaId: companyId,
        contractId: `contract-${jobId}`,
        jobId,
        origem: "Origem E2E",
        destino: "Destino E2E",
        valor: value,
        valorCents: Math.round(value * 100),
        // This test asserts the monetary ranking subtotal; keep that scenario
        // explicitly denominated. Registry fallback is covered separately.
        currency: "BRL",
        ...(name === "PRINT" || name === "OFFLINE"
          ? { imageHash: `hash-${tripId}`, comprovanteUrl: offline ? undefined : receiptUrl }
          : {
            simpleAutomation: true, simulatorKey: "GTO", simulatorCode: "GTO",
            simpleReceiptCurrency: "BRL", simpleReceiptResultScreenConfirmed: true, simpleReceiptBonusEvidence: "NONE",
            simpleReceiptConfidence: 1, simpleReceiptCaptureAttemptId: `attempt-${tripId}`,
          }),
        ...(name === "PRINT"
          ? {
            gtoEntryMode: "print", gtoReceiptAnalyzed: true, gtoReceiptValidationMode: "ocr",
            gtoRewardedAdDetected: false, valorDetectadoAutomaticamente: true, valorDeteccaoMetodo: "ocr",
            receiptText: `Concluído\nValor a receber: R$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          }
          : {}),
        ...(receiptKey ? { offlineReceiptKey: receiptKey, receiptSyncStatus: "awaiting_upload" } : {}),
      };

      const result = await command.addTripWithinOperationLimit(trip, {
        jobId,
        totalDeliveries: 1,
      });
      assert.equal(result.data?.canonicalTripId, tripId, "Print, Pro and offline must retain one stable canonicalTripId");
      if (offline) {
        assert.equal(result.offline, true, "offline request must return pending identity");
        assert.equal(engine.getResult(tripId)?.state, "PENDING_SYNC");
        assert.equal(
          (await getDocFromServer(doc(driverDb, "trip_operation_slots", tripId))).exists(),
          false,
          "no server slot may exist before reconnection",
        );
        const localProjection = CanonicalTripQueryService.listCanonicalTrips().find((item) => item.tripId === tripId);
        assert.equal(localProjection?.offlineSyncStatus, "pending_sync");
        isOffline = false;
        const replay = await engine.synchronize();
        assert.equal(replay.synchronized, 1, "reconnect must synchronize the queued trip");
      } else {
        if (result.offline) {
          const queued = engine.getResult(tripId);
          const local = offlineDatabase.get(tripId);
          const state = String(queued?.state || local?.syncStatus || "");
          assert.ok(["SYNCING", "PENDING_SYNC", "SERVER_CONFIRMED"].includes(state),
            `bounded UI response must retain a durable pending request or finish ACK; state=${state || "missing"}; error=${queued?.lastError || "none"}; stage=${queued?.lastFailureStage || "none"}`);
          if (state !== "SERVER_CONFIRMED") await engine.synchronize();
        }
        const finalResult = engine.getResult(tripId);
        assert.equal(finalResult?.state, "SERVER_CONFIRMED",
          `success requires server ACK even when the UI returned pending first; state=${finalResult?.state || "missing"}; error=${finalResult?.lastError || "none"}; stage=${finalResult?.lastFailureStage || "none"}`);
      }

      const remoteTrip = await getDocFromServer(doc(driverDb, "historico_viagens", tripId));
      assert.equal(remoteTrip.exists(), true, "Firestore must contain the canonical trip");
      assert.equal(remoteTrip.data()?.canonicalTripId, tripId, "Firebase identity must match the local canonicalTripId");
      assert.ok(remoteTrip.data().serverValidatedAt, "server ACK timestamp must be present");
      assert.equal(remoteTrip.data().offlineReceiptKey, undefined, "local receipt key must not leak to Firestore");
      assert.equal(remoteTrip.data().operationSlot, 1);
      if (receiptKey) {
        assert.equal(remoteTrip.data().comprovanteUrl, receiptUrl);
        assert.ok(confirmedReceipts.has(receiptKey), "receipt must be uploaded/acknowledged before Firestore replay");
      }

      const state = await operationService.readAuthoritativeOperationState(jobId, 1);
      assert.equal(state.progress, 1, "current operation must count exactly one server-confirmed trip");
      assert.equal(state.trips[0].tripId, tripId);
      await waitFor(() => realtime.has(tripId), "Firestore realtime must publish trip into driver history");

      const history = CanonicalTripQueryService.listCanonicalTrips()
        .filter((item) => item.jobId === jobId)
        .map((item) => normalizeTrip(item as any))
        .filter((item) => item.isValid);
      assert.equal(history.length, 1, "history projection must include exactly the confirmed trip");
      assert.equal(history[0].tripId, tripId);

      const ranking = buildDriverRankingPageData({
        trips: history,
        startDate: new Date("2020-01-01T00:00:00.000Z"),
        endDate: new Date("2099-12-31T23:59:59.999Z"),
        scope: "internal",
        companyId,
        tripsAlreadyFilteredBySimulator: true,
        users: [{ id: uid, name: "Teste NVU" }],
        companies: [{ id: companyId, name: "Empresa E2E" }],
        companyMembers: [{ userId: uid, companyId, role: "driver", status: "active" }],
      });
      assert.equal(ranking.length, 1, "ranking must include the server-confirmed driver");
      assert.equal(ranking[0].id, uid);
      assert.equal(ranking[0].trips, 1);
      assert.equal(ranking[0].val, value);
      assert.equal(engine.getResult(tripId)?.state, "SERVER_CONFIRMED");
      assert.ok(registeredEvents.some((event) => Boolean(event.trip.serverValidatedAt)), "reconciliation event must carry server-confirmed trip");
      console.log(`PASS ${name}: local/remote commit → history → ranking → operation progress`);
    } finally {
      stopEvents();
      stopRealtime();
    }
  }

  await runScenario({ name: "PRINT", jobId: "job-print-e2e", tripId: "trip-print-e2e", value: 1234.45 });
  await runScenario({ name: "PRO", jobId: "job-pro-e2e", tripId: "trip-pro-e2e", value: 1987.75 });
  await runScenario({ name: "OFFLINE", jobId: "job-offline-e2e", tripId: "trip-offline-e2e", value: 42.50, offline: true, receiptKey: "receipt-offline-e2e" });

  const editor = { uid: "company-editor" };
  // This scenario validates conflict resolution, not the membership resolver.
  // Use an explicit senior claim so the large legacy Rules graph does not
  // consume the emulator expression budget; company membership is covered by
  // test-membership-repository-contract and test-senior-company-resolution.
  const editorDb = environment.authenticatedContext(editor.uid, { senior: true }).firestore();
  const editDisk = new Map<string, string>();
  const editStorage = {
    getItem: (key: string) => editDisk.get(key) || null,
    setItem: (key: string, value: string) => { editDisk.set(key, value); },
  };
  const editDatabase = new OfflineDatabase({ storage: editStorage });
  const editEngine = new SyncEngine({
    adapter: createIsolatedAdapter({ firestore: editorDb, getCurrentUser: () => editor, registerCanonicalTrip }),
    getCurrentUser: () => editor, offlineDatabase: editDatabase, storage: editStorage,
  });
  let editingOffline = true;
  const editCommand = new CanonicalTripCommandService(
    new OfflineFirstCanonicalTripGateway(new OfflineFirstTripRepository(editDatabase, editEngine)),
    { getCurrentUser: () => editor, isOffline: () => editingOffline, sync: editEngine },
  );
  const beforeEdit = (await getDocFromServer(doc(editorDb, "historico_viagens", "trip-pro-e2e"))).data();
  const locallyEdited = await editCommand.update("trip-pro-e2e", { origem: "Origem offline", destino: "Destino offline" });
  assert.equal(locallyEdited.editPending, true);
  assert.equal((await getDocFromServer(doc(editorDb, "historico_viagens", "trip-pro-e2e"))).data()?.origem, beforeEdit?.origem,
    "offline edit must not claim a server write");
  editingOffline = false;
  const editReplay = await editEngine.synchronize();
  assert.equal(editReplay.synchronized, 1, "company editor's queued edit must replay under actor UID");
  assert.equal((await getDocFromServer(doc(editorDb, "historico_viagens", "trip-pro-e2e"))).data()?.destino, "Destino offline");
  assert.equal(editEngine.getResult("trip-pro-e2e")?.state, "SERVER_CONFIRMED");
  assert.equal(CanonicalTripQueryService.getTrip("trip-pro-e2e")?.editPending, false);

  const senior = { uid: "senior-editor" };
  const seniorDb = environment.authenticatedContext(senior.uid, { senior: true }).firestore();
  const seniorDisk = new Map<string, string>();
  const seniorStorage = {
    getItem: (key: string) => seniorDisk.get(key) || null,
    setItem: (key: string, value: string) => { seniorDisk.set(key, value); },
  };
  const seniorDatabase = new OfflineDatabase({ storage: seniorStorage });
  const seniorEngine = new SyncEngine({
    adapter: createIsolatedAdapter({ firestore: seniorDb, getCurrentUser: () => senior, registerCanonicalTrip }),
    getCurrentUser: () => senior, offlineDatabase: seniorDatabase, storage: seniorStorage,
  });
  const seniorCommand = new CanonicalTripCommandService(
    new OfflineFirstCanonicalTripGateway(new OfflineFirstTripRepository(seniorDatabase, seniorEngine)),
    { getCurrentUser: () => senior, isOffline: () => true, sync: seniorEngine },
  );
  const valueBefore = (await getDocFromServer(doc(seniorDb, "historico_viagens", "trip-pro-e2e"))).data()?.valor;
  await seniorCommand.update("trip-pro-e2e", {
    origem: "Origem offline", destino: "Destino offline", valor: 245.75, valorCents: 24575,
    valorEditadoNoPainelSenior: true, valorEditadoPor: senior.uid, valorEditadoEm: new Date(),
  });
  assert.equal(CanonicalTripQueryService.getTrip("trip-pro-e2e")?.valor, valueBefore,
    "a pending Senior value correction must not change confirmed earnings");
  assert.equal((await seniorEngine.synchronize()).synchronized, 1);
  assert.equal((await getDocFromServer(doc(seniorDb, "historico_viagens", "trip-pro-e2e"))).data()?.valor, 245.75);
  rankingProjectionService.invalidate("SENIOR_VALUE_EDIT_TEST");
  assert.equal(rankingProjectionService.project(
    [CanonicalTripQueryService.getTrip("trip-pro-e2e")!],
    { scope: "internal", companyId },
  ).rows[0]?.earnings, 245.75, "ranking must use the confirmed corrected value");

  editingOffline = true;
  await editCommand.update("trip-pro-e2e", { origem: "Rota local antiga", destino: "Destino offline" });
      await environment.withSecurityRulesDisabled(async (serverContext) => {
        await updateDoc(doc(serverContext.firestore(), "historico_viagens", "trip-pro-e2e"), {
          origem: "Rota alterada externamente",
        });
      });
  editingOffline = false;
  await editEngine.synchronize();
  assert.equal(editEngine.getResult("trip-pro-e2e")?.lastError, "CANONICAL_TRIP_CONFLICT_SERVER_WON");
  assert.equal(CanonicalTripQueryService.getTrip("trip-pro-e2e")?.origem, "Rota alterada externamente",
    "legacy route update must not be overwritten by a stale offline edit");

  const outsider = { uid: "outsider-editor" };
  const outsiderDb = environment.authenticatedContext(outsider.uid).firestore();
  const outsiderDisk = new Map<string, string>();
  const outsiderStorage = {
    getItem: (key: string) => outsiderDisk.get(key) || null,
    setItem: (key: string, value: string) => { outsiderDisk.set(key, value); },
  };
  const outsiderDatabase = new OfflineDatabase({ storage: outsiderStorage });
  const outsiderEngine = new SyncEngine({
    adapter: createIsolatedAdapter({ firestore: outsiderDb, getCurrentUser: () => outsider, registerCanonicalTrip }),
    getCurrentUser: () => outsider, offlineDatabase: outsiderDatabase, storage: outsiderStorage,
  });
  const outsiderCommand = new CanonicalTripCommandService(
    new OfflineFirstCanonicalTripGateway(new OfflineFirstTripRepository(outsiderDatabase, outsiderEngine)),
    { getCurrentUser: () => outsider, isOffline: () => true, sync: outsiderEngine },
  );
  await outsiderCommand.update("trip-pro-e2e", { origem: "Origem proibida", destino: "Destino proibido" });
  await outsiderEngine.synchronize();
  assert.equal(outsiderEngine.getResult("trip-pro-e2e")?.state, "FAILED");
  assert.equal(CanonicalTripQueryService.getTrip("trip-pro-e2e")?.origem, "Rota alterada externamente",
    "permission denial must restore the confirmed trip");

  const tombstoneDisk = new Map<string, string>();
  const eventListeners = new Map<string, Set<(event: Event) => void>>();
  const previousWindow = (globalThis as any).window;
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => tombstoneDisk.get(key) || null,
      setItem: (key: string, value: string) => { tombstoneDisk.set(key, value); },
    },
    addEventListener: (type: string, listener: (event: Event) => void) => {
      const listeners = eventListeners.get(type) || new Set();
      listeners.add(listener);
      eventListeners.set(type, listeners);
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => eventListeners.get(type)?.delete(listener),
    dispatchEvent: (event: Event) => {
      eventListeners.get(event.type)?.forEach((listener) => listener(event));
      return true;
    },
  };
  (globalThis as any).window = fakeWindow;
  const realtimeDatabase = (canonicalTripRealtimeService as any).offlineDatabase;
  const previousRealtimeStorage = realtimeDatabase.storage;
  realtimeDatabase.storage = fakeWindow.localStorage;
  try {
    let rejectedLocalRemovals = 0;
    const deniedDeletion = new CanonicalTripCommandService(
      { remove: async () => { rejectedLocalRemovals++; } } as any,
      {
        getCurrentUser: () => authUser,
        isOffline: () => false,
        sync: {
          deleteRemoteFirst: async () => { throw Object.assign(new Error("permission-denied"), { code: "permission-denied" }); },
          synchronize: async () => ({ synchronized: 0, results: [], validated: false }),
          getResult: () => undefined,
        } as any,
      },
    );
    await assert.rejects(deniedDeletion.deleteTrip("trip-print-e2e"), /permission-denied/);
    assert.equal(rejectedLocalRemovals, 0, "a denied server deletion must not hide the trip locally");

    const deleteStorage = new Map<string, string>();
    const deleteLocalStorage = {
      getItem: (key: string) => deleteStorage.get(key) || null,
      setItem: (key: string, value: string) => { deleteStorage.set(key, value); },
    };
    const deletionDatabase = new OfflineDatabase({ storage: deleteLocalStorage });
    const deletionQueueStorage = new Map<string, string>();
    const deletionQueue = {
      getItem: (key: string) => deletionQueueStorage.get(key) || null,
      setItem: (key: string, value: string) => { deletionQueueStorage.set(key, value); },
    };
    const deletionAdapter = createIsolatedAdapter({
      firestore: driverDb,
      getCurrentUser: () => authUser,
      registerCanonicalTrip,
    });
    const deletionEngine = new SyncEngine({
      adapter: deletionAdapter,
      getCurrentUser: () => authUser,
      offlineDatabase: deletionDatabase,
      storage: deletionQueue,
    });
    const deletionCommand = new CanonicalTripCommandService(
      new OfflineFirstCanonicalTripGateway(new OfflineFirstTripRepository(deletionDatabase, deletionEngine)),
      { getCurrentUser: () => authUser, isOffline: () => false, sync: deletionEngine },
    );
    await deletionCommand.deleteTrip("trip-print-e2e");

    const deletedRemote = await getDocFromServer(doc(driverDb, "historico_viagens", "trip-print-e2e"));
    assert.equal(deletedRemote.exists(), true, "deletion must preserve its canonical server document");
    assert.equal(deletedRemote.data()?.deleted, true, "Firestore must persist deleted=true");
    assert.equal(deletedRemote.data()?.status, "DELETED", "Firestore must persist status=DELETED");
    assert.ok(deletedRemote.data()?.deletedAt, "Firestore must persist the server deletion timestamp");
    assert.equal(deletedRemote.data()?.deletedBy, uid, "deletion actor must be server-persisted");
    assert.equal(deletionEngine.getResult("trip-print-e2e")?.state, "SERVER_CONFIRMED");
    assert.equal(deletionEngine.getResult("trip-print-e2e")?.operation, "DELETE");

    const persistedTombstone = new OfflineDatabase({ storage: deleteLocalStorage }).get("trip-print-e2e")?.trip as any;
    assert.equal(persistedTombstone?.deleted, true, "offline database must retain the tombstone after re-opening storage");
    assert.equal(persistedTombstone?.status, "DELETED");
    assert.ok(persistedTombstone?.deletedAt);
    const serializedTombstones = tombstoneDisk.get(tripTombstoneContract.storageKey) || "[]";
    assert.ok(serializedTombstones.includes("trip-print-e2e"), "tombstone ID must be persisted for cold startup");

    beginAuthTeardown();
    endAuthTeardown();
    assert.deepEqual(
      filterTombstonedTrips([{ id: "trip-print-e2e" }, { id: "survivor-trip" }]).map((trip) => trip.id),
      ["survivor-trip"],
      "a fresh tombstone-cache load must keep deleted trips out of old snapshots after simulated restart",
    );
    if (previousWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = previousWindow;

    const projected = CanonicalTripQueryService.listCanonicalTrips()
      .filter((trip) => trip.jobId === "job-print-e2e")
      .map((trip) => normalizeTrip(trip as any))
      .filter((trip) => trip.isValid);
    const rankingAfterDelete = buildDriverRankingPageData({
      trips: projected,
      startDate: new Date("2020-01-01T00:00:00.000Z"),
      endDate: new Date("2099-12-31T23:59:59.999Z"),
      scope: "internal",
      companyId,
      tripsAlreadyFilteredBySimulator: true,
      users: [{ id: uid, name: "Teste NVU" }],
      companies: [{ id: companyId, name: "Empresa E2E" }],
      companyMembers: [{ userId: uid, companyId, role: "driver", status: "active" }],
    });
    assert.equal(projected.length, 0, "history projection must exclude the deleted trip");
    assert.equal(rankingAfterDelete.length, 0, "ranking and earnings must exclude the deleted trip");
    const operationAfterDelete = await operationService.readAuthoritativeOperationState("job-print-e2e", 1);
    assert.equal(operationAfterDelete.trips.length, 0, "current operation must exclude the deleted trip");
    assert.equal(operationAfterDelete.progress, 0, "current operation count must be recomputed from live canonical trips");
    console.log("PASS definitive deletion: Firestore tombstone → durable local tombstone → cold restart filters history/ranking/current operation");
  } finally {
    realtimeDatabase.storage = previousRealtimeStorage;
    if (previousWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = previousWindow;
  }

  let offlineDelete = true;
  const offlineDeleteStorage = new Map<string, string>();
  const offlineDeleteQueue = new Map<string, string>();
  const offlineDeleteDb = new OfflineDatabase({ storage: {
    getItem: (key) => offlineDeleteStorage.get(key) || null,
    setItem: (key, value) => { offlineDeleteStorage.set(key, value); },
  } });
  const offlineDeleteSync = new SyncEngine({
    adapter: createIsolatedAdapter({ firestore: driverDb, getCurrentUser: () => authUser, registerCanonicalTrip }),
    getCurrentUser: () => authUser,
    offlineDatabase: offlineDeleteDb,
    storage: {
      getItem: (key) => offlineDeleteQueue.get(key) || null,
      setItem: (key, value) => { offlineDeleteQueue.set(key, value); },
    },
  });
  const offlineDeleteCommand = new CanonicalTripCommandService(
    new OfflineFirstCanonicalTripGateway(new OfflineFirstTripRepository(offlineDeleteDb, offlineDeleteSync)),
    { getCurrentUser: () => authUser, isOffline: () => offlineDelete, sync: offlineDeleteSync },
  );
  const offlineDeleteTripId = "trip-created-and-deleted-offline";
  const offlineDeleteTrip = {
    tripId: offlineDeleteTripId,
    clientRequestId: offlineDeleteTripId,
    idempotencyKey: `offline-delete:${uid}`,
    source: "PRO_SIMPLE_AUTOMATION",
    status: "concluida",
    driverId: uid,
    motoristaId: uid,
    companyId,
    empresaId: companyId,
    contractId: "contract-job-offline-delete-e2e",
    jobId: "job-offline-delete-e2e",
    valor: 5,
    valorCents: 500,
    motoristaNome: "Teste NVU",
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    dataLancamento: new Date().toISOString(),
    deleted: false,
  } as any;
  const offlineCreated = await offlineDeleteCommand.addTripWithinOperationLimit(offlineDeleteTrip);
  assert.equal(offlineCreated.offline, true, "offline trip creation must remain local until reconnection");
  await offlineDeleteCommand.deleteTrip(offlineDeleteTripId);
  assert.equal(offlineDeleteSync.getResult(offlineDeleteTripId)?.operation, "DELETE", "delete must supersede the unsent upsert");
  offlineDelete = false;
  const offlineDeleteReplay = await offlineDeleteSync.synchronize();
  if (offlineDeleteReplay.synchronized !== 1) {
    console.error("OFFLINE_DELETE_REPLAY_DIAGNOSTIC", JSON.stringify({ replay: offlineDeleteReplay, item: offlineDeleteSync.getResult(offlineDeleteTripId) }));
  }
  assert.equal(offlineDeleteReplay.synchronized, 1, "offline deletion must receive replay acknowledgement");
  assert.equal(offlineDeleteSync.getResult(offlineDeleteTripId)?.state, "SERVER_CONFIRMED");
  let offlineDeleteRemoteExists = false;
  await environment.withSecurityRulesDisabled(async (context) => {
    offlineDeleteRemoteExists = (await getDocFromServer(doc(context.firestore(), "historico_viagens", offlineDeleteTripId))).exists();
  });
  assert.equal(offlineDeleteRemoteExists, false,
    "a never-synced offline trip deleted before reconnect must not be recreated by replay");
  const offlineDeleteRecord = new OfflineDatabase({ storage: {
    getItem: (key) => offlineDeleteStorage.get(key) || null,
    setItem: (key, value) => { offlineDeleteStorage.set(key, value); },
  } }).get(offlineDeleteTripId)?.trip as any;
  assert.equal(offlineDeleteRecord?.deleted, true);
  assert.equal(offlineDeleteRecord?.status, "DELETED");
  assert.ok(offlineDeleteRecord?.deletedAt);
  console.log("PASS offline create/delete: queued upsert replaced by DELETE; replay cannot resurrect an unsent trip");

  const duplicateTrip = {
    tripId: "trip-duplicate-e2e",
    clientRequestId: "trip-duplicate-e2e",
    idempotencyKey: "pro:job-duplicate-e2e:driver-1",
    source: "PRO_SIMPLE_AUTOMATION",
    status: "concluida",
    driverId: uid,
    motoristaId: uid,
    companyId,
    empresaId: companyId,
    contractId: "contract-job-duplicate-e2e",
    jobId: "job-duplicate-e2e",
    origem: "Origem duplicidade",
    destino: "Destino duplicidade",
    valor: 77.7,
    valorCents: 7770,
    motoristaNome: "Teste NVU",
    // Idempotency is independent of the GTO low-value OCR policy; use a
    // neutral simulator key so this scenario exercises only duplicate replay.
    simulatorKey: "neutral-simulator",
    simpleAutomation: true,
    simpleReceiptCurrency: "BRL",
    simpleReceiptResultScreenConfirmed: true,
    simpleReceiptBonusEvidence: "NONE",
    simpleReceiptConfidence: 1,
    simpleReceiptCaptureAttemptId: "attempt-duplicate-e2e",
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    dataLancamento: new Date().toISOString(),
    deleted: false,
  } as any;
  const canonicalWriteDb = environment.authenticatedContext(uid, { senior: true }).firestore();
  const duplicateAdapter = createIsolatedAdapter({
    firestore: canonicalWriteDb,
    getCurrentUser: () => authUser,
    registerCanonicalTrip,
  });
  const firstDuplicateAck = await duplicateAdapter.push(duplicateTrip);
  const secondDuplicateAck = await duplicateAdapter.push(duplicateTrip);
  assert.equal(firstDuplicateAck.confirmed, true);
  assert.equal(secondDuplicateAck.confirmed, true, "replay with the same idempotency key must be acknowledged");
  await assert.rejects(
    () => duplicateAdapter.push({ ...duplicateTrip, idempotencyKey: "pro:job-duplicate-e2e:driver-1:second-request" } as any),
    (error: any) => error?.code === "permission-denied" || /PERMISSION_DENIED|permission-denied/i.test(String(error)),
    "the same canonical trip ID must not be overwritten by a different request key",
  );
  const duplicateRemote = await getDocFromServer(doc(canonicalWriteDb, "historico_viagens", duplicateTrip.tripId));
  assert.equal(duplicateRemote.data()?.idempotencyKey, duplicateTrip.idempotencyKey, "conflict must leave the original key unchanged");
  const duplicateJob = await getDocFromServer(doc(canonicalWriteDb, "trabalhos", duplicateTrip.jobId));
  assert.equal(duplicateRemote.exists(), true, "duplicate replay must keep one canonical trip");
  assert.equal(duplicateJob.data()?.progress, 1, "duplicate replay must not increment operation progress twice");
  console.log("PASS duplicate trip: idempotency lock → one historico_viagens document → one operation slot");

  let networkFailures = 1;
  const networkAdapter = createIsolatedAdapter({
    firestore: canonicalWriteDb,
    getCurrentUser: () => authUser,
    registerCanonicalTrip,
  });
  const flakyAdapter = {
    push: async (trip: any) => {
      if (networkFailures > 0) {
        networkFailures -= 1;
        throw Object.assign(new Error("simulated network interruption"), { code: "unavailable" });
      }
      return networkAdapter.push(trip);
    },
  };
  const networkStorage = new Map<string, string>();
  const networkStorageAdapter = {
    getItem: (key: string) => networkStorage.get(key) || null,
    setItem: (key: string, value: string) => { networkStorage.set(key, value); },
  };
  const networkDatabase = new OfflineDatabase({ storage: networkStorageAdapter });
  const flakyEngine = new SyncEngine({
    adapter: flakyAdapter,
    getCurrentUser: () => authUser,
    offlineDatabase: networkDatabase,
    storage: networkStorageAdapter,
  });
  const flakyCommand = new CanonicalTripCommandService(
    new OfflineFirstCanonicalTripGateway(new OfflineFirstTripRepository(networkDatabase, flakyEngine)),
    { getCurrentUser: () => authUser, isOffline: () => false, sync: flakyEngine },
  );
  const networkTrip = {
    ...duplicateTrip,
    tripId: "trip-network-e2e",
    clientRequestId: "trip-network-e2e",
    idempotencyKey: "pro:job-network-e2e:driver-1",
    jobId: "job-network-e2e",
    contractId: "contract-job-network-e2e",
  } as any;
  const pendingAfterNetworkFailure = await flakyCommand.addTripWithinOperationLimit(networkTrip);
  assert.equal(pendingAfterNetworkFailure.offline, true, "network failure must keep a durable pending identity");
  assert.equal(flakyEngine.getResult(networkTrip.tripId)?.state, "PENDING_SYNC");
  const persistedEnvelope = JSON.parse(networkStorageAdapter.getItem("nvu_canonical_trips.v2") || "null");
  assert.ok(persistedEnvelope?.records?.[networkTrip.tripId], "failed network trip must remain durably recorded");
  assert.ok(persistedEnvelope?.outbox?.[networkTrip.tripId], "retry command must share the durable canonical envelope");
  const queuedNetworkRetry = networkDatabase.readOutbox();
  assert.ok(Date.parse(queuedNetworkRetry[networkTrip.tripId].retryAt) > Date.now(), "transient failures must use backoff");
  queuedNetworkRetry[networkTrip.tripId].retryAt = new Date(Date.now() - 1).toISOString();
  networkDatabase.commitOutbox(queuedNetworkRetry);
  const replayAfterNetwork = await flakyEngine.synchronize();
  assert.equal(replayAfterNetwork.synchronized, 1, "later connectivity must replay the queued trip");
  assert.equal((await getDocFromServer(doc(canonicalWriteDb, "historico_viagens", networkTrip.tripId))).exists(), true);
  assert.equal((await getDocFromServer(doc(canonicalWriteDb, "trabalhos", networkTrip.jobId))).data()?.progress, 1);
  console.log("PASS network failure: unavailable → PENDING_SYNC → later reconnect → server ACK");

  console.log("PASS all canonical trip-chain E2E scenarios (Print, Pro, Offline replay, Definitive deletion, Offline create/delete, Duplicate, Network failure)");
} finally {
  await environment.cleanup();
}
