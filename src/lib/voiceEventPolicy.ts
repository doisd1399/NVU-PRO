import type { VoiceCueId } from './voiceCatalog';
import type { VoiceObservation } from './voiceEventSource';
export type VoicePolicyScope = { userId: string; companyId: string; role: 'driver' | 'admin'; simulatorId: string };
export type VoicePolicyEvent = { cue: VoiceCueId; eventId: string };
type Row = Record<string, any>;
export const voiceTimestamp = (v: any): number => {
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  return typeof v === 'number' ? v : Date.parse(String(v || ''));
};
const fresh = (v: any, now: number) => { const at = voiceTimestamp(v); return Number.isFinite(at) && at <= now + 1000 && now - at <= 20_000; };
const running = (r: Row) => ['active', 'delayed', 'awaiting_completion'].includes(r.status);
const open = (r: Row) => running(r) || r.status === 'pending';
const due = (r: Row) => voiceTimestamp(r.dueAt || r.deadlineDate || r.deadlineMs);
const total = (r: Row) => Number(r.totalDeliveries || r.contractSnapshot?.totalDeliveries || 0);

/** Initial server snapshots establish a silent baseline. Only live transitions speak. */
export class VoiceEventObserver {
  private snapshots = new Map<string, Map<string, Row>>();
  private deadlines = new Map<string, { row: Row; at: number }>();
  private pendingTrips = new Set<string>();
  private batchAt = 0;
  private offlinePending = new Set<string>();
  private wasOffline = false;
  private variant = 0;
  constructor(private scope: VoicePolicyScope, private emit: (event: VoicePolicyEvent) => void,
    private now: () => number = Date.now, private sessionId = 'session') {}
  observe(observation: VoiceObservation): void {
    const now = this.now(), s = this.scope;
    if (observation.userId !== s.userId || observation.companyId !== s.companyId ||
      (observation.role && observation.role !== s.role) || !fresh(observation.at, now)) return;
    const rows = observation.rows.filter(r => !r.simulatorId || !s.simulatorId || r.simulatorId === s.simulatorId);
    if (observation.kind === 'trip-ack') {
      for (const row of rows) {
        if (!row.id || row.deleted || row.driverId !== s.userId || row.companyId !== s.companyId || !row.serverValidatedAt) continue;
        // This input is produced only after a validated UPSERT ACK, never by history/edits.
        this.offlinePending.delete(row.id);
        const cue = (['event_trip_saved', 'event_trip_saved_b', 'event_trip_saved_c'] as const)[this.variant++ % 3];
        this.emit({ cue, eventId: row.id });
      }
      return;
    }
    if (observation.kind === 'trip-failed') {
      for (const row of rows) if (row.id && row.driverId === s.userId && row.companyId === s.companyId && row.definitive === true)
        this.emit({ cue: 'event_trip_failed', eventId: row.id });
      return;
    }
    const channel = `${observation.kind}:${observation.channel || ''}`;
    const previous = this.snapshots.get(channel);
    const current = new Map(rows.filter(r => r.id).map(r => [String(r.id), { ...r }]));
    this.snapshots.set(channel, current);
    if (observation.kind === 'jobs') for (const [id, row] of current) this.deadlines.set(id, { row: { ...this.deadlines.get(id)?.row, ...row }, at: this.deadlines.get(id)?.at || now });
    if (observation.kind === 'jobs' && previous) for (const id of previous.keys()) if (!current.has(id)) this.deadlines.delete(id);
    if (observation.kind === 'partnerships') for (const row of current.values()) {
      const state = this.deadlines.get(String(row.jobId || ''));
      if (state && row.executorCompanyId === s.companyId) state.row = { ...state.row, goalAmountCents: row.goalAmountCents, earningsCents: row.earningsCents };
    }
    if (observation.kind === 'payments' && s.role === 'admin' && rows.some(r => r.status === 'pending' && Number(r.amountCents) > 0)) this.send('admin_payments_due', new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now));
    if (!previous) return;
    for (const [id, row] of current) {
      const before = previous.get(id);
      if (observation.kind === 'jobs') {
        if (s.role === 'driver' && row.driverId !== s.userId) continue;
        if (row.companyId !== s.companyId || row.operationSyncState) continue;
        if (!before) {
          if (s.role === 'driver' && row.status === 'pending' && fresh(row.assignedAt || row.createdAt, now)) this.send('event_new_job', id);
          continue;
        }
        const changedAt = Math.max(...[row.updatedAt, row.completedAt, row.startedAt, row.cancelledAt, row.progressUpdatedAt].map(voiceTimestamp).filter(Number.isFinite));
        if (!fresh(changedAt, now)) continue;
        if (!running(before) && running(row)) this.send(s.role === 'driver' ? 'event_job_started' : 'admin_driver_started', id);
        if (before.status !== 'completed' && row.status === 'completed') this.send(s.role === 'driver' ? 'event_job_completed' : 'admin_driver_completed', id);
        // Cancellation voice says "pela empresa": self-cancellation must stay silent.
        if (s.role === 'driver' && before.status !== 'cancelled' && row.status === 'cancelled' && row.cancelledBy && row.cancelledBy !== s.userId)
          this.send('event_job_cancelled', id);
        const count = Number(row.progress), oldCount = Number(before.progress), required = total(row);
        if (!Number.isFinite(count) || !Number.isFinite(oldCount) || count <= oldCount) continue;
        if (s.role === 'admin') {
          this.pendingTrips.add(`${id}:${count}`); if (!this.batchAt) this.batchAt = now + 10_000;
        } else if (required >= 2) {
          if (oldCount < required - 1 && count === required - 1) this.send('event_last_trip', id);
          else if (oldCount / required < .5 && count / required >= .5 && count < required) this.send('event_half_done', id);
        }
      } else if (observation.kind === 'offers') {
        if (s.role === 'admin' && before && before.status !== 'declined' && row.status === 'declined' && fresh(row.respondedAt || row.updatedAt, now)) this.send('admin_job_declined', id);
      } else if (observation.kind === 'candidates') {
        if (s.role === 'admin' && !before && row.status === 'pending' && fresh(row.createdAt, now)) this.send('admin_new_candidate', id);
      } else if (observation.kind === 'payments') {
        if (s.role === 'driver' && before && before.status !== 'received' && row.status === 'received' && row.driverId === s.userId && fresh(row.receivedAtMs, now))
          this.send('event_payment_confirmed', id);
      } else if (observation.kind === 'partnerships') {
        const mine = s.role === 'admin' ? [row.contractorCompanyId, row.executorCompanyId].includes(s.companyId)
          : row.executorCompanyId === s.companyId && row.driverId === s.userId;
        if (!mine || !fresh(row.updatedAtMs, now)) continue;
        if (!before) {
          if (s.role === 'admin' && row.executorCompanyId === s.companyId && row.status === 'pending' && fresh(row.createdAtMs, now)) this.send('admin_partnership_offer', id);
          continue;
        }
        const goal = Number(row.goalAmountCents), earned = Number(row.earningsCents), oldEarned = Number(before.earningsCents);
        if (goal > 0 && earned >= goal && oldEarned < goal) this.send(s.role === 'admin' ? 'admin_goal_reached' : 'event_goal_reached', row.jobId || id);
        else if (s.role === 'driver' && goal > 0 && earned >= .8 * goal && oldEarned < .8 * goal && earned < goal) this.send('event_near_goal', row.jobId || id);
        // A payer's "paid" claim is not a confirmed receipt. Only settled + receiver identity.
        if (s.role === 'admin' && row.executorCompanyId === s.companyId && before.payment?.status !== 'settled' && row.payment?.status === 'settled' && fresh(row.payment.settledAtMs, now)) this.send('admin_payment_received', id);
      }
    }
  }
  notification(row: Row): void {
    const s = this.scope, now = this.now();
    if (row.userId !== s.userId || row.companyId !== s.companyId || !fresh(row.createdAtIso || row.createdAt || row.dataHora, now) || row.read || row.lida) return;
    const type = String(row.type || row.tipo || '');
    // These notifications are issued after committed server state. Financial claims are excluded.
    const admin: Record<string, VoiceCueId> = { PARTNERSHIP_OFFER: 'admin_partnership_offer', REWARD_DECLINED: 'admin_job_declined', REWARD_PAYROLL_READY: 'admin_payments_due', PARTNERSHIP_PAYMENT_DUE: 'admin_payments_due' };
    const driver: Record<string, VoiceCueId> = { NEW_OPERATION: 'event_new_job', NEW_JOB: 'event_new_job', JOB_ASSIGNED: 'event_new_job' };
    const cue = (s.role === 'admin' ? admin : driver)[type];
    if (cue) this.send(cue, cue === 'admin_payments_due' ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now) : String(row.metadata?.jobId || row.metadata?.partnershipId || row.id));
  }
  hasNews(rows: Row[]): boolean {
    return rows.some(r => r.companyId === this.scope.companyId && !r.read && !r.lida && ['PARTNERSHIP_OFFER', 'REWARD_DECLINED', 'REWARD_PAYROLL_READY', 'PARTNERSHIP_PAYMENT_DUE'].includes(String(r.type || r.tipo || '')));
  }
  connection(online: boolean, pendingIds: string[], hasRunningWork: boolean): void {
    if (!online) {
      this.wasOffline = true; pendingIds.forEach(id => this.offlinePending.add(id));
      // Promise of durable saving is spoken only after a trip actually entered the local queue.
      if (hasRunningWork && pendingIds.length) this.send('event_offline', this.sessionId);
    }
    // Online alone never proves upload. Await real ACKs and an entirely drained queue.
    // Keep recovery armed until the synchronization facade confirms the batch.
  }
  synced(synced: number, remaining: number, pendingIds: string[]): void {
    if (this.wasOffline && synced > 0 && remaining === 0 && pendingIds.length === 0 && this.offlinePending.size === 0) {
      this.send('event_back_online', `${this.sessionId}:sync`); this.wasOffline = false;
    }
  }
  tick(): void {
    const now = this.now();
    for (const [id, state] of this.deadlines) {
      const { row, at } = state, end = due(row); state.at = now;
      if (!open(row) || !Number.isFinite(end) || now < at || now - at > 90_000) continue;
      if (at < end && end <= now) this.send(this.scope.role === 'admin' ? 'admin_late' : 'event_deadline_passed', id);
      else if (this.scope.role === 'driver' && at < end - 6 * 3_600_000 && end - 6 * 3_600_000 <= now && now < end) {
        const goal = Number(row.goalAmountCents), earned = Number(row.earningsCents);
        this.send(goal > 0 && Number.isFinite(earned) && earned < goal ? 'event_deadline_goal_risk' : 'event_deadline_near', id);
      }
    }
    if (this.batchAt && now >= this.batchAt) {
      const ids = [...this.pendingTrips].sort(), readyAt = this.batchAt; this.pendingTrips.clear(); this.batchAt = 0;
      if (ids.length && now - readyAt <= 20_000) this.send('admin_trips_batch', ids.join('|'));
    }
  }
  private send(cue: VoiceCueId, eventId: string) { if (eventId) this.emit({ cue, eventId }); }
}
