import { auth, db, functions } from "../../lib/firebase";
import { isConfirmedReceiptUploadUrl } from "../../lib/receiptTransportPolicy";
import {
  doc,
  getDocFromServer,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import type { CanonicalTrip } from "../../domain/trip/CanonicalTrip";
import { getOfflineReceipt, markOfflineReceiptUploaded } from "../../lib/offlineReceiptStore";
import { uploadService } from "../uploadService";
import { httpsCallable } from "firebase/functions";
import { buildCanonicalTripRegistrationRequest } from "./CanonicalTripRegistrationRequest";
import { tripSyncDeadline } from "../../lib/tripSyncDeadline";

type AuthUserLike = { uid: string } | null;
type PushResult = { confirmed: true; tripId: string; data: Record<string, unknown> };
type AdapterDependencies = {
  firestore?: Firestore;
  getCurrentUser?: () => AuthUserLike;
  registerCanonicalTrip?: (data: Record<string, unknown>) => Promise<{ data: unknown }>;
  loadOfflineReceipt?: (key: string) => ReturnType<typeof getOfflineReceipt>;
  markReceiptUploaded?: (key: string, url: string) => Promise<void>;
  uploadReceipt?: (input: {
    blob: Blob;
    fileName: string;
    contentType: string;
    companyId: string;
    userId: string;
  }) => Promise<string>;
  reconcileOperation?: (data: { jobId: string }) => Promise<unknown>;
  serverReadTimeoutMs?: number;
};

const readText = (value: unknown) => String(value ?? "").trim();

/**
 * Gateway de sincronização canônica. Registros novos são enviados ao writer
 * autoritativo do servidor, que confirma histórico, slot, idempotência, progresso
 * e conclusão na mesma transação. O cliente não promove sucesso local a remoto.
 */
export class FirebaseTripSyncAdapter {
  private readonly firestore: Firestore;
  private readonly getCurrentUser: () => AuthUserLike;
  private readonly registerCanonicalTrip: NonNullable<AdapterDependencies["registerCanonicalTrip"]>;
  private readonly loadOfflineReceipt: NonNullable<AdapterDependencies["loadOfflineReceipt"]>;
  private readonly markReceiptUploaded: NonNullable<AdapterDependencies["markReceiptUploaded"]>;
  private readonly uploadReceipt: NonNullable<AdapterDependencies["uploadReceipt"]>;
  private readonly reconcileOperation: NonNullable<AdapterDependencies["reconcileOperation"]>;
  private readonly serverReadTimeoutMs: number;

  constructor(dependencies: AdapterDependencies = {}) {
    this.serverReadTimeoutMs = dependencies.serverReadTimeoutMs ?? 10_000;
    this.firestore = dependencies.firestore || db;
    this.getCurrentUser = dependencies.getCurrentUser || (() => auth.currentUser);
    this.registerCanonicalTrip = dependencies.registerCanonicalTrip || (async (data) => {
      const register = httpsCallable(functions, "registerCanonicalSimpleTrip", { timeout: 20_000 });
      let result;
      try { result = await register(data); }
      catch (error) {
        if (String((error as any)?.code || "") !== "functions/unauthenticated" || !auth.currentUser) throw error;
        const owner = auth.currentUser.uid;
        await auth.currentUser.getIdToken(true);
        if (auth.currentUser?.uid !== owner) throw error;
        result = await register(data);
      }
      return { data: result.data };
    });
    this.loadOfflineReceipt = dependencies.loadOfflineReceipt || getOfflineReceipt;
    this.markReceiptUploaded = dependencies.markReceiptUploaded || markOfflineReceiptUploaded;
    this.uploadReceipt = dependencies.uploadReceipt || (async (input) => {
      const file = new File([input.blob], input.fileName, { type: input.contentType });
      return uploadService.uploadImage({
        file,
        companyId: input.companyId,
        userId: input.userId,
        folder: "receipts",
        storageScope: "trip-receipt",
        compressionMaxSizeMB: 1,
        maxWidthOrHeight: 1920,
        maxOutputBytes: 1_800_000,
      });
    });
    this.reconcileOperation = dependencies.reconcileOperation || (async (data) => {
      const reconcile = httpsCallable(functions, "reconcileOperationTrips", { timeout: 20_000 });
      const result = await reconcile(data);
      return result.data;
    });
  }

  /** A paused send resumes only after the server confirms current account and fleet access. */
  async authorizeRecovery(trip: CanonicalTrip): Promise<boolean> {
    const uid = this.getCurrentUser()?.uid;
    if (!uid || uid !== readText(trip.driverId) || !readText(trip.companyId)) return false;
    const check = httpsCallable(functions, "ensureCompanyAccess", { timeout: 20_000 });
    const result = await check({ companyId: trip.companyId });
    return this.getCurrentUser()?.uid === uid && (result.data as any)?.active === true;
  }

  async update(trip: CanonicalTrip, patch: Record<string, unknown>, baseVersion: number, editId: string, actorUserId: string, beforeEdit?: CanonicalTrip): Promise<PushResult> {
    const tripId = readText(trip.physicalDocumentId || trip.canonicalTripId || trip.tripId);
    if (!tripId || !editId || !actorUserId || this.getCurrentUser()?.uid !== actorUserId) {
      throw new Error("CANONICAL_TRIP_EDIT_IDENTITY_REQUIRED");
    }
    const keys = Object.keys(patch);
    const allowed = new Set(["origem", "destino", "valor", "valorCents", "valorEditadoNoPainelSenior", "valorEditadoPor", "valorEditadoEm"]);
    if (!keys.length || keys.some((key) => !allowed.has(key))) throw new Error("CANONICAL_TRIP_EDIT_FIELDS_INVALID");
    const changingValue = keys.some((key) => key !== "origem" && key !== "destino");
    if (changingValue && (!keys.includes("valor") || !keys.includes("valorCents") ||
        Number(patch.valorCents) !== Math.round(Number(patch.valor) * 100) ||
        Number(patch.valorCents) <= 0)) throw new Error("CANONICAL_TRIP_EDIT_VALUE_INVALID");

    const tripRef = doc(this.firestore, "historico_viagens", tripId);
    await runTransaction(this.firestore, async (transaction) => {
      const snapshot = await transaction.get(tripRef);
      if (!snapshot.exists()) throw new Error("CANONICAL_TRIP_NOT_FOUND");
      const current = snapshot.data() as Record<string, unknown>;
      if (current.deleted === true || current.status === "DELETED") {
        throw Object.assign(new Error("CANONICAL_TRIP_CONFLICT"), { code: "CANONICAL_TRIP_CONFLICT", serverTrip: { id: tripId, ...current } });
      }
      if (readText(current.driverId || current.motoristaId) !== readText(trip.driverId) ||
          readText(current.companyId || current.empresaId) !== readText(trip.companyId)) {
        throw Object.assign(new Error("CANONICAL_TRIP_CONFLICT"), { code: "CANONICAL_TRIP_CONFLICT", serverTrip: { id: tripId, ...current } });
      }
      if (current.lastEditId === editId) return;
      if (Math.max(1, Number(current.syncVersion || 1)) !== baseVersion) {
        throw Object.assign(new Error("CANONICAL_TRIP_CONFLICT"), { code: "CANONICAL_TRIP_CONFLICT", serverTrip: { id: tripId, ...current } });
      }
      if (beforeEdit && (("origem" in patch && readText(current.origem) !== readText((beforeEdit as any).origem)) ||
          ("destino" in patch && readText(current.destino) !== readText((beforeEdit as any).destino)) ||
          (changingValue && readText(current.valor) !== readText((beforeEdit as any).valor)))) {
        throw Object.assign(new Error("CANONICAL_TRIP_CONFLICT"), { code: "CANONICAL_TRIP_CONFLICT", serverTrip: { id: tripId, ...current } });
      }
      const serverPatch: Record<string, unknown> = {
        syncVersion: baseVersion + 1, lastEditId: editId, editedBy: actorUserId,
        updatedAt: serverTimestamp(), serverUpdatedAt: serverTimestamp(),
        clientUpdatedAt: readText(trip.clientUpdatedAt) || new Date().toISOString(),
      };
      if ("origem" in patch) serverPatch.origem = readText(patch.origem);
      if ("destino" in patch) serverPatch.destino = readText(patch.destino);
      if (changingValue) {
        serverPatch.valor = Number(patch.valor);
        serverPatch.valorCents = Number(patch.valorCents);
        serverPatch.valorEditadoNoPainelSenior = true;
        serverPatch.valorEditadoPor = actorUserId;
        serverPatch.valorEditadoEm = serverTimestamp();
      }
      transaction.update(tripRef, serverPatch);
    });
    const confirmed = await tripSyncDeadline(getDocFromServer(tripRef), this.serverReadTimeoutMs, "EDIT_SERVER_READ");
    if (!confirmed.exists() || confirmed.data().lastEditId !== editId) throw new Error("SERVER_TRIP_EDIT_ACK_INVALID");
    return { confirmed: true, tripId, data: { id: tripId, ...confirmed.data() } };
  }

  async push(trip: CanonicalTrip): Promise<PushResult> {
    let stage = "LOCAL_VALIDATION";
    let registrationAccepted = false;
    try {
      const tripId = readText(trip.canonicalTripId || trip.tripId || trip.clientRequestId || trip.idempotencyKey);
      const suppliedTripId = readText(trip.tripId);
      const driverId = readText((trip as any).driverId || (trip as any).motoristaId);
      const companyId = readText((trip as any).companyId || (trip as any).empresaId);
      const jobId = readText((trip as any).jobId);
      const idempotencyKey = readText(trip.idempotencyKey || trip.clientRequestId);
      const user = this.getCurrentUser();

      if (!tripId || !driverId || !companyId || !jobId || !idempotencyKey) {
        throw new Error("CANONICAL_TRIP_REQUIRED_FIELDS_MISSING");
      }
      if (suppliedTripId && suppliedTripId !== tripId) throw new Error("CANONICAL_TRIP_IDENTITY_MISMATCH");
      if (!user?.uid || user.uid !== driverId) {
        throw new Error("CANONICAL_TRIP_AUTH_SCOPE_MISMATCH");
      }

      if ((trip as any).gtoEntryMode === "print" &&
          (!Number.isFinite(Number((trip as any).valor)) || Number((trip as any).valor) <= 0)) {
        throw new Error("GTO_PRINT_AMOUNT_INVALID");
      }
      const tripRef = doc(this.firestore, "historico_viagens", tripId);
      let receiptUrl = readText((trip as any).comprovanteUrl);
      const receiptKey = readText((trip as any).offlineReceiptKey);
      if (receiptKey) {
        stage = "RECEIPT_LOAD";
        const receipt = await this.loadOfflineReceipt(receiptKey);
        if (!receipt || receipt.userId !== driverId || receipt.companyId !== companyId) {
          throw new Error("OFFLINE_RECEIPT_OWNER_OR_DATA_MISMATCH");
        }
        stage = "RECEIPT_UPLOAD";
        receiptUrl = receipt.uploadedUrl || await this.uploadReceipt({
          blob: receipt.blob,
          fileName: receipt.fileName,
          contentType: receipt.contentType,
          companyId,
          userId: driverId,
        });
        if (!isConfirmedReceiptUploadUrl(receiptUrl)) throw new Error("OFFLINE_RECEIPT_UPLOAD_NOT_CONFIRMED");
        stage = "RECEIPT_LOCAL_SAVE";
        await this.markReceiptUploaded(receiptKey, receiptUrl);
      }
      if ((trip as any).imageHash && !isConfirmedReceiptUploadUrl(receiptUrl)) {
        throw new Error("TRIP_RECEIPT_URL_NOT_CONFIRMED");
      }

      // V4: every Web/Print/Pro/offline registration crosses one server-owned
      // writer. The browser never creates a confirmed history row, claims a slot
      // or mutates the operation counter directly. Native GTO has its own callable
      // (registerGtoTrip) but converges on the same canonical ledger.
      if (this.getCurrentUser()?.uid !== driverId) throw new Error("CANONICAL_TRIP_AUTH_SCOPE_MISMATCH");
      stage = "CALLABLE_REGISTRATION";
      const request = buildCanonicalTripRegistrationRequest(trip as any, receiptUrl);
      let callableResult: {data: unknown};
      try { callableResult = await this.registerCanonicalTrip(request); }
      catch (error) {
        const reason = String((error as any)?.message || "");
        const code = String((error as any)?.code || "");
        if (!code.includes("failed-precondition") ||
            !/OPERATION_RECONCILIATION_REQUIRED|reserva (?:operacional )?sem hist[oó]rico|reconcilie a opera[cç][aã]o/i.test(reason)) throw error;
        // One server-owned repair, then the exact same request. No receipt,
        // operation identity or confirmed financial value is changed here.
        stage = "OPERATION_RECONCILIATION";
        await tripSyncDeadline(this.reconcileOperation({jobId}), 20_000, stage);
        if (this.getCurrentUser()?.uid !== driverId) throw new Error("CANONICAL_TRIP_AUTH_SCOPE_MISMATCH");
        stage = "CALLABLE_REGISTRATION";
        callableResult = await this.registerCanonicalTrip(request);
      }
      stage = "CALLABLE_ACK";
      const payload = callableResult.data as Record<string, unknown>;
      const acknowledgedId = readText(payload.tripId);
      const receiptDuplicate = payload.duplicate === true && payload.receiptEventDuplicate === true;
      if (payload.registered !== true || !acknowledgedId ||
          (acknowledgedId !== tripId && !receiptDuplicate)) {
        throw new Error("SERVER_CANONICAL_TRIP_ACK_INVALID");
      }
      registrationAccepted = true;
      // A lost ACK may be returned as the same captured event under an older
      // canonical document ID. Never accept an arbitrary alternate ID.
      stage = "SERVER_READ";
      const confirmed = await tripSyncDeadline(getDocFromServer(acknowledgedId === tripId
        ? tripRef : doc(this.firestore, "historico_viagens", acknowledgedId)), this.serverReadTimeoutMs, "SERVER_READ");
      stage = "SERVER_ACK";
      if (!confirmed.exists() || !confirmed.data().serverValidatedAt) {
        throw new Error("SERVER_CANONICAL_TRIP_ACK_MISSING");
      }
      const saved = confirmed.data();
      if (saved.deleted === true || saved.status === "DELETED" ||
          readText(saved.driverId || saved.motoristaId) !== driverId ||
          readText(saved.companyId || saved.empresaId) !== companyId || readText(saved.jobId) !== jobId ||
          readText(saved.contractId || saved.contratoId) !== readText((trip as any).contractId || (trip as any).contratoId) ||
          Number(saved.valorCents ?? Math.round(Number(saved.valor) * 100)) !== Number((trip as any).valorCents ?? Math.round(Number((trip as any).valor) * 100))) {
        throw new Error("SERVER_CANONICAL_TRIP_ACK_SCOPE_MISMATCH");
      }
      if (acknowledgedId !== tripId && (
          readText(saved.driverId || saved.motoristaId) !== driverId ||
          readText(saved.companyId || saved.empresaId) !== companyId ||
          readText(saved.jobId) !== jobId ||
          readText(saved.contractId || saved.contratoId) !== readText((trip as any).contractId || (trip as any).contratoId) ||
          readText(saved.origem) !== readText((trip as any).origem) ||
          readText(saved.destino) !== readText((trip as any).destino) ||
          Number(saved.valorCents) !== Number((trip as any).valorCents))) {
        throw new Error("SERVER_CANONICAL_TRIP_ACK_SCOPE_MISMATCH");
      }
      if (acknowledgedId !== tripId && (
          !readText(saved.receiptEventKey) ||
          readText(saved.simpleReceiptCaptureContextEpoch) !== readText((trip as any).simpleReceiptCaptureContextEpoch) ||
          Number(saved.simpleReceiptCapturedAt) !== Number((trip as any).simpleReceiptCapturedAt))) {
        throw new Error("SERVER_CANONICAL_TRIP_ACK_CAPTURE_MISMATCH");
      }
      return { confirmed: true, tripId: acknowledgedId, data: { id: confirmed.id, ...saved } };
    } catch (error) {
      // Store only this fixed stage code; payloads, identities and receipts
      // remain private. Classification never changes the original failure.
      // A frozen provider error must retain its original code and semantics.
      if (error && typeof error === "object" && /SERVER_CANONICAL_TRIP_ACK_(?:SCOPE|CAPTURE)_MISMATCH/.test(String((error as any).message))) {
        Object.assign(error, { code: "CANONICAL_TRIP_CONFLICT", details: { retryable: false, reasonCode: "ACK_EVIDENCE_CONFLICT", stage } });
      }
      try { if (error && typeof error === "object") Object.assign(error, {
        tripSyncStage: stage, tripRegistrationAccepted: registrationAccepted,
      }); } catch { /* diagnostic only */ }
      throw error;
    }
  }

  async delete(trip: CanonicalTrip): Promise<PushResult> {
    const tripId = readText(trip.physicalDocumentId || trip.canonicalTripId || trip.tripId || trip.clientRequestId || trip.idempotencyKey);
    const user = this.getCurrentUser();
    if (!tripId || !user?.uid) throw new Error("CANONICAL_TRIP_DELETE_IDENTITY_REQUIRED");
    const tripRef = doc(this.firestore, "historico_viagens", tripId);
    const slotRef = doc(this.firestore, "trip_operation_slots", tripId);
    await runTransaction(this.firestore, async (transaction) => {
      const existing = await transaction.get(tripRef);
      if (!existing.exists()) return;
      const current = existing.data() as Record<string, unknown>;
      const ownerId = readText(current.driverId || current.motoristaId || current.criadoPor);
      // Firestore rules are the final authorization boundary. Do not require
      // the actor to be the driver here: an authorized company manager/owner
      // may execute moderated deletion, while the transaction still validates
      // the trip/job/slot driver binding below.
      const jobId = readText(current.jobId);
      const jobRef = jobId ? doc(this.firestore, "trabalhos", jobId) : null;
      const slot = await transaction.get(slotRef);
      const job = jobRef ? await transaction.get(jobRef) : null;
      const alreadyDeleted = current.deleted === true && current.status === "DELETED" && Boolean(current.deletedAt);
      const slotExists = slot.exists();
      const activeSlot = slotExists && slot.data().deleted !== true;
      if (slotExists && slot.data().deleted === true && !alreadyDeleted) {
        throw new Error("CANONICAL_TRIP_OPERATION_SLOT_INCONSISTENT");
      }
      const jobData = job?.exists() ? job.data() as Record<string, unknown> : null;
      const operationBindingValid = Boolean(jobRef && jobData) &&
        readText(current.jobId) === jobId &&
        readText(jobData?.driverId || jobData?.motoristaId) === ownerId &&
        readText(current.companyId || current.empresaId) === readText(jobData?.companyId || jobData?.empresaId) &&
        readText(current.contractId || current.contratoId) === readText(jobData?.contractId || jobData?.contratoId);
      if (activeSlot && (!jobData || !jobRef)) {
        throw new Error("CANONICAL_TRIP_OPERATION_PROJECTION_MISSING");
      }
      if (jobRef && jobData && !operationBindingValid) {
        throw new Error("CANONICAL_TRIP_OPERATION_SCOPE_MISMATCH");
      }
      if (activeSlot && jobData && jobRef) {
        if (
          readText(slot.data().jobId) !== jobId ||
          readText(slot.data().driverId) !== ownerId ||
          readText(slot.data().tripId) !== tripId
        ) {
          throw new Error("CANONICAL_TRIP_OPERATION_SCOPE_MISMATCH");
        }
      }
      if (!alreadyDeleted) {
        transaction.update(tripRef, {
          deleted: true,
          status: "DELETED",
          deletedAt: serverTimestamp(),
          deletedBy: user.uid,
          updatedAt: serverTimestamp(),
          serverUpdatedAt: serverTimestamp(),
          clientUpdatedAt: readText((trip as any).clientUpdatedAt) || new Date().toISOString(),
          syncVersion: Math.max(1, Number((trip as any).syncVersion || current.syncVersion || 0)),
        });
      }
      if (activeSlot && job?.exists() && jobRef) {
        transaction.update(slotRef, { deleted: true, deletedAt: serverTimestamp() });
      }
    });

    // The tombstone is the client-owned mutation. Rebuilding the operation
    // projection/counter is server-owned and best effort: a temporary callable
    // failure must not turn a durable deletion into a failed operation.
    const jobId = readText((trip as any).jobId);
    if (jobId) {
      try {
        await this.reconcileOperation({ jobId });
      } catch {
        // The next canonical reconciliation will repair the projection.
      }
    }

    const confirmed = await getDocFromServer(tripRef);
    if (!confirmed.exists()) {
      // A trip deleted before its first successful sync has no server document
      // to tombstone; acknowledge only the durable local deletion record.
      return {
        confirmed: true,
        tripId,
        data: { deleted: true, status: "DELETED", deletedAt: (trip as any).deletedAt || new Date().toISOString() },
      };
    }
    const data: Record<string, any> = { ...confirmed.data(), id: confirmed.id, physicalDocumentId: confirmed.id };
    if (data.deleted !== true || data.status !== "DELETED" || !data.deletedAt) {
      throw new Error("SERVER_TRIP_DELETE_ACK_INVALID");
    }
    return { confirmed: true, tripId, data };
  }
}

export const firebaseTripSyncAdapter = new FirebaseTripSyncAdapter();
