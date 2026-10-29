import type { OperationalCommandInput } from "./OperationalCommandClient";

export type LocalOperationJob = Record<string, any> & { id: string; companyId: string; driverId: string; contractId: string; status: string };
export type OperationCommandState = "PENDING" | "SENDING" | "CONFIRMED" | "REJECTED";
export type OperationOutboxEntry = {
  version: 1; id: string; actorId: string; companyId: string; jobId: string;
  kind: "start" | "finish"; transport: "managed" | "legacy";
  requestId: string; input?: OperationalCommandInput; job: LocalOperationJob;
  state: OperationCommandState; createdAt: number; attempts: number;
  retryAt: number; sendingAt?: number; error?: string; result?: Record<string, any>; observed?: boolean;
  nativeCleanupDone?: boolean;
  resultPresented?: boolean;
};
type StoragePort = Pick<Storage, "getItem" | "setItem">;
type Ports = {
  uid: () => string; online: () => boolean; storage: () => StoragePort;
  sendStart: (entry: OperationOutboxEntry) => Promise<LocalOperationJob>;
  sendFinish: (entry: OperationOutboxEntry) => Promise<Record<string, any>>;
  canFinish: (entry: OperationOutboxEntry) => Promise<boolean>;
  notify?: (uid: string) => void; now?: () => number;
  syncTimeoutMs?: number;
};
const prefix = "nvu.operation.outbox.v1.";
async function bounded<T>(task: Promise<T>, ms = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([task, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("OPERATION_SYNC_TIMEOUT"), { code: "deadline-exceeded" })), ms);
  })]); } finally { clearTimeout(timer!); }
}
const terminal = (job: LocalOperationJob) => ["completed", "cancelled"].includes(job.status);
const retryable = (error: any) => {
  const code = String(error?.code || error?.message || "").toLowerCase();
  return /unavailable|deadline-exceeded|network|timeout|internal|unauthenticated|session_changed|auth_changed/.test(code);
};

/** A local receipt is durable before UI success; it is never a server ACK.
 * Starts precede trip upload; explicit finishes follow the acknowledged ledger.
 * Every retry keeps the original request and physical operation identity. */
export class DurableOperationOutbox {
  private readonly flights = new Map<string, Promise<void>>();
  constructor(private readonly ports: Ports) {}
  private now() { return this.ports.now?.() ?? Date.now(); }

  entries(uid = this.ports.uid()): OperationOutboxEntry[] {
    if (!uid) return [];
    const raw = this.ports.storage().getItem(prefix + uid);
    if (!raw) return [];
    const value = JSON.parse(raw);
    if (value.version !== 1 || value.actorId !== uid || !Array.isArray(value.entries)) throw new Error("OPERATION_OUTBOX_INVALID");
    const ids = new Set<string>();
    for (const entry of value.entries as OperationOutboxEntry[]) {
      if (entry.version !== 1 || entry.actorId !== uid || !entry.id || ids.has(entry.id) ||
          !entry.requestId || !entry.companyId || !entry.jobId || entry.job?.id !== entry.jobId ||
          entry.job?.companyId !== entry.companyId || entry.job?.driverId !== uid ||
          !["start", "finish"].includes(entry.kind) || !["managed", "legacy"].includes(entry.transport) ||
          !["PENDING", "SENDING", "CONFIRMED", "REJECTED"].includes(entry.state)) throw new Error("OPERATION_OUTBOX_INVALID");
      ids.add(entry.id);
    }
    return value.entries;
  }
  private write(uid: string, entries: OperationOutboxEntry[]) {
    const storage = this.ports.storage();
    const raw = JSON.stringify({ version: 1, actorId: uid, entries });
    storage.setItem(prefix + uid, raw);
    if (storage.getItem(prefix + uid) !== raw) throw new Error("OPERATION_OUTBOX_NOT_DURABLE");
    this.ports.notify?.(uid);
  }
  private patch(uid: string, id: string, patch: Partial<OperationOutboxEntry>) {
    this.write(uid, this.entries(uid).map(entry => entry.id === id ? { ...entry, ...patch } : entry));
  }
  enqueueStart(input: {
    requestId: string; transport: "managed" | "legacy";
    command: OperationalCommandInput; job: LocalOperationJob;
  }): OperationOutboxEntry {
    const uid = this.ports.uid(), { job, command } = input;
    if (!uid || job.driverId !== uid || !job.id || !job.contractId || !job.companyId ||
        command.companyId !== job.companyId || !["start", "startAutomatic"].includes(command.action) ||
        (command.action === "start" && command.jobId !== job.id) ||
        (command.action === "startAutomatic" && (command.contractId !== job.contractId || command.vehicleId !== job.vehicleId)) ||
        !Number.isSafeInteger(job.totalDeliveries) || job.totalDeliveries < 1 || terminal(job)) throw new Error("Operação indisponível neste aparelho. Atualize a fila quando houver conexão.");
    const rows = this.entries(uid), id = `start:${job.id}`;
    const existing = rows.find(entry => entry.id === id);
    if (existing) {
      if (existing.state === "REJECTED") throw new Error(existing.error || "Este início precisa de conferência. As viagens locais foram preservadas.");
      return existing;
    }
    if (rows.some(entry => entry.kind === "start" && entry.companyId === job.companyId && entry.state !== "CONFIRMED"))
      throw new Error("Há um início salvo aguardando sincronização. Continue essa operação antes de iniciar outra.");
    const entry: OperationOutboxEntry = {
      version: 1, id, actorId: uid, companyId: job.companyId, jobId: job.id, kind: "start",
      transport: input.transport, requestId: input.requestId, input: command,
      job: { ...job, status: "active" }, state: "PENDING", createdAt: this.now(), attempts: 0, retryAt: 0,
    };
    this.write(uid, [...rows, entry]);
    return entry;
  }
  enqueueFinish(job: LocalOperationJob, requestId: string): OperationOutboxEntry {
    const uid = this.ports.uid();
    if (!uid || job.driverId !== uid || !job.companyId || !job.id || !job.contractId || terminal(job)) throw new Error("Operação inválida para finalizar.");
    const rows = this.entries(uid), id = `finish:${job.id}`;
    const existing = rows.find(entry => entry.id === id);
    if (existing && existing.state !== "REJECTED") return existing;
    if (rows.some(entry => entry.kind === "start" && entry.jobId === job.id && entry.state === "REJECTED")) throw new Error("O início desta operação precisa de conferência antes da finalização.");
    const entry: OperationOutboxEntry = {
      version: 1, id, actorId: uid, companyId: job.companyId, jobId: job.id, kind: "finish",
      transport: "managed", requestId: existing?.requestId || requestId, job,
      state: "PENDING", createdAt: existing?.createdAt || this.now(), attempts: 0, retryAt: 0,
    };
    this.write(uid, [...rows.filter(row => row.id !== id), entry]);
    return entry;
  }
  startUnsettled(uid: string, jobId: string): boolean {
    return this.entries(uid).some(entry => entry.kind === "start" && entry.jobId === jobId && entry.state !== "CONFIRMED");
  }
  pending(uid = this.ports.uid()): OperationOutboxEntry[] { return this.entries(uid).filter(entry => entry.state !== "CONFIRMED"); }
  acknowledgeResultPresented(uid: string, entryId: string) {
    if (this.ports.uid() !== uid) return;
    const entry = this.entries(uid).find(row => row.id === entryId);
    if (entry?.kind === "finish" && entry.state === "CONFIRMED" && !entry.resultPresented)
      this.patch(uid, entryId, { resultPresented: true });
  }

  /** Realtime server rows stay authoritative; provisional data is isolated to
   * the owning driver/company and cannot resurrect a terminal server state. */
  project<T extends LocalOperationJob>(jobs: T[], uid: string, companyId: string): T[] {
    if (!uid || !companyId || uid !== this.ports.uid()) return jobs;
    const rows = new Map(jobs.map(job => [job.id, job]));
    for (const entry of this.entries(uid).filter(entry => entry.companyId === companyId)) {
      const current = rows.get(entry.jobId);
      if (current && terminal(current)) continue;
      if (entry.kind === "start" && entry.state === "CONFIRMED" && current?.operationSyncState === "pending_start")
        rows.set(entry.jobId, { ...current, operationSyncState: undefined, operationSyncError: undefined } as T);
      if (entry.kind === "start" && entry.state !== "CONFIRMED") {
        if (entry.state === "REJECTED") {
          if (current) rows.set(entry.jobId, { ...current, operationSyncState: "start_rejected", operationSyncError: entry.error } as T);
          else rows.set(entry.jobId, { ...entry.job, status: "pending", operationSyncState: "start_rejected", operationSyncError: entry.error } as unknown as T);
        } else rows.set(entry.jobId, { ...entry.job, ...current, status: "active", operationSyncState: "pending_start" } as T);
      }
      if (entry.kind === "finish" && entry.state !== "CONFIRMED" && current)
        rows.set(entry.jobId, { ...current, operationSyncState: entry.state === "REJECTED" ? "finish_rejected" : "pending_finish", operationSyncError: entry.error } as T);
      if (entry.state === "CONFIRMED" && !entry.observed && entry.result?.job &&
          (!current || entry.kind === "finish" && Number(current.operationalRevision || 0) <= Number(entry.result.job.operationalRevision || 0) || entry.kind === "start" && current.status === "pending"))
        rows.set(entry.jobId, { ...entry.result.job, operationSyncState: undefined, operationSyncError: undefined } as T);
    }
    return [...rows.values()];
  }
  observe(uid: string, companyId: string, jobs: LocalOperationJob[]) {
    const rows = this.entries(uid);
    let changed = false;
    for (const entry of rows) if (entry.companyId === companyId && entry.state === "CONFIRMED" && !entry.observed) {
      const job = jobs.find(job => job.id === entry.jobId && job.driverId === uid && job.companyId === companyId);
      if (job && (entry.kind === "start" ? job.status !== "pending" : terminal(job))) { entry.observed = true; changed = true; }
    }
    if (changed) this.write(uid, rows);
  }
  retry(jobId: string) {
    const uid = this.ports.uid();
    const rows = this.entries(uid).map(entry => entry.jobId === jobId && entry.state === "REJECTED"
      ? { ...entry, state: "PENDING" as const, retryAt: 0, error: undefined } : entry);
    this.write(uid, rows);
  }
  acknowledgeNativeCleanup(uid: string, id: string) {
    const entry = this.entries(uid).find(row => row.id === id);
    if (entry?.kind === "finish" && entry.state === "CONFIRMED" && !entry.nativeCleanupDone)
      this.patch(uid, id, { nativeCleanupDone: true });
  }
  synchronize(kind: "start" | "finish"): Promise<void> {
    const uid = this.ports.uid(), key = `${uid}:${kind}`;
    if (!uid || !this.ports.online()) return Promise.resolve();
    const existing = this.flights.get(key); if (existing) return existing;
    const run = Promise.resolve().then(() => this.send(uid, kind));
    this.flights.set(key, run);
    const cleanup = () => { if (this.flights.get(key) === run) this.flights.delete(key); };
    void run.then(cleanup, cleanup);
    return run;
  }
  private async send(uid: string, kind: "start" | "finish") {
    for (const candidate of this.entries(uid).filter(entry => entry.kind === kind &&
      (entry.state === "PENDING" || entry.state === "SENDING" && this.now() - Number(entry.sendingAt || 0) > 45_000) && entry.retryAt <= this.now())) {
      if (this.ports.uid() !== uid || !this.ports.online()) break;
      if (kind === "finish") {
        if (this.startUnsettled(uid, candidate.jobId)) continue;
        try { if (!await bounded(this.ports.canFinish(candidate), 5000)) continue; } catch { continue; }
      }
      if (this.ports.uid() !== uid) break;
      const latest = this.entries(uid).find(entry => entry.id === candidate.id);
      if (!latest || latest.state !== "PENDING" && !(latest.state === "SENDING" && this.now() - Number(latest.sendingAt || 0) > 45_000)) continue;
      const entry = { ...latest, attempts: latest.attempts + 1 };
      this.patch(uid, entry.id, { state: "SENDING", attempts: entry.attempts, sendingAt: this.now() });
      try {
        let result: Record<string, any>;
        if (kind === "start") {
          const job = await bounded(this.ports.sendStart(entry), this.ports.syncTimeoutMs ?? 30_000);
          if (job?.id !== entry.jobId || job.companyId !== entry.companyId || job.driverId !== uid ||
              job.contractId !== entry.job.contractId || job.vehicleId !== entry.job.vehicleId ||
              (Number.isInteger(job.totalDeliveries) && job.totalDeliveries !== entry.job.totalDeliveries) ||
              !["active", "delayed", "awaiting_completion", "completed", "cancelled"].includes(job.status)) throw new Error("OPERATION_START_ACK_INVALID");
          result = { job };
        } else {
          result = await bounded(this.ports.sendFinish(entry), this.ports.syncTimeoutMs ?? 30_000);
          if (result?.completed !== true || result.jobId !== entry.jobId || result.status !== "completed" ||
              !Number.isInteger(result.progress) || !Number.isInteger(result.total) || result.progress < 0 || result.total < 0 ||
              (!result.alreadyCompleted && (result.total < 1 || result.progress !== result.total))) throw new Error("OPERATION_FINISH_ACK_INVALID");
          result = { ...result, job: { ...entry.job, status: "completed", progress: result.progress,
            totalDeliveries: result.total, operationalRevision: result.operationalRevision ?? entry.job.operationalRevision,
            completedAt: new Date(this.now()).toISOString() } };
        }
        this.patch(uid, entry.id, { state: "CONFIRMED", sendingAt: undefined, error: undefined, result });
      } catch (error: any) {
        const transient = !this.ports.online() || retryable(error);
        this.patch(uid, entry.id, { state: transient ? "PENDING" : "REJECTED", sendingAt: undefined,
          retryAt: transient ? this.now() + Math.min(60_000, 1000 * 2 ** Math.min(6, entry.attempts - 1)) : 0,
          error: String(error?.message || "Não foi possível confirmar a operação.").slice(0, 500) });
      }
    }
  }
}

export async function automaticOperationJobId(uid: string, requestId: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([uid, requestId]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return "oc1_" + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
