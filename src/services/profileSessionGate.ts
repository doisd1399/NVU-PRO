import {
  resolveSessionSurfaceState,
  type SessionSurfaceState,
} from "./sessionSurfaceState";

export type ProfileSessionGateState =
  | "auth-pending"
  | "diagnostic"
  | "identity-pending"
  | "membership-pending"
  | "identity-failed"
  | "empty"
  | "ready";

type ProfileSessionGateInput = {
  authReady: boolean;
  identityReconciliationStatus: "idle" | "pending" | "complete" | "failed";
  membershipsLoaded: boolean;
  membershipsCount: number;
  availableCompaniesCount: number;
  sessionRecovering: boolean;
  diagnosticCode?: string | null;
  hasSessionDiagnostic: boolean;
};

export function resolveProfileSessionGate(
  input: ProfileSessionGateInput,
): ProfileSessionGateState {
  if (!input.authReady) return "auth-pending";

  const surface: SessionSurfaceState = resolveSessionSurfaceState({
    authReady: input.authReady,
    identityReconciliationStatus: input.identityReconciliationStatus,
    membershipsLoaded: input.membershipsLoaded,
    membershipsCount: input.membershipsCount,
    sessionRecovering: input.sessionRecovering,
    diagnosticCode: input.diagnosticCode,
  });

  const hasDiagnosticFailure =
    input.identityReconciliationStatus === "failed" ||
    input.diagnosticCode === "IDENTITY_RECONCILIATION_FAILED" ||
    input.diagnosticCode === "MEMBERSHIP_SERVER_ERROR";

  // A transient listener/revalidation failure must not block a profile that
  // already has a server-confirmed membership in the current session. Show the
  // diagnostic only before the first current-generation authorization exists.
  if (
    input.hasSessionDiagnostic &&
    hasDiagnosticFailure &&
    !input.membershipsLoaded &&
    input.membershipsCount === 0 &&
    input.availableCompaniesCount === 0
  ) {
    return "diagnostic";
  }
  if (
    input.identityReconciliationStatus === "failed" &&
    input.membershipsCount === 0 &&
    input.availableCompaniesCount === 0
  ) {
    return "identity-failed";
  }

  const noVisibleMembership =
    input.membershipsCount === 0 && input.availableCompaniesCount === 0;
  if (surface === "identity-pending" && noVisibleMembership) {
    return "identity-pending";
  }
  if (surface === "membership-pending" && noVisibleMembership) {
    return "membership-pending";
  }

  if (
    surface === "empty" &&
    input.identityReconciliationStatus === "complete" &&
    input.membershipsLoaded &&
    !input.sessionRecovering &&
    input.diagnosticCode === "MEMBERSHIP_SERVER_EMPTY" &&
    input.availableCompaniesCount === 0
  ) {
    return "empty";
  }

  return "ready";
}
