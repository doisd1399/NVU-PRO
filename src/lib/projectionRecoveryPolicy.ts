export type ProjectionStatusLike = {
  projectionActive?: boolean;
  projectionStatus?: string;
  projectionReauthRequired?: boolean;
  projectionPermissionInFlight?: boolean;
};

const REAUTH_STATUSES = new Set([
  "NOT_GRANTED",
  "DENIED",
  "REAUTH_REQUIRED_AFTER_RESTART",
  "REAUTH_REQUIRED_AFTER_SERVICE_RESTART",
  "REAUTH_REQUIRED_AFTER_STALL",
  "REAUTH_REQUIRED_ON_RETURN",
  "CONSENT_RESULT_TIMEOUT",
  "CONSENT_RESULT_LOST_AFTER_GTO_RETURN",
]);

export function needsProjectionRearm(status: ProjectionStatusLike): boolean {
  if (status.projectionActive) return false;
  if (status.projectionPermissionInFlight) return false;
  return Boolean(status.projectionReauthRequired) || REAUTH_STATUSES.has(String(status.projectionStatus || "").trim().toUpperCase());
}
