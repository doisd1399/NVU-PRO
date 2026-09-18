export type SessionSurfaceState =
  | "auth-pending"
  | "identity-pending"
  | "membership-pending"
  | "diagnostic"
  | "empty"
  | "ready";

export type SessionSurfaceInput = {
  authReady: boolean;
  identityReconciliationStatus: "idle" | "pending" | "complete" | "failed";
  membershipsLoaded: boolean;
  membershipsCount: number;
  sessionRecovering: boolean;
  diagnosticCode?: string | null;
};

/**
 * Orders the selector states from least authoritative to most authoritative.
 * A definitive error must win over the generic pending state; otherwise
 * `membershipsLoaded === false` would keep the UI on an infinite spinner and
 * hide the retry/diagnostic surface forever.
 */
export function resolveSessionSurfaceState(
  input: SessionSurfaceInput,
): SessionSurfaceState {
  if (!input.authReady) return "auth-pending";

  const identityPending =
    input.identityReconciliationStatus === "idle" ||
    input.identityReconciliationStatus === "pending";
  if (identityPending) return "identity-pending";

  const diagnosticCode = String(input.diagnosticCode || "");
  const hasDiagnosticFailure =
    input.identityReconciliationStatus === "failed" ||
    diagnosticCode === "IDENTITY_RECONCILIATION_FAILED" ||
    diagnosticCode === "MEMBERSHIP_SERVER_ERROR";
  if (hasDiagnosticFailure) return "diagnostic";

  const membershipPending =
    !input.membershipsLoaded ||
    input.sessionRecovering ||
    diagnosticCode === "MEMBERSHIP_SERVER_PENDING" ||
    diagnosticCode === "MEMBERSHIP_CACHE_ONLY";
  if (membershipPending) return "membership-pending";

  if (
    input.identityReconciliationStatus === "complete" &&
    input.membershipsCount === 0 &&
    diagnosticCode === "MEMBERSHIP_SERVER_EMPTY"
  ) {
    return "empty";
  }

  return "ready";
}
