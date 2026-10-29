import {
  getCanonicalTripCompanyId,
  getCanonicalTripDriverId,
} from "./tripIdentity";

/** The local repository may contain records from several authorized scopes. */
export function tripMatchesReadScope(
  trip: unknown,
  scope: { driverId?: string; companyId?: string; companyIds?: string[] },
): boolean {
  const driverId = String(scope.driverId || "").trim();
  const companyIds = new Set(
    [scope.companyId, ...(scope.companyIds || [])]
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  );
  if (!driverId && companyIds.size === 0) return false;
  if (driverId && getCanonicalTripDriverId(trip) !== driverId) return false;
  return (
    companyIds.size === 0 ||
    companyIds.has(getCanonicalTripCompanyId(trip) || "")
  );
}
