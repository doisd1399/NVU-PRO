export type ProfilePerfEventName =
  | "T0_SELECT_PROFILE"
  | "T1_SWITCH_ROLE_START"
  | "T2_SWITCH_ROLE_RETURN"
  | "T3_NAVIGATE_START"
  | "T3_NAVIGATE_RETURN"
  | "T4_PROTECTED_ROUTE_ENTER"
  | "T5_SESSION_UI_NOT_READY"
  | "T5_SESSION_UI_READY"
  | "T6_MEMBERSHIP_START"
  | "T7_MEMBERSHIP_END"
  | "T8_ROUTE_LOADING_START"
  | "T8_ROUTE_LOADING_END"
  | "T9_CHUNK_START"
  | "T10_CHUNK_END"
  | "T11_PROFILE_FIRST_PAINT"
  | "PRELOAD_START"
  | "PRELOAD_END"
  | "PRELOAD_SUCCESS"
  | "PRELOAD_FAILED"
  | "PRELOAD_CACHE_HIT"
  | "CHUNK_CACHE_HIT";

type ProfilePerfContext = {
  route?: string;
  role?: "admin" | "driver" | null;
  reason?: string;
  source?: string;
  result?: "success" | "failure" | "timeout" | "cache-hit";
  count?: number;
  cacheHit?: boolean;
  serverSide?: boolean;
  preloaded?: boolean;
};

export type ProfilePerfEvent = ProfilePerfContext & {
  event: ProfilePerfEventName;
  timestamp: number;
};

const trace: ProfilePerfEvent[] = [];
const PERF_FLAG = "__NVU_ENABLE_PROFILE_PERF__";

const isEnabled = () =>
  typeof window !== "undefined" &&
  (window as Window & { [PERF_FLAG]?: boolean })[PERF_FLAG] === true;

export function markProfilePerf(
  event: ProfilePerfEventName,
  context: ProfilePerfContext = {},
): void {
  if (!isEnabled()) return;
  const entry: ProfilePerfEvent = {
    event,
    timestamp:
      typeof performance !== "undefined" ? performance.now() : Date.now(),
    ...context,
  };
  trace.push(entry);
  if (typeof window !== "undefined") {
    const debugWindow = window as Window & {
      __NVU_PROFILE_PERF_READ__?: () => ProfilePerfEvent[];
      __NVU_PROFILE_PERF_SUMMARY__?: () => ReturnType<typeof summarizeProfilePerfTrace>;
      __NVU_PROFILE_PERF_RESET__?: () => void;
    };
    debugWindow.__NVU_PROFILE_PERF_READ__ = readProfilePerfTrace;
    debugWindow.__NVU_PROFILE_PERF_SUMMARY__ = summarizeProfilePerfTrace;
    debugWindow.__NVU_PROFILE_PERF_RESET__ = resetProfilePerfTrace;
  }
  console.debug("[PROFILE_PERF]", entry);
}

export function readProfilePerfTrace(): ProfilePerfEvent[] {
  return trace.map((entry) => ({ ...entry }));
}

export function resetProfilePerfTrace(): void {
  trace.splice(0, trace.length);
}

export function profilePerfEnabled(): boolean {
  return isEnabled();
}

const timestampOf = (
  events: ProfilePerfEvent[],
  name: ProfilePerfEventName,
): number | null => events.find((event) => event.event === name)?.timestamp ?? null;

const delta = (from: number | null, to: number | null): number | null =>
  from === null || to === null ? null : Number((to - from).toFixed(2));

export function summarizeProfilePerfTrace() {
  const events = readProfilePerfTrace();
  const t0 = timestampOf(events, "T0_SELECT_PROFILE");
  const t1 = timestampOf(events, "T1_SWITCH_ROLE_START");
  const t2 = timestampOf(events, "T2_SWITCH_ROLE_RETURN");
  const t3 = timestampOf(events, "T3_NAVIGATE_START");
  const t3Return = timestampOf(events, "T3_NAVIGATE_RETURN");
  const t4 = timestampOf(events, "T4_PROTECTED_ROUTE_ENTER");
  const t5 = timestampOf(events, "T5_SESSION_UI_READY");
  const t6 = timestampOf(events, "T6_MEMBERSHIP_START");
  const t7 = timestampOf(events, "T7_MEMBERSHIP_END");
  const t8 = timestampOf(events, "T8_ROUTE_LOADING_START");
  const t8End = timestampOf(events, "T8_ROUTE_LOADING_END");
  const t9 = timestampOf(events, "T9_CHUNK_START");
  const t10 = timestampOf(events, "T10_CHUNK_END");
  const t11 = timestampOf(events, "T11_PROFILE_FIRST_PAINT");

  return {
    events,
    intervalsMs: {
      t1_minus_t0: delta(t0, t1),
      t2_minus_t1: delta(t1, t2),
      t3_minus_t2: delta(t2, t3),
      t3_return_minus_t3: delta(t3, t3Return),
      t4_minus_t3_return: delta(t3Return, t4),
      t5_minus_t4: delta(t4, t5),
      t6_minus_t5: delta(t5, t6),
      t7_minus_t6: delta(t6, t7),
      t8_minus_t7: delta(t7, t8),
      t8_end_minus_t8: delta(t8, t8End),
      t9_minus_t8: delta(t8, t9),
      t10_minus_t9: delta(t9, t10),
      t11_minus_t10: delta(t10, t11),
      total_t11_minus_t0: delta(t0, t11),
    },
  };
}
