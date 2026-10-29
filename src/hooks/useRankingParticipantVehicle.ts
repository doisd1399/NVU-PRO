import { useEffect, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, query, startAfter, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { selectCurrentOperationJob, operationAssignmentTimestamp, operationSelectionDriverId } from "../lib/currentOperation";
import { resolveVehiclePhotoSimulatorId, resolveVehiclePhotoOperationSimulatorId, resolveVehiclePhotoOperationSimulatorEvidence } from "../lib/vehiclePhotoIdentity";
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

const ownerOf = (job: Record<string, any>) => operationSelectionDriverId(job) || String(job.userId || "").trim();
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

async function loadParticipantVehicle(participantId: string, companyId?: string, context: ParticipantVehicleContext = {}): Promise<CachedParticipantVehicle> {
  const normalizedParticipantId = String(participantId || "").trim();
  if (!normalizedParticipantId) return { expiresAt: Date.now() + CACHE_TTL_MS, operation: null, vehicle: null };
  const candidates = new Map<string, Record<string, any>>();
  const results = await Promise.allSettled(DRIVER_FIELDS.map((field) => readByDriverField(field, normalizedParticipantId)));
  const successful = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof readByDriverField>>> => result.status === "fulfilled");
  for (const result of successful) for (const job of result.value.rows) candidates.set(String(job.id), job);
  // Do not let a failed legacy-field query hide successful canonical results;
  // but do not misreport a total permissions/network failure as no operation.
  if (!successful.length) throw (results.find((result) => result.status === "rejected") as PromiseRejectedResult)?.reason || new Error("RANKING_OPERATION_QUERIES_FAILED");
  let authoritative = successful.length === DRIVER_FIELDS.length && successful.every((result) => !result.value.fromCache);
  const requestedSimulator = context.simulatorId && context.simulatorId !== "all"
    ? resolveVehiclePhotoSimulatorId({ simulatorId: context.simulatorId }, context.simulators || [], context.companies || [])
    : "";
  const scopedJobs = [...candidates.values()].filter((job) => ownerOf(job) === normalizedParticipantId
    && (!companyId || String(job.companyId || job.empresaId || "").trim() === companyId));
  const companies = context.companies || [];
  const simulators = context.simulators || [];
  const companyById = new Map(companies.map((company) => [String(company.id), company]));
  const companyForJob = (job: Record<string, any>) => companyById.get(String(job.companyId || job.empresaId || ""));
  const unresolvedVehicleIds = new Set<string>();
  if (context.simulatorId && context.simulatorId !== "all" && requestedSimulator) {
    // Historical operations may lack simulator fields but their linked vehicle
    // may contain explicit canonical evidence. Read each distinct vehicle once,
    // and only for jobs genuinely missing simulator evidence. Never infer it
    // from the ranking filter, company name, or vehicle model.
    for (const job of scopedJobs) {
      const evidence = resolveVehiclePhotoOperationSimulatorEvidence(job, companyForJob(job), "", simulators, companies);
      const vehicleId = String(job.vehicleId || job.veiculoId || "").trim();
      if (!evidence.conflict && !evidence.simulatorId && vehicleId) unresolvedVehicleIds.add(vehicleId);
    }
  }
  const vehicleEvidence = new Map<string, Record<string, any> | null>();
  const pendingVehicleIds = [...unresolvedVehicleIds];
  let nextVehicle = 0, vehicleReadIncomplete = false;
  await Promise.all(Array.from({ length: Math.min(4, pendingVehicleIds.length) }, async () => {
    while (nextVehicle < pendingVehicleIds.length) {
      const vehicleId = pendingVehicleIds[nextVehicle++];
      try {
        const snapshot = await getDoc(doc(db, "veiculos", vehicleId));
        vehicleEvidence.set(vehicleId, snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null);
      } catch {
        // An incomplete permission/network scan must not erase an offline
        // identity snapshot as though missing metadata were authoritative.
        vehicleReadIncomplete = true;
      }
    }
  }));
  if (vehicleReadIncomplete) authoritative = false;
  let unresolvedContext = false;
  const allJobs: Record<string, any>[] = scopedJobs.filter((job) => {
    if (!context.simulatorId || context.simulatorId === "all") return true;
    if (!requestedSimulator) return false;
    const vehicleId = String(job.vehicleId || job.veiculoId || "").trim();
    const resolved = resolveVehiclePhotoOperationSimulatorEvidence(
      job, companyForJob(job), context.simulatorId, simulators, companies, [vehicleEvidence.get(vehicleId)],
    );
    // Incomplete simulator evidence is NOT proof that a previously cached
    // vehicle disappeared. Keep the verified scoped offline snapshot until a
    // canonical result can replace it.
    const raw = resolveVehiclePhotoOperationSimulatorEvidence(
      job, companyForJob(job), "", simulators, companies, [vehicleEvidence.get(vehicleId)],
    );
    if (!raw.simulatorId && vehicleId) unresolvedContext = true;
    return resolved.simulatorId === requestedSimulator;
  }).map((job) => ({ ...job, driverId: ownerOf(job) }));
  if (unresolvedContext) authoritative = false;
  // Completed assignments are evidence that prevents an older active
  // assignment from resurfacing, so the canonical selector must see all jobs.
  const active = selectCurrentOperationJob(
    allJobs,
    normalizedParticipantId,
    companyId || undefined,
  ) as Record<string, any> | null;
  const lastUsed = allJobs
    .filter((job) => {
      const status = String(job.status || "").trim().toLowerCase();
      const vehicleId = String(job.vehicleId || job.veiculoId || "").trim();
      const hasStartedEvidence = Boolean(job.startedAt || job.completedAt || job.started_at || job.completed_at);
      const isUsedState = ["active", "awaiting_completion", "delayed", "completed"].includes(status);
      return vehicleId && (isUsedState || hasStartedEvidence)
        && status !== "cancelled" && status !== "canceled" && status !== "invalid";
    })
    .sort((a, b) => operationAssignmentTimestamp(b) - operationAssignmentTimestamp(a)
      || String(b.id).localeCompare(String(a.id)))[0] || null;
  const operation = active || lastUsed;
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
