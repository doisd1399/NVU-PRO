export type OperationCloseQueueEntry = {
  jobId?: unknown;
  queueStatus?: unknown;
};

export type OperationCloseQueueSnapshot = {
  ownerAuthenticated?: unknown;
  ownerMismatch?: unknown;
  pendingProTrips?: unknown;
};

export type OperationCloseQueueDecision =
  | { status: "ready"; unresolvedCount: 0 }
  | { status: "pending"; unresolvedCount: number }
  | { status: "unverified"; unresolvedCount: 0 };

const UNSETTLED_STATUSES = new Set([
  "WAITING",
  "SENDING",
  "AUTH_REQUIRED",
  "FAILED",
  "PERMISSION_PAUSED",
]);

/** Legacy diagnostic classifier, retained for read-only compatibility tests.
 * Do not use this result to authorize or block finalization: the authenticated
 * completeCanonicalOperation transaction owns that decision. */
export function inspectOperationCloseQueue(
  snapshot: OperationCloseQueueSnapshot,
  requestedJobId: string,
): OperationCloseQueueDecision {
  const jobId = String(requestedJobId || "").trim();
  if (!jobId || snapshot?.ownerAuthenticated !== true || snapshot?.ownerMismatch === true) {
    return { status: "unverified", unresolvedCount: 0 };
  }
  if (!Array.isArray(snapshot.pendingProTrips)) {
    return { status: "unverified", unresolvedCount: 0 };
  }
  const rows = snapshot.pendingProTrips as OperationCloseQueueEntry[];
  const unresolvedCount = rows.filter((entry) =>
    String(entry?.jobId || "").trim() === jobId &&
    UNSETTLED_STATUSES.has(String(entry?.queueStatus || "").trim().toUpperCase()),
  ).length;
  return unresolvedCount > 0
    ? { status: "pending", unresolvedCount }
    : { status: "ready", unresolvedCount: 0 };
}
