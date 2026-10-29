const failureCodes = new Set([
  "permission-denied", "unauthenticated", "unavailable", "deadline-exceeded",
  "resource-exhausted", "failed-precondition", "cancelled", "internal",
  "OFFLINE_STORAGE_WRITE_FAILED", "OFFLINE_STORAGE_READ_FAILED", "OFFLINE_STORAGE_DATA_CORRUPT",
  "OFFLINE_STORAGE_UNAVAILABLE", "CANONICAL_TRIP_SNAPSHOT_PARTIAL",
  "CANONICAL_TRIP_AUTH_SCOPE_CHANGED", "CANONICAL_TRIP_DRIVER_SCOPE_MISMATCH",
  "CANONICAL_TRIP_READ_SCOPE_REQUIRED",
]);

/** Only fixed codes are displayable; messages may contain private paths/data. */
export function historyReadFailureCode(error: unknown): string {
  const value = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  for (const candidate of [value.code, value.message]) {
    const code = String(candidate || "").replace(/^firestore\//, "");
    if (failureCodes.has(code)) return code;
  }
  return "UNKNOWN_READ_FAILURE";
}
