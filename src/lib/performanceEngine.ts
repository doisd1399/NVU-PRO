import {
  getTripMetricDate,
  normalizeTrip,
} from "./tripNormalizer";
import { summarizeTripMoney } from "./tripMoneySummary";
import {
  getCanonicalTripCompanyId,
  getCanonicalTripDriverId,
  getCanonicalTripDriverName,
} from "./tripIdentity";

export type RankingScope = "internal" | "global";

export interface DriverRankingQuery {
  scope: RankingScope;
  startDate: Date;
  endDate: Date;
  driverId: string;
  companyId?: string | null;
  eligibleCompanyIds?: string[];
}

export interface DriverRankingEntry {
  id: string;
  name?: string;
  companyId?: string;
  trips: number;
  earnings: number;
  currency?: string;
  currencyBreakdown?: { currency: string; value: number; tripCount: number; missingValueTrips: number; currencySource?: string; currencySources?: string[] }[];
  currencyUnresolvedTrips?: number;
}

export interface DriverRankingContextResult {
  scope: RankingScope;
  ranking: DriverRankingEntry[];
  position: number | null;
  totalParticipants: number;
  differenceToNext: number;
  nextCompetitor: DriverRankingEntry | null;
  current: DriverRankingEntry;
  entityTrips: any[];
  periodTrips: any[];
}

function tripDate(trip: any): Date {
  return getTripMetricDate(trip);
}

function driverIdOf(trip: any): string | undefined {
  return getCanonicalTripDriverId(trip);
}

function companyIdOf(trip: any): string | undefined {
  return getCanonicalTripCompanyId(trip);
}

function driverNameOf(trip: any): string | undefined {
  return getCanonicalTripDriverName(trip);
}

/**
 * Earnings determine the ranking; trip count retains the existing tie policy.
 * No composite operational score participates in this financial comparison.
 */
export function buildDriverRankingContext(
  trips: any[],
  query: DriverRankingQuery,
): DriverRankingContextResult {
  const start = query.startDate.getTime();
  const end = query.endDate.getTime();

  const periodTrips = trips
    .map((trip) =>
      typeof trip?.isValid === "boolean" && trip?.metricDate instanceof Date
        ? trip
        : normalizeTrip(trip),
    )
    .filter((trip) => {
      if (!trip.isValid) return false;
      const time = tripDate(trip).getTime();
      return Number.isFinite(time) && time >= start && time <= end;
    })
    .sort((left, right) => {
      const dateOrder = tripDate(left).getTime() - tripDate(right).getTime();
      if (dateOrder !== 0) return dateOrder;
      return String(left?.id || "").localeCompare(String(right?.id || ""));
    });

  // Internal rankings are company-scoped in both participation and totals.
  // A driver who worked for more than one company in the same simulator must
  // never carry earnings from another company into the selected fleet.
  const eligibleCompanyIds = query.eligibleCompanyIds
    ? new Set(
        query.eligibleCompanyIds
          .map((id) => String(id || "").trim())
          .filter(Boolean),
      )
    : null;
  const scopedPeriodTrips = periodTrips.filter((trip) => {
    const companyId = companyIdOf(trip);
    if (query.scope === "internal" && query.companyId) {
      return companyId === query.companyId;
    }
    return !eligibleCompanyIds || eligibleCompanyIds.has(companyId || "");
  });

  const canonicalStats = new Map<string, DriverRankingEntry>();
  const tripsByDriver = new Map<string, any[]>();
  for (const trip of scopedPeriodTrips) {
    const id = driverIdOf(trip);
    if (!id) continue;
    const current = canonicalStats.get(id) || {
      id,
      name: driverNameOf(trip),
      companyId: companyIdOf(trip),
      trips: 0,
      earnings: 0,
    };
    if (!current.name) current.name = driverNameOf(trip);
    if (query.scope === "global") {
      current.companyId = companyIdOf(trip) || current.companyId;
    } else if (!current.companyId) {
      current.companyId = companyIdOf(trip);
    }
    current.trips += 1;
    const driverTrips = tripsByDriver.get(id) || [];
    driverTrips.push(trip);
    tripsByDriver.set(id, driverTrips);
    canonicalStats.set(id, current);
  }

  const overallMoneyGroups = summarizeTripMoney(scopedPeriodTrips);
  const overallKnown = overallMoneyGroups.filter((group) => group.currencyStatus === "known");
  const overallUnresolved = overallMoneyGroups.some((group) => group.currencyStatus !== "known");
  const overallMissingValues = overallKnown.some((group) => group.missingValueTrips > 0);
  const comparableCurrency = overallKnown.length === 1 && !overallUnresolved && !overallMissingValues
    ? overallKnown[0]?.currency : undefined;

  const eligibleDriverIds = new Set<string>();
  canonicalStats.forEach((_entry, id) => eligibleDriverIds.add(id));

  const ranking = Array.from(eligibleDriverIds)
    .map((id) => canonicalStats.get(id))
    .filter((entry): entry is DriverRankingEntry => Boolean(entry))
    .map((entry) => {
      const groups = summarizeTripMoney(tripsByDriver.get(entry.id) || []);
      const known = groups.filter((group) => group.currencyStatus === "known" && group.currency);
      const unresolvedTrips = groups.filter((group) => group.currencyStatus !== "known")
        .reduce((sum, group) => sum + group.tripCount, 0);
      const currencyBreakdown = known.map((group) => ({
        currency: group.currency!, value: group.value ?? 0, tripCount: group.tripCount,
        missingValueTrips: group.missingValueTrips, currencySource: group.currencySource,
        currencySources: group.currencySources,
      }));
      return {
        ...entry,
        earnings: comparableCurrency ? known.find((group) => group.currency === comparableCurrency)?.value ?? 0 : 0,
        currency: comparableCurrency,
        currencyBreakdown,
        currencyUnresolvedTrips: unresolvedTrips,
      };
    })
    .sort((a, b) => {
      if (comparableCurrency && b.earnings !== a.earnings) return b.earnings - a.earnings;
      if (b.trips !== a.trips) return b.trips - a.trips;
      const nameOrder = String(a.name || "").localeCompare(
        String(b.name || ""),
        "pt-BR",
        { sensitivity: "base", numeric: true },
      );
      return nameOrder || a.id.localeCompare(b.id);
    });

  const index = ranking.findIndex((entry) => entry.id === query.driverId);
  const current = canonicalStats.get(query.driverId) || {
    id: query.driverId,
    companyId: query.companyId || undefined,
    trips: 0,
    earnings: 0,
    currencyBreakdown: [],
    currencyUnresolvedTrips: 0,
  };
  const hasActivity = current.trips > 0;
  const position = hasActivity && index >= 0 ? index + 1 : null;
  const nextCompetitor = hasActivity && index > 0 ? ranking[index - 1] : null;
  const differenceToNext = nextCompetitor
    ? Math.max(0, nextCompetitor.earnings - current.earnings)
    : 0;

  return {
    scope: query.scope,
    ranking,
    position,
    totalParticipants: ranking.length,
    differenceToNext,
    nextCompetitor,
    current,
    entityTrips: scopedPeriodTrips.filter(
      (trip) => driverIdOf(trip) === query.driverId,
    ),
    periodTrips: scopedPeriodTrips,
  };
}
