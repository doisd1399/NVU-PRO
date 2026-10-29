import { useEffect, useMemo } from "react";
import { canonicalTripOperationService } from "../application/trip/CanonicalTripOperationService";
import { isAuthTeardownActive } from "../lib/authLifecycle";
import { normalizeJobStatus } from "../lib/jobStatus";

type IntegrityJob = { id: string; driverId: string; contractId: string; companyId?: string; status?: string; operationSyncState?: string };
type IntegrityContract = { id: string; totalDeliveries?: number };
type CheckIntegrity = (jobId: string, total: number) => Promise<unknown>;
const defaultCheck: CheckIntegrity = (jobId, total) => canonicalTripOperationService.ensureOperationIntegrity(jobId, total);

/** Initial/online audit follows operation identity, not object references or
 * the progress projection produced by its own response. Capture/submission
 * entry points keep their independent authoritative checks. */
export function useInitialOperationIntegrity({ uid, enabled, jobs, contracts, check = defaultCheck }: {
  uid: string; enabled: boolean; jobs: IntegrityJob[]; contracts: IntegrityContract[]; check?: CheckIntegrity;
}) {
  const signature = useMemo(() => {
    if (!enabled || !uid) return "[]";
    const totals = new Map(contracts.map(contract => [contract.id, Math.max(0, Number(contract.totalDeliveries || 0))]));
    return JSON.stringify(jobs.filter(job => job.driverId === uid && !["pending_start", "start_rejected"].includes(job.operationSyncState || "") &&
      !["completed", "cancelled", "canceled"].includes(normalizeJobStatus(job.status)))
      .map(job => [job.id, job.companyId || "", job.contractId, normalizeJobStatus(job.status), totals.get(job.contractId) || 0])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  }, [contracts, enabled, jobs, uid]);

  useEffect(() => {
    if (!enabled || !uid || isAuthTeardownActive()) return;
    const operations = JSON.parse(signature) as [string, string, string, string, number][];
    const reconcile = () => {
      if (isAuthTeardownActive()) return;
      for (const [jobId, , , , total] of operations) {
        void check(jobId, total).catch(error => {
          console.warn("[NVU] Reconciliação inicial da operação adiada até a conexão voltar:", error);
        });
      }
    };
    reconcile();
    window.addEventListener("online", reconcile);
    return () => window.removeEventListener("online", reconcile);
  }, [check, enabled, signature, uid]);
}
