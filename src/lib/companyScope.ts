export interface OperationalCompanyScopeInput {
  activeCompanyId?: string | null;
  currentUserCompanyId?: string | null;
  seniorCompanyId?: string | null;
  seniorAccess?: boolean;
}

function cleanId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The company explicitly selected in the UI is authoritative. Senior context
 * is only a fallback when no active company has been selected yet.
 */
export function resolveOperationalCompanyId({
  activeCompanyId,
  currentUserCompanyId,
  seniorCompanyId,
  seniorAccess = false,
}: OperationalCompanyScopeInput): string | null {
  return (
    cleanId(activeCompanyId) ||
    (seniorAccess ? cleanId(seniorCompanyId) : null) ||
    cleanId(currentUserCompanyId)
  );
}

export interface ViewedDriverCompanyScopeInput {
  routeCompanyId?: string | null;
  activeJobCompanyId?: string | null;
  latestTripCompanyId?: string | null;
  activeMembershipCompanyId?: string | null;
  userCompanyId?: string | null;
  historicalMembershipCompanyId?: string | null;
  fallbackActiveCompanyId?: string | null;
}

/**
 * Resolves the company whose driver profile is being inspected. Explicit route
 * context wins, followed by operational evidence (job/trip), then profile data.
 */
export function resolveViewedDriverCompanyId({
  routeCompanyId,
  activeJobCompanyId,
  latestTripCompanyId,
  activeMembershipCompanyId,
  userCompanyId,
  historicalMembershipCompanyId,
  fallbackActiveCompanyId,
}: ViewedDriverCompanyScopeInput): string | null {
  return (
    cleanId(routeCompanyId) ||
    cleanId(activeJobCompanyId) ||
    cleanId(latestTripCompanyId) ||
    cleanId(activeMembershipCompanyId) ||
    cleanId(userCompanyId) ||
    cleanId(historicalMembershipCompanyId) ||
    cleanId(fallbackActiveCompanyId)
  );
}

export function getTripCompanyId(trip: any): string | null {
  return cleanId(trip?.empresaId || trip?.companyId || trip?.company_id);
}

export function getTripDriverId(trip: any): string | null {
  return cleanId(trip?.motoristaId || trip?.driverId);
}

export function getTripTimestamp(trip: any): number {
  const raw =
    trip?.metricDate ||
    trip?.completedAt?.toDate?.() ||
    trip?.completedAt ||
    trip?.dataFechamento ||
    trip?.date ||
    trip?.dataLancamento ||
    trip?.createdAt;
  if (raw instanceof Date) return raw.getTime();
  if (raw?.toDate) return raw.toDate().getTime();
  if (raw?.seconds) return raw.seconds * 1000;
  const parsed = new Date(raw || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface MergeCompanyTripsForRankingInput {
  globalTrips?: any[];
  companyTrips?: any[];
  companyId?: string | null;
}

/**
 * Builds the canonical company trip set used by driver performance rankings.
 *
 * The company listener historically queries only `empresaId`, while legacy
 * documents may store the same relationship as `companyId` or `company_id`.
 * The all-trips stream sees every schema variant. Merging both sources here
 * prevents the same driver from having different earnings in Internal and
 * Global when the immediate next competitor is actually the same person.
 */
export function mergeCompanyTripsForRanking({
  globalTrips = [],
  companyTrips = [],
  companyId,
}: MergeCompanyTripsForRankingInput): any[] {
  const normalizedCompanyId = cleanId(companyId);
  if (!normalizedCompanyId) return [];

  const merged = new Map<string, any>();
  const addTrip = (trip: any) => {
    if (getTripCompanyId(trip) !== normalizedCompanyId) return;
    const key = String(
      trip?.id ||
        `${getTripDriverId(trip) || "unknown"}-${getTripTimestamp(trip)}-${
          trip?.normalizedValor ?? trip?.valor ?? 0
        }`,
    );
    if (!merged.has(key)) merged.set(key, trip);
  };

  // Prefer the canonical global document when both listeners contain it.
  globalTrips.forEach(addTrip);
  companyTrips.forEach(addTrip);
  return Array.from(merged.values());
}
