export type SessionBootEventName =
  | "APP_START"
  | "AUTH_RESTORED"
  | "SNAPSHOT_READ"
  | "PROFILE_RESTORED"
  | "ROUTE_RESTORED"
  | "SESSION_UI_READY"
  | "FIRST_RENDER"
  | "AUTHORIZATION_READY"
  | "DATA_SYNC_STARTED"
  | "DATA_SYNC_READY";

export type SessionBootEvent = {
  event: SessionBootEventName;
  timestamp: number;
  uidPresent?: boolean;
  role?: string | null;
  companyPresent?: boolean;
  routePresent?: boolean;
};

const trace: SessionBootEvent[] = [];
const onceKeys = new Set<string>();

/**
 * Local-only bootstrap trace. It is intentionally not sent to Firebase or any
 * remote telemetry system. UID/role/company values are reduced to presence
 * booleans unless a local diagnostic explicitly reads the trace.
 */
export function markSessionBootEvent(
  event: SessionBootEventName,
  context: Omit<SessionBootEvent, "event" | "timestamp"> = {},
  onceKey = event,
): void {
  if (onceKeys.has(onceKey)) return;
  onceKeys.add(onceKey);
  trace.push({
    event,
    timestamp: Date.now(),
    uidPresent: Boolean(context.uidPresent),
    role: context.role ?? null,
    companyPresent: Boolean(context.companyPresent),
    routePresent: Boolean(context.routePresent),
  });

  if (
    typeof window !== "undefined" &&
    (window as Window & { __NVU_ENABLE_BOOT_TELEMETRY__?: boolean })
      .__NVU_ENABLE_BOOT_TELEMETRY__ === true
  ) {
    console.debug("[NVU_BOOT]", trace[trace.length - 1]);
  }
}

export function readSessionBootTrace(): SessionBootEvent[] {
  return trace.map((entry) => ({ ...entry }));
}

export function resetSessionBootTelemetry(): void {
  trace.splice(0, trace.length);
  onceKeys.clear();
}
