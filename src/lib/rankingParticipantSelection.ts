import { selectCurrentOperationJob, operationAssignmentTimestamp, operationSelectionDriverId } from "./currentOperation";
import { resolveVehiclePhotoSimulatorId, resolveVehiclePhotoOperationSimulatorEvidence } from "./vehiclePhotoIdentity";

/**
 * Which operation (and so which vehicle) the Ranking shows for a participant. The same function serves the full job
 * history and the server's compact rows (rankingParticipantOperations), so both sources give the same answer.
 */
type Job = Record<string, any>;
export type SelectionContext = { simulatorId?: string; simulators?: Job[]; companies?: Job[] };

export const ownerOf = (job: Job) => operationSelectionDriverId(job) || String(job.userId || "").trim();
const companyOfJob = (job: Job) => String(job.companyId || job.empresaId || "").trim();
const vehicleOfJob = (job: Job) => String(job.vehicleId || job.veiculoId || "").trim();

export const requestedSimulator = (context: SelectionContext) =>
  context.simulatorId && context.simulatorId !== "all"
    ? resolveVehiclePhotoSimulatorId({ simulatorId: context.simulatorId }, context.simulators || [], context.companies || []) : "";

export function scopeJobs(jobs: Job[], participantId: string, companyId?: string): Job[] {
  return jobs.filter(job => ownerOf(job) === participantId && (!companyId || companyOfJob(job) === companyId));
}

const companyFor = (job: Job, context: SelectionContext) => new Map((context.companies || []).map(company => [String(company.id), company])).get(String(companyOfJob(job)));

/** Vehicles whose own document is needed because the job carries no simulator evidence of its own. */
export function vehiclesNeedingEvidence(scoped: Job[], context: SelectionContext): string[] {
  const ids = new Set<string>();
  if (context.simulatorId && context.simulatorId !== "all" && requestedSimulator(context)) {
    for (const job of scoped) {
      const evidence = resolveVehiclePhotoOperationSimulatorEvidence(job, companyFor(job, context), "", context.simulators || [], context.companies || []);
      const vehicleId = vehicleOfJob(job);
      if (!evidence.conflict && !evidence.simulatorId && vehicleId) ids.add(vehicleId);
    }
  }
  return [...ids];
}

export function selectParticipantOperation(scoped: Job[], participantId: string, companyId: string | undefined, context: SelectionContext,
  vehicleEvidence: Map<string, Job | null>): { operation: Job | null; unresolvedContext: boolean } {
  const simulators = context.simulators || [], companies = context.companies || [], wanted = requestedSimulator(context);
  let unresolvedContext = false;
  const allJobs: Job[] = scoped.filter(job => {
    if (!context.simulatorId || context.simulatorId === "all") return true;
    if (!wanted) return false;
    const vehicleId = vehicleOfJob(job);
    const resolved = resolveVehiclePhotoOperationSimulatorEvidence(job, companyFor(job, context), context.simulatorId, simulators, companies, [vehicleEvidence.get(vehicleId)]);
    // Incomplete simulator evidence is NOT proof that a previously cached vehicle disappeared.
    const raw = resolveVehiclePhotoOperationSimulatorEvidence(job, companyFor(job, context), "", simulators, companies, [vehicleEvidence.get(vehicleId)]);
    if (!raw.simulatorId && vehicleId) unresolvedContext = true;
    return resolved.simulatorId === wanted;
  }).map(job => ({ ...job, driverId: ownerOf(job) }));
  // Completed assignments are evidence that prevents an older active assignment from resurfacing.
  const active = selectCurrentOperationJob(allJobs, participantId, companyId || undefined) as Job | null;
  const lastUsed = allJobs.filter(job => {
    const status = String(job.status || "").trim().toLowerCase();
    const hasStartedEvidence = Boolean(job.startedAt || job.completedAt || job.started_at || job.completed_at);
    const isUsedState = ["active", "awaiting_completion", "delayed", "completed"].includes(status);
    return vehicleOfJob(job) && (isUsedState || hasStartedEvidence) && status !== "cancelled" && status !== "canceled" && status !== "invalid";
  }).sort((a, b) => operationAssignmentTimestamp(b) - operationAssignmentTimestamp(a) || String(b.id).localeCompare(String(a.id)))[0] || null;
  return { operation: active || lastUsed, unresolvedContext };
}

/** Same selection over the server's compact rows. Each row carries the vehicle facts the document read used to give. */
export function selectFromProjectionRows(rows: Job[], participantId: string, companyId: string | undefined, context: SelectionContext):
  { operation: Job | null; vehicle: Job | null; unresolvedContext: boolean } {
  const scoped = scopeJobs(rows, participantId, companyId);
  // Only vehicles the full-history path would have read are evidence, so both paths weigh the same facts.
  const evidence = new Map<string, Job | null>();
  for (const id of vehiclesNeedingEvidence(scoped, context)) {
    const row = scoped.find(job => vehicleOfJob(job) === id);
    evidence.set(id, row?.vehicle ? { ...row.vehicle } : null);
  }
  const { operation, unresolvedContext } = selectParticipantOperation(scoped, participantId, companyId, context, evidence);
  if (!operation) return { operation: null, vehicle: null, unresolvedContext };
  const { vehicle, ...job } = operation;
  return { operation: job, vehicle: vehicle ? { ...vehicle } : null, unresolvedContext };
}
