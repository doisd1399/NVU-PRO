export type GoogleAuthEnvironment = "web-desktop" | "web-mobile" | "android";

export type GoogleAuthPhase =
  | "idle"
  | "starting"
  | "awaiting-provider"
  | "credential-received"
  | "firebase-authenticating"
  | "auth-confirmed"
  | "ready-for-profile-selector"
  | "ready-for-protected-route"
  | "recoverable-error"
  | "cancelled"
  | "signed-out";

type GoogleAuthState = {
  attemptId: string;
  environment: GoogleAuthEnvironment;
  phase: GoogleAuthPhase;
};

const terminalPhases = new Set<GoogleAuthPhase>([
  "ready-for-profile-selector",
  "ready-for-protected-route",
  "cancelled",
  "signed-out",
]);

const allowedTransitions: Record<GoogleAuthPhase, ReadonlySet<GoogleAuthPhase>> = {
  idle: new Set(["starting"]),
  starting: new Set(["awaiting-provider", "credential-received", "recoverable-error", "cancelled"]),
  "awaiting-provider": new Set(["credential-received", "recoverable-error", "cancelled"]),
  "credential-received": new Set(["firebase-authenticating", "recoverable-error"]),
  "firebase-authenticating": new Set(["auth-confirmed", "recoverable-error"]),
  "auth-confirmed": new Set(["ready-for-profile-selector", "ready-for-protected-route", "recoverable-error"]),
  "ready-for-profile-selector": new Set(),
  "ready-for-protected-route": new Set(),
  "recoverable-error": new Set(["starting"]),
  cancelled: new Set(["starting"]),
  "signed-out": new Set(["starting"]),
};

export type GoogleAuthAttempt = {
  readonly attemptId: string;
  readonly environment: GoogleAuthEnvironment;
  readonly state: () => GoogleAuthState;
  transition: (nextPhase: GoogleAuthPhase) => GoogleAuthState;
  fail: () => GoogleAuthState;
  cancel: () => GoogleAuthState;
};

export const createGoogleAuthAttempt = (
  attemptId: string,
  environment: GoogleAuthEnvironment,
): GoogleAuthAttempt => {
  let current: GoogleAuthState = {
    attemptId,
    environment,
    phase: "idle",
  };

  const transition = (nextPhase: GoogleAuthPhase): GoogleAuthState => {
    if (terminalPhases.has(current.phase)) {
      throw new Error(
        `GOOGLE_AUTH_TERMINAL_TRANSITION:${current.phase}->${nextPhase}`,
      );
    }
    if (!allowedTransitions[current.phase].has(nextPhase)) {
      throw new Error(
        `GOOGLE_AUTH_INVALID_TRANSITION:${current.phase}->${nextPhase}`,
      );
    }
    current = { ...current, phase: nextPhase };
    return current;
  };

  return {
    attemptId,
    environment,
    state: () => current,
    transition,
    fail: () => {
      if (!terminalPhases.has(current.phase)) return transition("recoverable-error");
      return current;
    },
    cancel: () => {
      if (current.phase === "starting" || current.phase === "awaiting-provider") {
        return transition("cancelled");
      }
      return current;
    },
  };
};
