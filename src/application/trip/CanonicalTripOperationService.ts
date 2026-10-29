import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../../lib/firebase";
import { normalizeTrip } from "../../lib/tripNormalizer";
import type { CanonicalTrip } from "../../domain/trip/CanonicalTrip";
import { assertOperationalIdentity, resolveOperationalIdentity } from "../../domain/operation/OperationalIdentity";
import { buildOperationProjection } from "../operation/OperationProjectionEngine";
import { isCanonicalConfirmedTrip } from "../../../functions/src/isCanonicalConfirmedTrip";

type Dependencies = { firestore?: Firestore; getCurrentUser?: () => { uid: string } | null };
const clean = (value: unknown) => String(value ?? "").trim();

/** Estado operacional autoritativo: somente documentos confirmados no servidor. */
export class CanonicalTripOperationService {
  private readonly firestore: Firestore;
  private readonly getCurrentUser: () => { uid: string } | null;
  private readonly integrityInFlight = new Map<string, Promise<Awaited<ReturnType<CanonicalTripOperationService["readAuthoritativeOperationState"]>>>>();

  constructor(dependencies: Dependencies = {}) {
    this.firestore = dependencies.firestore || db;
    this.getCurrentUser = dependencies.getCurrentUser || (() => auth.currentUser);
  }

  async readAuthoritativeOperationState(operationId: string, totalDeliveries = 0, allowRepair = true) {
    const jobId = String(operationId || "").trim();
    const uid = this.getCurrentUser()?.uid || "";
    if (!jobId || !uid) throw new Error("CANONICAL_OPERATION_AUTH_REQUIRED");

    const jobRef = doc(this.firestore, "trabalhos", jobId);
    const tripsCollection = collection(this.firestore, "historico_viagens");
    const canonicalQuery = query(tripsCollection, where("jobId", "==", jobId), where("driverId", "==", uid));
    const [jobSnapshot, canonicalSnapshot] = await Promise.all([
      getDocFromServer(jobRef), getDocsFromServer(canonicalQuery),
    ]);
    if (this.getCurrentUser()?.uid !== uid) throw new Error("CANONICAL_OPERATION_AUTH_CHANGED");
    if (!jobSnapshot.exists()) throw new Error("OPERATION_NOT_FOUND");

    const job = jobSnapshot.data() as Record<string, unknown>;
    const companyId = clean(job.companyId || job.empresaId);
    const contractId = clean(job.contractId || job.contratoId);
    // Jobs created by the v4 canonical writer have always written these two
    // fields. Legacy/recovered jobs retain all alias queries and their audit.
    const canonicalOnly = job.operationProjectionSource === "new-operation-v4" && Number(job.operationReconciliationVersion) >= 4;
    const tripSnapshots = [canonicalSnapshot, ...await Promise.all([
      ...(canonicalOnly ? [] : ["driverId", "motoristaId", "userId", "criadoPor"]).flatMap((driverField) =>
        ["jobId", "operationId", "trabalhoId"].filter(operationField =>
          operationField !== "jobId" || driverField !== "driverId")
          .map(operationField => getDocsFromServer(query(tripsCollection,
            where(operationField, "==", jobId), where(driverField, "==", uid))))),
    ])];
    if (this.getCurrentUser()?.uid !== uid) throw new Error("CANONICAL_OPERATION_AUTH_CHANGED");
    const tripsById = new Map<string, Record<string, any>>();
    tripSnapshots.forEach((snapshot) => snapshot.docs.forEach((document) => {
      tripsById.set(document.id, { id: document.id, ...document.data() });
    }));
    const identity = assertOperationalIdentity(resolveOperationalIdentity({
      uid, driverId: uid, companyId, contractId, operationId: jobId,
    }));
    const trips = Array.from(tripsById.values()).filter((trip) =>
      isCanonicalConfirmedTrip(trip, identity) && normalizeTrip(trip as any).isValid
    );
    const projection = buildOperationProjection({
      identity,
      operation: { ...job, totalDeliveries: job.totalDeliveries },
      confirmedHistory: trips as CanonicalTrip[],
      projectionHints: { progress: job.progress },
    });
    const serverProgress = Math.max(0, Number(job.progress || 0));
    const validatedTripCount = projection.confirmedTripCount;
    // O progresso exibido anteriormente podia divergir do contador validado,
    // causando bloqueio incorreto de novos lançamentos. A autoridade agora é
    // sempre o conjunto de viagens confirmadas no servidor. O valor divergente
    // é preservado apenas para diagnóstico/reconciliação.
    const progressMismatch = serverProgress !== validatedTripCount;

    // A new capture must not be blocked forever by a stale denormalized job
    // counter. Ask the authenticated server reconciler to repair only a
    // provable orphan, then read the job again before returning preflight.
    const total = Math.max(0, Number(totalDeliveries || job.totalDeliveries || 0));
    const needsCanonicalAudit = Number((job as any).operationReconciliationVersion || 0) < 4;
    const normalizedLifecycle = String(job.status || "").toLowerCase();
    const needsLifecycleSettlement = total > 0 && validatedTripCount >= total
      && !["awaiting_completion", "completed"].includes(normalizedLifecycle);
    let reconciliationConflict = "";
    if ((progressMismatch || needsCanonicalAudit || needsLifecycleSettlement) && allowRepair) {
      try {
        const reconcile = httpsCallable<{ jobId: string }, { status?: string; reason?: string }>(
          functions,
          "reconcileOperationTrips",
        );
        const response = await reconcile({ jobId });
        if (this.getCurrentUser()?.uid !== uid) throw new Error("CANONICAL_OPERATION_AUTH_CHANGED");
        if (response.data?.status === "repaired" || needsLifecycleSettlement) {
          return this.readAuthoritativeOperationState(jobId, totalDeliveries, false);
        }
        if (response.data?.status === "conflict") {
          reconciliationConflict = String(response.data?.reason || "OPERATION_RECONCILIATION_CONFLICT");
        }
      } catch {
        // Keep the confirmed server projection available. Submission paths are
        // still protected by the server writer and will not manufacture trips.
      }
    }

    const state = {
      operationId: jobId,
      trips: projection.confirmedTrips,
      currentCount: validatedTripCount,
      progress: validatedTripCount,
      totalDeliveries: total,
      status: String(job.status || "active"),
      // A stale projection must never block capture or queue processing. The
      // rebuilder is best-effort and the confirmed history already gives us a
      // safe operational state even when repair is temporarily unavailable.
      reconciliationRequired: Boolean(reconciliationConflict),
      reconciliationReason: reconciliationConflict,
      repairPending: progressMismatch || needsCanonicalAudit,
      serverReportedProgress: serverProgress,
      confirmedTrips: projection.confirmedTrips,
      confirmedTripIds: projection.confirmedTripIds,
      confirmedTripCount: projection.confirmedTripCount,
      remainingTrips: projection.remainingTrips,
      nextSlot: projection.nextSlot,
      nextAllowedAction: projection.nextAllowedAction,
      projectionStale: projection.projectionStale,
    };
    if (this.getCurrentUser()?.uid !== uid) throw new Error("CANONICAL_OPERATION_AUTH_CHANGED");
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("nvu-operation-integrity-checked", {
        detail: {
          jobId,
          userId: uid,
          progress: state.progress,
          serverProgress,
          confirmedCount: validatedTripCount,
          status: state.status,
          repaired: progressMismatch && !projection.projectionStale,
          source: "canonical-server-trips",
        },
      }));
    }
    return state;
  }

  /** Operation Integrity Guard: every entry/resume/capture path converges here. */
  async ensureOperationIntegrity(operationId: string, totalDeliveries = 0) {
    const jobId = String(operationId || "").trim();
    if (!jobId) throw new Error("CANONICAL_OPERATION_REQUIRED");
    const key = `${this.getCurrentUser()?.uid || ""}:${jobId}`;
    const existing = this.integrityInFlight.get(key);
    if (existing) return existing;
    const run = this.readAuthoritativeOperationState(jobId, totalDeliveries)
      .finally(() => this.integrityInFlight.delete(key));
    this.integrityInFlight.set(key, run);
    return run;
  }

  async syncJobProgress(jobId: string) {
    const state = await this.readAuthoritativeOperationState(jobId);
    const total = state.totalDeliveries;
    return total > 0 ? Math.min(state.progress, total) : state.progress;
  }

  async finalizeOperation(jobId: string) {
    const operationId = String(jobId || "").trim();
    if (!operationId) throw new Error("CANONICAL_OPERATION_REQUIRED");
    const finalize = httpsCallable<{ jobId: string }, {
      completed: boolean;
      alreadyCompleted?: boolean;
      operationalRevision?: number;
      jobId: string;
      status: string;
      progress: number;
      total: number;
    }>(functions, "completeCanonicalOperation");
    const response = await finalize({ jobId: operationId });
    return response.data;
  }
}

export const canonicalTripOperationService = new CanonicalTripOperationService();
