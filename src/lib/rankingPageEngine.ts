import { buildDriverRankingContext, RankingScope } from "./performanceEngine";
import { filterTripsBySimulator } from "./metricsEngine";
import type { NormalizedTrip } from "./tripNormalizer";
import {
  isAllSimulatorSelection,
  resolveSimulatorId,
} from "./resolveSimulator";

export interface RankingPageDriverItem {
  id: string;
  name: string;
  logo: string;
  trips: number;
  val: number;
  companyId?: string;
  companyName?: string;
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

export interface BuildCanonicalDriverRankingContextParams
  extends BuildDriverRankingPageDataParams {
  driverId: string;
}

/**
 * Canonical context shared by the detailed ranking page and driver profile.
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
  return buildDriverRankingContext(simulatorTrips, {
    scope,
    startDate: startDate || new Date(0),
    endDate: endDate || new Date(),
    driverId,
    companyId,
  });
}

function shortDriverName(value: unknown): string {
  const name = String(value || "Motorista Desconhecido").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).join(" ") || "Motorista Desconhecido";
}

/**
 * Produces the driver list shown on the ranking page from the exact same
 * canonical engine used by DriverPerformanceCard. This prevents the profile
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

  const context = buildCanonicalDriverRankingContext({
    trips,
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

  const readText = (record: Record<string, unknown> | undefined, key: string) => {
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
  const canonicalSimulatorId = simulatorId
    ? resolveSimulatorId({ simulatorId }, simulators, companies)
    : "";
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
      name: shortDriverName(readText(user, "name") || entry.name),
      logo:
        readText(user, "profilePhotoURL") ||
        readText(user, "photoURL") ||
        readText(user, "photoUrl") ||
        readText(user, "avatar") ||
        readText(user, "profileImage") ||
        readText(user, "imageUrl") ||
        readText(user, "photo"),
      trips: entry.trips,
      val: entry.earnings,
      companyId: currentCompanyId,
      companyName:
        readText(company, "companyName") || readText(company, "name"),
    };
  });
}
