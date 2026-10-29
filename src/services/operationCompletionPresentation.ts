import type { OperationOutboxEntry } from "../application/operation/DurableOperationOutbox";
import type { Contract, Job } from "../context/AppContext";
import { buildOperationResultSummary, resolveOperationContract } from "../lib/operationResultSummary";
import { publishOperationCompletionResult } from "../lib/operationCompletionResult";

/** Replays presentation after a real finish ACK, including ACKs received on
 * resume. A queued request or a full local counter can never open this modal. */
export function presentConfirmedOperationResult(input: {
  uid: string; companyId: string; entries: OperationOutboxEntry[];
  contracts: Contract[]; trips: any[]; acknowledge: (entryId: string) => void;
}): boolean {
  const entry = input.entries.filter(row => row.actorId === input.uid && row.companyId === input.companyId &&
    row.kind === "finish" && row.state === "CONFIRMED" &&
    row.result?.completed === true && row.result?.job?.status === "completed")
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!entry || entry.resultPresented) return false;
  const job = entry.result!.job as Job & Record<string, any>;
  if (job.id !== entry.jobId || job.driverId !== input.uid || job.companyId !== input.companyId) return false;
  const data = buildOperationResultSummary({ job, contract: resolveOperationContract(job, input.contracts),
    trips: input.trips.filter(trip => (trip.driverId || trip.motoristaId) === input.uid &&
      (trip.companyId || trip.empresaId) === input.companyId && trip.jobId === job.id),
    vehicleName: job.vehicleName, trailerName: job.trailerName, showTrailer: Boolean(job.trailerId) });
  publishOperationCompletionResult({userId: input.uid, companyId: input.companyId, jobId: job.id, data});
  input.acknowledge(entry.id);
  return true;
}
