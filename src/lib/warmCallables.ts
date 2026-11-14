import { auth, functions } from "./firebase";
import { isAuthTeardownActive } from "./authLifecycle";
import { WARMABLE_CALLABLES } from "./callableRegions";
import { httpsCallable } from "./regionalCallable";
import { shouldWarm } from "./warmPolicy";

/**
 * Wakes the idle server instances behind the hottest actions (start, finish, trip registration) while the app is
 * being opened, so the first real tap does not also pay the instance start-up (module loading + first connection).
 *
 * Cost control: one tiny request per function, at most once every 10 minutes, only while the app is visible, online
 * and signed in. There is no timer — an app left open in the background sends nothing. The server answers the
 * `{ __warm: true }` ping before any authorization or database work, so it reads and writes nothing.
 */
let lastWarmAt = 0;

/** Fire-and-forget. Never throws and never blocks the caller. Returns whether a warm-up round was started. */
export function warmHotCallables(now = Date.now()): boolean {
  try {
    if (!shouldWarm({
      now, lastWarmAt,
      online: typeof navigator === "undefined" || navigator.onLine !== false,
      hidden: typeof document !== "undefined" && document.hidden,
      signedIn: !!auth.currentUser?.uid,
      tearingDown: isAuthTeardownActive(),
    })) return false;
    lastWarmAt = now;
    for (const name of WARMABLE_CALLABLES) {
      void httpsCallable(functions, name, { timeout: 15_000 })({ __warm: true }).catch(() => undefined);
    }
    return true;
  } catch { return false; }
}
