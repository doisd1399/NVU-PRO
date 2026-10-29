type JobLike = { id: string; companyId?: unknown; operationalCommandVersion?: unknown; operationalRevision?: unknown; status?: unknown };
/** A late command response must not replace a newer realtime terminal state. */
export function mergeManagedOperationAcknowledgement<T extends JobLike>(current: T | undefined, incoming: T): T {
  if (!current || current.id !== incoming.id || current.companyId !== incoming.companyId || current.operationalCommandVersion !== 1) return incoming;
  const currentRevision = Number(current.operationalRevision || 0), nextRevision = Number(incoming.operationalRevision || 0);
  if (currentRevision > nextRevision) return current;
  if (["completed", "cancelled"].includes(String(current.status)) && !["completed", "cancelled"].includes(String(incoming.status))) return current;
  return { ...current, ...incoming };
}

/** Retain archived/terminal revisions for this session, even when hidden from
 * the visible list. Otherwise a delayed start ACK could resurrect that row. */
export class ManagedOperationAcknowledgementCache<T extends JobLike> {
  private scope = "";
  private readonly rows = new Map<string, T>();
  resetScope(scope: string): void {
    if (scope !== this.scope) { this.rows.clear(); this.scope = scope; }
  }
  merge(incoming: T): T {
    const merged = mergeManagedOperationAcknowledgement(this.rows.get(incoming.id), incoming);
    if (merged.operationalCommandVersion === 1) this.rows.set(merged.id, merged);
    return merged;
  }
}
