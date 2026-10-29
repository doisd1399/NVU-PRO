/** Diagnostic metadata only; never changes the outcome or retries a write. */
export function tagLocalCommitError(error: unknown, phase: string): Error {
  const original = error instanceof Error ? error : new Error(String(error));
  try {
    if (!(original as any).localCommitPhase) Object.assign(original, { localCommitPhase: phase });
    return original;
  } catch {
    return Object.assign(new Error(original.message), { cause: original, localCommitPhase: phase });
  }
}

export function localCommitStep<T>(phase: string, work: () => T): T {
  try { return work(); } catch (error) { throw tagLocalCommitError(error, phase); }
}

export function sanitizePrintDiagnostic(value: unknown): string {
  return String(value ?? "")
    .replace(/(?:https?:\/\/|file:\/\/|content:\/\/)[^\s)]+/gi, "[url]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?:Bearer\s+)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, "[token]")
    .replace(/\b(?:token|password|senha|authorization|apiKey)\s*[:=]\s*\S+/gi, "[credential]")
    .replace(/data:[^\s]+/gi, "[data]")
    .replace(/"[^"\n]*"|'[^'\n]*'/g, "[quoted]")
    .replace(/\b(?=[A-Za-z0-9_-]{24,}\b)(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]+\b/g, "[id]")
    .slice(0, 1200);
}

export function buildPrintDiagnostic(error: any, phase: string, runtime: Record<string, unknown> = {}, storage?: Pick<Storage, 'getItem'>): string {
  const chain: Record<string, unknown>[] = [];
  const seen = new Set();
  for (let current = error; current != null && !seen.has(current) && chain.length < 5; current = current?.cause) {
    seen.add(current);
    chain.push({ name: sanitizePrintDiagnostic(current?.name), code: sanitizePrintDiagnostic(current?.code),
      message: sanitizePrintDiagnostic(current?.message ?? current), stack: sanitizePrintDiagnostic(current?.stack),
      storageReason: sanitizePrintDiagnostic(current?.storageFailureReason) });
  }
  let journal: Record<string, unknown> = { state: 'unavailable' };
  try {
    if (storage) {
      const raw = storage.getItem('nvu_canonical_trips.v2');
      if (!raw) journal = { state: 'absent' };
      else {
        const parsed = JSON.parse(raw);
        const id = typeof error?.localCommitTripId === 'string' ? error.localCommitTripId : '';
        journal = { state: 'read', schema: typeof parsed?.schemaVersion === 'number' ? parsed.schemaVersion : 'unknown',
          stringCodeUnits: raw.length, records: Object.keys(parsed?.records || {}).length, commands: Object.keys(parsed?.outbox || {}).length,
          attemptRecordExists: id ? Object.hasOwn(parsed?.records || {}, id) : 'unknown',
          attemptCommandExists: id ? Object.hasOwn(parsed?.outbox || {}, id) : 'unknown' };
      }
    }
  } catch (readError) { journal = { state: 'read-failed', error: sanitizePrintDiagnostic((readError as Error)?.message) }; }
  // A separate persistent tombstone ledger can block an attempt even with an
  // empty journal. Read it for diagnosis only; NEVER remove or recycle its ID.
  let identityGuard: Record<string, unknown> | undefined;
  if (String(error?.code || error?.message || "").includes("CANONICAL_TRIP_TOMBSTONED")) {
    try {
      if (storage) {
        const raw = storage.getItem('nvu.trips.tombstones.v2') || storage.getItem('nvu.trips.tombstones.v1');
        const parsed = raw ? JSON.parse(raw) : [];
        const entries = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? Object.entries(parsed) : [];
        const tripId = typeof error?.localCommitTripId === 'string' ? error.localCommitTripId : '';
        identityGuard = {
          state: raw ? 'read' : 'absent',
          markers: entries.length,
          attemptTombstoned: Boolean(tripId && entries.some((entry: any) =>
            Array.isArray(entry) ? String(entry[0]) === tripId : String(entry?.id || '') === tripId)),
        };
      }
    } catch { identityGuard = { state: 'read-failed' }; }
  }
  // Runtime is an allowlist, never an arbitrary object or source trip.
  const device = Object.fromEntries(['nativeVersion', 'versionCode', 'android', 'model', 'webView', 'webBuildId', 'webVersion']
    .filter(key => runtime[key] != null).map(key => [key, sanitizePrintDiagnostic(runtime[key])]));
  return JSON.stringify({ diagnostic: 'NVU_PRINT_517_1', at: new Date().toISOString(),
    correlation: `print-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    phase: sanitizePrintDiagnostic(error?.localCommitPhase || phase), stage: sanitizePrintDiagnostic(error?.tripSyncStage || phase),
    elapsedMs: Number.isFinite(error?.localCommitElapsedMs) ? error.localCommitElapsedMs : undefined,
    device, errors: chain, journal, ...(identityGuard ? { identityGuard } : {}) }, null, 2);
}
