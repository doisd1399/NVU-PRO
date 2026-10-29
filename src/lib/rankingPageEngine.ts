import { driverDisplayIdentity } from "./driverDisplayIdentity";
import { buildDriverRankingContext, RankingScope } from "./performanceEngine";
import { filterTripsBySimulator } from "./metricsEngine";
import type { NormalizedTrip } from "./tripNormalizer";
import {
  isAllSimulatorSelection,
  resolveSimulatorId,
} from "./resolveSimulator";
import { isRankingEligibleCompany } from "./rankingAggregates";

export interface RankingPageDriverItem {
  id: string;
  name: string;
  logo: string;
  trips: number;
  val: number;
  currency?: string;
  currencyBreakdown?: { currency: string; value: number; tripCount: number; missingValueTrips?: number; currencySource?: string; currencySources?: string[] }[];
  currencySourceCounts?: Record<string, number>;
  currencyUnresolvedTrips?: number;
  currencyTotals?: Record<string, number>;
  currencyTripCounts?: Record<string, number>;
  currencyMissingValueTrips?: number;
  companyId?: string;
  companyName?: string;
  companyLogo?: string;
}

export interface BuildDriverRankingPageDataParams {
  trips: NormalizedTrip[];
  startDate?: Date;
  endDate?: Date;
  scope: RankingScope;
  companyId?: string | null;
  simulatorId?: string;
  /** Set when the caller already applied the canonical simulator boundary. */
  tripsAlreadyFilteredBySimulator?: boolean;
  companies?: Record<string, unknown>[];
  simulators?: Record<string, unknown>[];
  users?: Record<string, unknown>[];
  companyMembers?: Record<string, unknown>[];
}

export interface BuildCanonicalDriverRankingContextParams extends BuildDriverRankingPageDataParams {
  driverId: string;
}

/**
 * Canonical context for the earnings-ordered driver ranking.
 * It applies the simulator filter once, then delegates ranking, position,
 * next competitor and financial gap to the same performance engine.
 */
export function buildCanonicalDriverRankingContext({
  trips,
  startDate,
  endDate,
  scope,
  companyId,
  simulatorId,
  tripsAlreadyFilteredBySimulator = false,
  companies = [],
  simulators = [],
  driverId,
}: BuildCanonicalDriverRankingContextParams) {
  if (scope === "internal" && !companyId) {
    return buildDriverRankingContext([], {
      scope,
      startDate: startDate || new Date(0),
      endDate: endDate || new Date(),
      driverId,
      companyId,
    });
  }

  const simulatorTrips = tripsAlreadyFilteredBySimulator
    ? trips
    : filterTripsBySimulator(trips, simulatorId, companies, simulators);
  const eligibleCompanyIds =
    scope === "global"
      ? companies
          .filter((company) => {
            if (!isRankingEligibleCompany(company)) return false;
            if (!simulatorId || isAllSimulatorSelection(simulatorId))
              return true;
            const selectedSimulatorId = resolveSimulatorId(
              { simulatorId },
              simulators,
              companies,
            );
            return (
              resolveSimulatorId(company, simulators, companies) ===
              selectedSimulatorId
            );
          })
          .map((company) => String(company.id || "").trim())
          .filter(Boolean)
      : undefined;
  return buildDriverRankingContext(simulatorTrips, {
    scope,
    startDate: startDate || new Date(0),
    endDate: endDate || new Date(),
    driverId,
    companyId,
    eligibleCompanyIds,
  });
}

function shortDriverName(value: unknown): string {
  const name = String(value || "Motorista Desconhecido").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).join(" ") || "Motorista Desconhecido";
}

/**
 * Produces the driver list shared by the ranking page and profile. This prevents the profile
 * card and the detailed ranking from calculating different totals, positions
 * or participants for the same simulator and period.
 */
export function buildDriverRankingPageData({
  trips,
  startDate,
  endDate,
  scope,
  companyId,
  simulatorId,
  tripsAlreadyFilteredBySimulator = false,
  companies = [],
  simulators = [],
  users = [],
  companyMembers = [],
}: BuildDriverRankingPageDataParams): RankingPageDriverItem[] {
  if (scope === "internal" && !companyId) return [];

  const readSimulatorText = (record: Record<string, unknown> | undefined, ...keys: string[]) => {
    for (const key of keys) {
      const value = record?.[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };
  const canonicalSimulatorId = simulatorId
    ? resolveSimulatorId({ simulatorId }, simulators, companies)
    : "";
  const simulatorCatalogEntry = simulators.find(
    (item) => readSimulatorText(item, "id") === canonicalSimulatorId,
  );
  const catalogSimulatorCode = readSimulatorText(
    simulatorCatalogEntry,
    "simulatorCode", "simuladorCodigo", "code", "slug", "key",
  );
  const catalogSimulatorName = readSimulatorText(
    simulatorCatalogEntry,
    "simulatorName", "simuladorNome", "name", "nome", "label", "title", "displayName",
  );
  const currencyAwareTrips = trips.map((trip) => {
    if (!canonicalSimulatorId || resolveSimulatorId(trip, simulators, companies) !== canonicalSimulatorId) return trip;
    return {
      ...trip,
      simulatorCode: readSimulatorText(trip, "simulatorCode", "simuladorCodigo") || catalogSimulatorCode || undefined,
      simulatorName: readSimulatorText(trip, "simulatorName", "simuladorNome", "simulator", "simulador") || catalogSimulatorName || undefined,
    };
  });

  const context = buildCanonicalDriverRankingContext({
    trips: currencyAwareTrips,
    startDate,
    endDate,
    scope,
    companyId,
    simulatorId,
    tripsAlreadyFilteredBySimulator,
    companies,
    simulators,
    // The ranking page needs the ordered population, not a specific driver's
    // position. A sentinel ID keeps the shared engine deterministic.
    driverId: "__ranking_page__",
  });

  const readText = (
    record: Record<string, unknown> | undefined,
    key: string,
  ) => {
    const value = record?.[key];
    return typeof value === "string" ? value : "";
  };

  const usersById = new Map(
    users
      .map((user) => [readText(user, "id"), user] as const)
      .filter(([id]) => Boolean(id)),
  );
  const companiesById = new Map(
    companies
      .map((company) => [readText(company, "id"), company] as const)
      .filter(([id]) => Boolean(id)),
  );
  const activeMembershipByUser = new Map<
    string,
    { companyId: string; joinedAt: number }
  >();
  companyMembers.forEach((membership) => {
    const userId = readText(membership, "userId");
    const membershipCompanyId = readText(membership, "companyId");
    const roles = Array.isArray(membership.roles)
      ? membership.roles.map((role) => String(role).toLowerCase())
      : [];
    const isDriver =
      roles.includes("driver") ||
      readText(membership, "role").toLowerCase() === "driver";
    if (
      !userId ||
      !membershipCompanyId ||
      readText(membership, "status").toLowerCase() !== "active" ||
      !isDriver ||
      !companiesById.has(membershipCompanyId) ||
      (scope === "internal" && membershipCompanyId !== companyId)
    ) {
      return;
    }
    const membershipCompany = companiesById.get(membershipCompanyId);
    if (
      canonicalSimulatorId &&
      !isAllSimulatorSelection(canonicalSimulatorId) &&
      resolveSimulatorId(membershipCompany, simulators, companies) !==
        canonicalSimulatorId
    ) {
      return;
    }

    const joinedAtValue = membership.joinedAt;
    const joinedAt =
      joinedAtValue instanceof Date
        ? joinedAtValue.getTime()
        : typeof (joinedAtValue as { toDate?: unknown })?.toDate === "function"
          ? (joinedAtValue as { toDate: () => Date }).toDate().getTime()
          : new Date(joinedAtValue as string | number).getTime() || 0;
    const current = activeMembershipByUser.get(userId);
    if (!current || joinedAt >= current.joinedAt) {
      activeMembershipByUser.set(userId, {
        companyId: membershipCompanyId,
        joinedAt,
      });
    }
  });

  return context.ranking.map((entry) => {
    const user = usersById.get(entry.id);
    const currentCompanyId =
      scope === "internal"
        ? companyId || entry.companyId
        : activeMembershipByUser.get(entry.id)?.companyId || entry.companyId;
    const company = currentCompanyId
      ? companiesById.get(currentCompanyId)
      : undefined;

    return {
      id: entry.id,
      // The user document is the canonical identity after approval. Trip
      // snapshots intentionally keep their historical motoristaNome for
      // auditability, but must not overwrite a newer approved profile name.
      name: shortDriverName(user ? driverDisplayIdentity(user).name : entry.name),
      logo: driverDisplayIdentity(user).profilePhotoURL,
      trips: entry.trips,
      val: entry.earnings,
      currency: entry.currency,
      currencyBreakdown: entry.currencyBreakdown,
      currencyUnresolvedTrips: entry.currencyUnresolvedTrips,
      currencyTotals: Object.fromEntries(
        (entry.currencyBreakdown || []).map((group) => [group.currency, group.value]),
      ),
      currencyTripCounts: Object.fromEntries(
        (entry.currencyBreakdown || []).map((group) => [group.currency, group.tripCount]),
      ),
      currencyMissingValueTrips: (entry.currencyBreakdown || []).reduce(
        (sum, group) => sum + group.missingValueTrips,
        0,
      ),
      companyId: currentCompanyId,
      companyName:
        readText(company, "companyName") || readText(company, "name"),
      companyLogo: readText(company, "logoUrl") || readText(company, "logoURL") || readText(company, "companyLogoURL"),
    };
  });
}

export function getActiveInternalDriverIds(
  companyMembers: Record<string, unknown>[],
  companyId: string,
): string[] {
  if (!companyId) return [];
  return Array.from(
    new Set(
      companyMembers
        .filter((member) => {
          const roles = Array.isArray(member.roles)
            ? member.roles.map((role) => String(role).toLowerCase())
            : [];
          return (
            String(member.companyId || "") === companyId &&
            String(member.status || "").toLowerCase() === "active" &&
            (roles.includes("driver") ||
              String(member.role || "").toLowerCase() === "driver")
          );
        })
        .map((member) => String(member.userId || "").trim())
        .filter(Boolean),
    ),
  ).sort();
}

/** Include active colleagues with zero trips using the same population on both screens. */
export function buildInternalDriverRankingPageData(
  params: Omit<BuildDriverRankingPageDataParams, "scope">,
): RankingPageDriverItem[] {
  const companyId = params.companyId || "";
  if (!companyId) return [];
  const selectedCompany = (params.companies || []).find(
    (company) => String(company.id || "") === companyId,
  );
  if (!isRankingEligibleCompany(selectedCompany)) return [];
  const ranking = buildDriverRankingPageData({ ...params, scope: "internal" });
  const existingIds = new Set(ranking.map((entry) => entry.id));
  const usersById = new Map(
    (params.users || []).map((user) => [String(user.id || ""), user]),
  );
  const company = (params.companies || []).find(
    (item) => String(item.id || "") === companyId,
  );
  const zeroActivityDrivers = getActiveInternalDriverIds(
    params.companyMembers || [],
    companyId,
  )
    .filter((id) => !existingIds.has(id))
    .map((id) => {
      const user = usersById.get(id);
      return {
        id,
        name: shortDriverName(driverDisplayIdentity(user).name),
        logo: driverDisplayIdentity(user).profilePhotoURL,
        trips: 0,
        val: 0,
        companyId,
        companyName: String(company?.companyName || company?.name || ""),
      };
    });
  return [...ranking, ...zeroActivityDrivers].sort((left, right) => {
    if (right.val !== left.val) return right.val - left.val;
    if (right.trips !== left.trips) return right.trips - left.trips;
    const nameOrder = left.name.localeCompare(right.name, "pt-BR", {
      sensitivity: "base",
      numeric: true,
    });
    return nameOrder || left.id.localeCompare(right.id);
  });
}
