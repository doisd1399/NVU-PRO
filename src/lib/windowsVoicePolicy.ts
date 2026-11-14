import type { WindowsScope, WindowsStatus } from './windowsAutomation';
import type { VoiceCueId } from './voiceCatalog';

/** Observes the existing native journal. A detected trip is never called saved. */
export class WindowsVoiceObserver {
  private context = '';
  private ready = false;
  private seen = new Set<string>();
  constructor(private emit: (cue: VoiceCueId, eventId: string, scope: WindowsScope) => void,
    private now: () => number = Date.now) {}
  observe(status: WindowsStatus, scope: WindowsScope | null): void {
    const actual = status.scope;
    if (!scope || !actual || !['ets2', 'ats'].includes(scope.simulatorKey) ||
      actual.driverId !== scope.driverId || actual.companyId !== scope.companyId ||
      actual.jobId !== scope.jobId || actual.simulatorKey !== scope.simulatorKey) return;
    const context = JSON.stringify([scope.driverId, scope.companyId, scope.jobId, scope.simulatorKey]);
    const ready = status.active && status.enabled && status.connected && !scope.closed;
    const matching = status.pending.filter(row => row.scope.driverId === scope.driverId &&
      row.scope.companyId === scope.companyId && row.scope.jobId === scope.jobId &&
      row.scope.simulatorKey === scope.simulatorKey);
    if (context !== this.context) {
      this.context = context; this.ready = ready;
      this.seen = new Set(matching.map(row => row.id));
      return; // Hydration and context changes establish a silent baseline.
    }
    if (ready && !this.ready) this.emit('event_pro_ready', `${context}:ready`, scope);
    this.ready = ready;
    for (const row of matching) {
      if (this.seen.has(row.id)) continue;
      this.seen.add(row.id);
      const age = this.now() - Number(row.event.capturedAt);
      if (status.active && status.enabled && ['PENDING', 'QUEUED'].includes(row.state) && age >= -1000 && age <= 20_000)
        this.emit('event_trip_detected', row.id, scope);
    }
  }
}
