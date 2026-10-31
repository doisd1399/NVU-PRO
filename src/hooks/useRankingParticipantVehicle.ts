import { useEffect, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, query, startAfter, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../lib/firebase";
import { selectCurrentOperationJob, operationAssignmentTimestamp } from "../lib/currentOperation";
import { resolveVehiclePhotoOperationSimulatorId } from "../lib/vehiclePhotoIdentity";
import { readProjectionRows as readProjection } from "../services/rankingProjectionReader";
import { ownerOf, scopeJobs, selectFromProjectionRows, selectParticipantOperation, vehiclesNeedingEvidence } from "../lib/rankingParticipantSelection";
import { clearVehiclePhotoIdentitySnapshot, readVehiclePhotoIdentitySnapshot, writeVehiclePhotoIdentitySnapshot, type VehiclePhotoSnapshotScope } from "../services/vehiclePhotoIdentitySnapshot";

export type ParticipantVehicleContext = VehiclePhotoSnapshotScope & {
  simulators?: Record<string, any>[]; companies?: Record<string, any>[];
};

export type RankingParticipantVehicle = {
  scopeKey: string;
  operation: Record<string, any> | null;
  vehicle: Record<string, any> | null;
  status: "idle" | "loading" | "ready" | "unavailable" | "permission-denied";
  error?: string;
  authoritative?: boolean;
};

type CachedParticipantVehicle = {
  expiresAt: number;
  operation: Record<string, any> | null;
  vehicle: Record<string, any> | null;
  authoritative?: boolean;
};

const CACHE_TTL_MS = 15_000;
const OPERATIONS_PAGE_SIZE = 100;
const cache = new Map<string, CachedParticipantVehicle>();
const inflight = new Map<string, Promise<CachedParticipantVehicle>>();

const DRIVER_FIELDS = ["driverId", "motoristaId", "assignedDriverId", "userId", "driver_id", "motorista_id"];

async function readByDriverField(field: string, participantId: string): Promise<{ rows: Record<string, any>[]; fromCache: boolean }> {
  // Firestore's first page is not sufficient: the latest valid vehicle may
  // be beyond many newer/invalid assignments. Cursor through every page and
  // sort locally by the real assignment timestamp below.
  const rows: Record<string, any>[] = [];
  let cursor: any = null;
  let fromCache = false;
  while (true) {
    const constraints = [where(field, "==", participantId), limit(OPERATIONS_PAGE_SIZE)];
    const snapshot = await getDocs(cursor
      ? query(collection(db, "trabalhos"), ...constraints, startAfter(cursor))
      : query(collection(db, "trabalhos"), ...constraints));
    rows.push(...snapshot.docs.map((item) => ({ ...item.data(), id: item.id })));
    fromCache ||= snapshot.metadata?.fromCache === true;
    if (snapshot.docs.length < OPERATIONS_PAGE_SIZE) break;
    const nextCursor = snapshot.docs[snapshot.docs.length - 1];
    if (!nextCursor || nextCursor.id === cursor?.id) break;
    cursor = nextCursor;
  }
  return { rows, fromCache };
}

/**
 * The server keeps a compact row set per participant (rankingParticipantOperations). It is read first: one document
 * instead of the participant's whole job history and vehicle documents. A missing document is created once by the server.
 * Anything unavailable (older server, offline without cache) returns null and the caller uses the full-history path.
 */
async function readProjectionRows(participantId: string) {
  return readProjection(participantId, {
    readDocument: async (id) => {
      const snapshot = await getDoc(doc(db, "rankingParticipantOperations", id));
      return { exists: snapshot.exists(), data: snapshot.exists() ? snapshot.data() : null, fromCache: snapshot.metadata?.fromCache === true };
    },
    ensure: async (id) => (await httpsCallable<{ participantId: string }, any>(functions, "ensureRankingParticipantOperations", { timeout: 20_000 })({ participantId: id })).data,
  });
}

async function loadParticipantVehicle(participantId: string, companyId?: string, context: ParticipantVehicleContext = {}): Promise<CachedParticipantVehicle> {
  const normalizedParticipantId = String(participantId || "").trim();
  if (!normalizedParticipantId) return { expiresAt: Date.now() + CACHE_TTL_MS, operation: null, vehicle: null };
  const projected = await readProjectionRows(normalizedParticipantId);
  if (projected) {
    const picked = selectFromProjectionRows(projected.rows, normalizedParticipantId, companyId || undefined, context);
    return { expiresAt: Date.now() + CACHE_TTL_MS, operation: picked.operation, vehicle: picked.vehicle, authoritative: !projected.fromCache && !picked.unresolvedContext };
  }
  const candidates = new Map<string, Record<string, any>>();
  const results = await Promise.allSettled(DRIVER_FIELDS.map((field) => readByDriverField(field, normalizedParticipantId)));
  const successful = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof readByDriverField>>> => result.status === "fulfilled");
  for (const result of successful) for (const job of result.value.rows) candidates.set(String(job.id), job);
  // Do not let a failed legacy-field query hide successful canonical results;
  // but do not misreport a total permissions/network failure as no operation.
  if (!successful.length) throw (results.find((result) => result.status === "rejected") as PromiseRejectedResult)?.reason || new Error("RANKING_OPERATION_QUERIES_FAILED");
  let authoritative = successful.length === DRIVER_FIELDS.length && successful.every((result) => !result.value.fromCache);
  const scopedJobs = scopeJobs([...candidates.values()], normalizedParticipantId, companyId || undefined);
  // Historical operations may lack simulator fields but their linked vehicle may contain explicit canonical evidence.
  // Read each distinct vehicle once, and only for jobs genuinely missing simulator evidence.
  const vehicleEvidence = new Map<string, Record<string, any> | null>();
  const pendingVehicleIds = vehiclesNeedingEvidence(scopedJobs, context);
  let nextVehicle = 0, vehicleReadIncomplete = false;
  await Promise.all(Array.from({ length: Math.min(4, pendingVehicleIds.length) }, async () => {
    while (nextVehicle < pendingVehicleIds.length) {
      const vehicleId = pendingVehicleIds[nextVehicle++];
      try {
        const snapshot = await getDoc(doc(db, "veiculos", vehicleId));
        vehicleEvidence.set(vehicleId, snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null);
      } catch {
        // An incomplete permission/network scan must not erase an offline identity snapshot.
        vehicleReadIncomplete = true;
      }
    }
  }));
  if (vehicleReadIncomplete) authoritative = false;
  const { operation, unresolvedContext } = selectParticipantOperation(scopedJobs, normalizedParticipantId, companyId || undefined, context, vehicleEvidence);
  if (unresolvedContext) authoritative = false;
  let vehicle: Record<string, any> | null = null;
  const vehicleId = String(operation?.vehicleId || operation?.veiculoId || "").trim();
  if (vehicleId) {
    const snapshot = await getDoc(doc(db, "veiculos", vehicleId));
    if (snapshot.exists()) vehicle = { ...snapshot.data(), id: snapshot.id };
  }
  return { expiresAt: Date.now() + CACHE_TTL_MS, operation, vehicle, authoritative };
}

function loadCached(key: string): CachedParticipantVehicle | null {
  const value = cache.get(key);
  if (!value || value.expiresAt <= Date.now()) {
    if (value) cache.delete(key);
    return null;
  }
  return value;
}

function scopeKey(participantId: string, companyId: string, context: VehiclePhotoSnapshotScope) {
  return `${participantId}:${companyId || "all"}:${context.simulatorId || "all"}:${context.viewerId || "session"}`;
}

export async function readRankingParticipantVehicle(participantId: string, companyId: string, context: ParticipantVehicleContext = {}): Promise<CachedParticipantVehicle> {
  const key = scopeKey(participantId, companyId, context);
  const cached = loadCached(key);
  if (cached) return cached;
  const existing = inflight.get(key);
  if (existing) return existing;
  const request = loadParticipantVehicle(participantId, companyId, context);
  inflight.set(key, request);
  try {
    const result = await request;
    if (inflight.get(key) === request) {
      if (cache.size >= 256) cache.delete(cache.keys().next().value!);
      cache.set(key, result);
    }
    return result;
  } finally { if (inflight.get(key) === request) inflight.delete(key); }
}

export function invalidateRankingParticipantVehicle(participantId?: string) {
  if (!participantId) { cache.clear(); inflight.clear(); return; }
  for (const key of cache.keys()) if (key.startsWith(`${participantId}:`)) cache.delete(key);
  for (const key of inflight.keys()) if (key.startsWith(`${participantId}:`)) inflight.delete(key);
}

export function useRankingParticipantVehicle(
  participantId: string,
  companyId: string,
  fallbackOperation?: Record<string, any> | null,
  fallbackVehicle?: Record<string, any> | null,
  context: ParticipantVehicleContext = {},
): RankingParticipantVehicle {
  const key = scopeKey(participantId, companyId, context);
  const contextRef = useRef(context);
  contextRef.current = context;
  const cached = loadCached(key);
  const snapshot = readVehiclePhotoIdentitySnapshot(participantId, companyId, context);
  const snapshotOperation = snapshot ? {
    id: snapshot.operationId || `offline:${snapshot.vehicleId}`,
    driverId: snapshot.userId,
    companyId: snapshot.operationCompanyId || (snapshot.companyId === "all" ? "" : snapshot.companyId),
    companyName: snapshot.companyName,
    companyLogo: snapshot.companyLogo,
    simulatorId: snapshot.simulatorId,
    vehicleId: snapshot.vehicleId,
    vehicleName: snapshot.vehicleName,
    status: "completed",
    assignedAt: snapshot.evidenceAt || snapshot.savedAt,
  } : null;
  const [state, setState] = useState<RankingParticipantVehicle>(() => ({
    scopeKey: key,
    operation: cached?.operation || snapshotOperation || fallbackOperation || null,
    vehicle: cached?.vehicle || (snapshot ? { ...(fallbackVehicle || {}), id: snapshot.vehicleId, name: snapshot.vehicleName } : fallbackVehicle || null),
    status: cached ? (cached.operation ? "ready" : "unavailable") : (fallbackOperation ? "loading" : "idle"),
    authoritative: cached?.authoritative,
  }));

  useEffect(() => {
    let cancelled = false;
    const immediate = loadCached(key);
    const scope = contextRef.current;
    const localSnapshot = readVehiclePhotoIdentitySnapshot(participantId, companyId, scope);
    const snapshotJob = localSnapshot ? {
      id: localSnapshot.operationId || `offline:${localSnapshot.vehicleId}`,
      driverId: localSnapshot.userId,
      companyId: localSnapshot.operationCompanyId || (localSnapshot.companyId === "all" ? "" : localSnapshot.companyId),
      companyName: localSnapshot.companyName,
      companyLogo: localSnapshot.companyLogo,
      simulatorId: localSnapshot.simulatorId,
      vehicleId: localSnapshot.vehicleId,
      vehicleName: localSnapshot.vehicleName,
      status: "completed",
      assignedAt: localSnapshot.evidenceAt || localSnapshot.savedAt,
    } : null;
    setState({
      scopeKey: key,
      operation: immediate?.operation || snapshotJob || fallbackOperation || null,
      vehicle: immediate?.vehicle || (localSnapshot ? { ...(fallbackVehicle || {}), id: localSnapshot.vehicleId, name: localSnapshot.vehicleName } : fallbackVehicle || null),
      status: immediate ? (immediate.operation ? "ready" : "unavailable") : (fallbackOperation ? "loading" : "idle"),
      authoritative: immediate?.authoritative,
    });
    if (!participantId) return () => { cancelled = true; };
    // A valid cache entry serves the mount without a history scan.
    if (immediate) return () => { cancelled = true; };
    const request = readRankingParticipantVehicle(participantId, companyId, scope);
    setState((current) => ({ ...current, status: "loading" }));
    void request.then((result) => {
      if (cancelled) return;
      const operation: Record<string, any> | null = result.operation || (!result.authoritative ? snapshotJob || fallbackOperation || null : null);
      if (operation) {
        const currentContext = contextRef.current;
        const companies = currentContext.companies || [];
        const simulators = currentContext.simulators || [];
        const company = companies.find((candidate) => String(candidate.id) === String(operation.companyId || operation.empresaId || companyId));
        const simulatorId = resolveVehiclePhotoOperationSimulatorId(
          operation, company, currentContext.simulatorId || "", simulators, companies, [result.vehicle],
        );
        if (simulatorId) writeVehiclePhotoIdentitySnapshot({
          userId: participantId,
          companyId: companyId || "all",
          operationCompanyId: String(operation.companyId || operation.empresaId || ""),
          companyName: String(company?.name || company?.companyName || operation.companyName || ""),
          companyLogo: String(company?.logoUrl || company?.logoURL || company?.companyLogoURL || operation.companyLogo || ""),
          simulatorId,
          vehicleId: String(operation.vehicleId || operation.veiculoId || result.vehicle?.id || "").trim(),
          vehicleName: String(operation.vehicleName || result.vehicle?.name || "Veículo atual"),
          operationId: String(operation.id || operation.operationId || ""),
          evidenceAt: operationAssignmentTimestamp(operation),
          source: selectCurrentOperationJob([operation], participantId, companyId || undefined) ? "operation" : "last-used",
        }, currentContext);
      } else if (result.authoritative) {
        clearVehiclePhotoIdentitySnapshot(participantId, companyId, scope);
      }
      setState({ scopeKey: key, operation, vehicle: result.vehicle || (operation ? fallbackVehicle || (localSnapshot ? { id: localSnapshot.vehicleId, name: localSnapshot.vehicleName } : null) : null), status: operation ? "ready" : "unavailable", authoritative: result.authoritative });
    }).catch((error: unknown) => {
      if (cancelled) return;
      const permission = String((error as any)?.code || "").includes("permission-denied");
      setState((current) => ({ ...current, scopeKey: key, status: permission ? "permission-denied" : (current.operation ? "ready" : "unavailable"), error: permission ? "permission-denied" : "operation-read-failed" }));
    });
    return () => { cancelled = true; };
  }, [companyId, fallbackOperation, fallbackVehicle, key, participantId]);

  return state.scopeKey === key ? state : { scopeKey: key, operation: null, vehicle: null, status: "loading" };
}

export const __rankingParticipantVehicleTestOnly = { loadParticipantVehicle, cache };
