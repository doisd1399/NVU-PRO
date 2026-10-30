export type OperationalCommandInput = {
  action: "assign" | "start" | "startAutomatic" | "cancel" | "archive" | "changeVehicle";
  companyId: string;
  jobId?: string;
  contractId?: string;
  driverId?: string;
  vehicleId?: string;
  trailerId?: string | null;
  deadlineDays?: number;
  queueId?: string;
  configRevision?: number;
  previewToken?: string;
};
export type OperationalCommandResult = {
  success: true; version: 1; action: OperationalCommandInput["action"];
  requestId: string; jobId: string; job: Record<string, any>; currentJob?: Record<string, any>; replayed?: boolean;
};
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Dependencies = {
  getUid: () => string | null | undefined;
  getStorage: () => StoragePort;
  randomId: () => string;
  transport: (input: OperationalCommandInput & { requestId: string }) => Promise<OperationalCommandResult>;
};
function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  return value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, stable(value[k])])) : value;
}

/** Durable request identity; a lost response or reload cannot allocate a retry. */
export class OperationalCommandClient {
  private readonly inFlight = new Map<string, Promise<OperationalCommandResult>>();
  constructor(private readonly dependencies: Dependencies) {}

  /** Reserve the existing durable identity before constructing an offline job.
   * The same command journal may predate this outbox (lost reply or upgrade). */
  reserveRequestId(input: OperationalCommandInput, explicitRequestId?: string): string {
    const uid = this.dependencies.getUid();
    if (!uid) throw new Error("Faça login para confirmar a operação.");
    const args = JSON.stringify(stable(input));
    const key = `nvu.operational.command.v1.${encodeURIComponent(uid)}.${encodeURIComponent(input.companyId)}.${encodeURIComponent(args)}`;
    const storage = this.dependencies.getStorage();
    const raw = storage.getItem(key), pending = raw ? JSON.parse(raw) : null;
    if (pending && (pending.uid !== uid || pending.args !== args || typeof pending.requestId !== "string" || !pending.requestId)) throw new Error("INVALID_COMMAND_JOURNAL");
    const requestId = pending?.requestId || explicitRequestId || this.dependencies.randomId();
    storage.setItem(key, JSON.stringify({ uid, args, requestId }));
    return requestId;
  }

  execute(input: OperationalCommandInput, explicitRequestId?: string): Promise<OperationalCommandResult> {
    const uid = this.dependencies.getUid();
    if (!uid) return Promise.reject(new Error("Faça login para confirmar a operação."));
    const args = JSON.stringify(stable(input));
    const key = `nvu.operational.command.v1.${encodeURIComponent(uid)}.${encodeURIComponent(input.companyId)}.${encodeURIComponent(args)}`;
    const current = this.inFlight.get(key);
    if (current) return current;
    const run = this.send(input, uid, key, args, explicitRequestId);
    this.inFlight.set(key, run);
    const cleanup = () => this.inFlight.delete(key);
    void run.then(cleanup, cleanup);
    return run;
  }

  private async send(input: OperationalCommandInput, uid: string, key: string, args: string, explicitRequestId?: string): Promise<OperationalCommandResult> {
    let storage: StoragePort, requestId: string;
    try {
      storage = this.dependencies.getStorage();
      const raw = storage.getItem(key);
      const pending = raw ? JSON.parse(raw) : null;
      if (pending && (pending.uid !== uid || pending.args !== args || typeof pending.requestId !== "string" || !pending.requestId)) throw new Error("INVALID_COMMAND_JOURNAL");
      requestId = pending?.requestId || explicitRequestId || this.dependencies.randomId();
      storage.setItem(key, JSON.stringify({ uid, args, requestId }));
    } catch {
      throw new Error("Não foi possível preservar a confirmação neste aparelho. Tente novamente antes de iniciar o trabalho.");
    }
    const result = await this.dependencies.transport({ ...input, requestId });
    if (this.dependencies.getUid() !== uid) throw new Error("OPERATIONAL_COMMAND_SESSION_CHANGED");
    const status = result?.job?.status;
    const validStatus = input.action === "assign" ? status === "pending" : (input.action === "start" || input.action === "startAutomatic")
      ? ["active", "delayed", "awaiting_completion"].includes(status)
      : input.action === "cancel" ? status === "cancelled" : input.action === "changeVehicle" ? ["pending", "active", "delayed", "awaiting_completion"].includes(status) && result.job?.vehicleId === input.vehicleId : ["completed", "cancelled"].includes(status) && result?.job?.archived === true;
    if (!result?.success || result.version !== 1 || result.action !== input.action || result.requestId !== requestId ||
        !result.jobId || result.job?.id !== result.jobId || result.job?.companyId !== input.companyId ||
        (input.jobId && result.jobId !== input.jobId) ||
        (input.action === "assign" && (result.job.driverId !== input.driverId || result.job.contractId !== input.contractId || result.job.vehicleId !== input.vehicleId)) ||
        (input.action === "startAutomatic" && (result.job.contractId !== input.contractId || result.job.vehicleId !== input.vehicleId || result.job.queueId !== input.queueId || result.job.queueRevision !== input.configRevision)) ||
        ((input.action === "start" || input.action === "startAutomatic") && result.job.driverId !== uid) || !validStatus ||
        (result.currentJob && (result.currentJob.id !== result.jobId || result.currentJob.companyId !== input.companyId ||
          result.currentJob.driverId !== result.job.driverId || result.currentJob.contractId !== result.job.contractId ||
          Number(result.currentJob.operationalRevision || 0) < Number(result.job.operationalRevision || 0)))) throw new Error("O servidor ainda não confirmou esta operação. Tente novamente para recuperar o resultado.");
    // A storage cleanup failure cannot turn an acknowledged operation into a
    // failed command. Keeping its identity is safer than allocating a retry.
    try { storage.removeItem(key); } catch { /* recover the same result later */ }
    return result;
  }
}
