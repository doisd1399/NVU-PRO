import {
  hasSimulatorIdentity,
  isAllSimulatorSelection,
  resolveSimulatorId,
} from "./resolveSimulator";
import { NormalizedTrip, normalizeTrip } from "./tripNormalizer";
import {
  getRankingUtcMonthlyRange,
  getRankingUtcStartOfDay,
  getRankingUtcWeeklyRange,
} from "./rankingPeriods";
import {
  getCanonicalTripCompanyId,
  getCanonicalTripDriverId,
  getCanonicalTripDriverName,
} from "./tripIdentity";
import { isRankingEligibleCompany } from "./rankingAggregates";
import { parseTripMoneyRecord } from "./tripNormalizer";
import { summarizeTripMoney, type HistoryMoneyGroup } from "./tripMoneySummary";

export { normalizeTrip };

type EntityRecord = Record<string, unknown>;

type RankingMoneyAccumulator = {
  totals: Record<string, { value: number; tripCount: number; missingValueTrips: number; currencySourceCounts: Record<string, number> }>;
  unresolvedTrips: Record<string, number>;
  unresolvedSources: Record<string, number>;
};

function emptyRankingMoney(): RankingMoneyAccumulator {
  return { totals: {}, unresolvedTrips: {}, unresolvedSources: {} };
}

function addRankingTripMoney(accumulator: RankingMoneyAccumulator, trip: NormalizedTrip) {
  const money = parseTripMoneyRecord(trip);
  if (money.currencyStatus !== "known" || !money.currency) {
    const status = money.currencyStatus || "unknown";
    accumulator.unresolvedTrips[status] = (accumulator.unresolvedTrips[status] || 0) + 1;
    const source = money.currencySource || "UNKNOWN";
    accumulator.unresolvedSources[source] = (accumulator.unresolvedSources[source] || 0) + 1;
    return;
  }
  const total = accumulator.totals[money.currency] || { value: 0, tripCount: 0, missingValueTrips: 0, currencySourceCounts: {} };
  total.tripCount += 1;
  const source = money.currencySource || "UNKNOWN";
  total.currencySourceCounts[source] = (total.currencySourceCounts[source] || 0) + 1;
  if (money.amountCents === null) total.missingValueTrips += 1;
  else total.value += money.amount;
  accumulator.totals[money.currency] = total;
}

function finalizeRankingMoney<T extends { trips: number; name: string; id: string; _money: RankingMoneyAccumulator }>(items: T[]) {
  const currencies = new Set(items.flatMap((item) => Object.keys(item._money.totals)));
  const unresolvedTrips = items.reduce((sum, item) => sum + Object.values(item._money.unresolvedTrips).reduce((a, b) => a + b, 0), 0);
  const missingValueTrips = items.reduce((sum, item) => sum + Object.values(item._money.totals).reduce((a, total) => a + total.missingValueTrips, 0), 0);
  const comparableCurrency = currencies.size === 1 && unresolvedTrips === 0 && missingValueTrips === 0 ? [...currencies][0] : undefined;
  return items.map((item) => {
    const currencyBreakdown = Object.entries(item._money.totals).map(([currency, total]) => ({ currency, ...total }));
    const currencyUnresolvedTrips = Object.values(item._money.unresolvedTrips).reduce((sum, count) => sum + count, 0);
    const rankValue = comparableCurrency ? item._money.totals[comparableCurrency]?.value || 0 : 0;
    const { _money, ...rest } = item;
    return { ...rest, val: rankValue, currency: comparableCurrency, currencyBreakdown, currencyUnresolvedTrips, currencyUnresolvedSources: item._money.unresolvedSources };
  }).sort((a, b) => {
    if (comparableCurrency && b.val !== a.val) return b.val - a.val;
    if (b.trips !== a.trips) return b.trips - a.trips;
    const nameOrder = a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base", numeric: true });
    return nameOrder || a.id.localeCompare(b.id);
  });
}

export function safeSingleCurrencyRevenue(groups: HistoryMoneyGroup[]) {
  const known = groups.filter((group) => group.currencyStatus === "known");
  const unresolved = groups.some((group) => group.currencyStatus !== "known");
  return known.length === 1 && !unresolved && known[0]?.value !== null ? known[0].value : 0;
}

const readEntityText = (record: EntityRecord | undefined, key: string): string => {
  const value = record?.[key];
  return typeof value === "string" ? value : "";
};

const entityHasDriverRole = (record: EntityRecord): boolean => {
  const roles = record.roles;
  return (Array.isArray(roles) && roles.includes("driver")) || record.role === "driver";
};

export function getTodayRange(referenceDate = new Date()) {
  const start = getRankingUtcStartOfDay(referenceDate);
  return {
    start,
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1),
  };
}

export function getWeeklyRange(referenceDate = new Date()) {
  return getRankingUtcWeeklyRange(referenceDate);
}

export function getMonthlyRange(referenceDate = new Date()) {
  return getRankingUtcMonthlyRange(referenceDate);
}

export function normalizeDate(date: string | Date | number) {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    // Date-only values represent a business calendar day, not UTC midnight.
    // Align them with the same São Paulo boundary used by ranking ranges.
    return getRankingUtcStartOfDay(date.trim());
  }
  return new Date(date);
}

function getTripCompany(trip: NormalizedTrip | Record<string, unknown>, companies: Record<string, unknown>[]) {
  const tripCompanyId = getCanonicalTripCompanyId(trip);
  if (!tripCompanyId) return undefined;
  return companies.find((company) => String(company?.id) === String(tripCompanyId));
}

export function applySimulatorCurrencyContext(
  trip: NormalizedTrip,
  companies: Record<string, unknown>[],
  simulators: Record<string, unknown>[],
): NormalizedTrip {
  const simulatorId = getTripSimulatorId(trip, companies, simulators);
  if (!simulatorId) return trip;
  const simulator = simulators.find((item) => String(item?.id || "") === simulatorId);
  const company = getTripCompany(trip, companies);
  const contextAliases = [
    readEntityText(simulator, "code"), readEntityText(simulator, "slug"), readEntityText(simulator, "key"),
    readEntityText(simulator, "name"), readEntityText(simulator, "label"), readEntityText(simulator, "title"),
    readEntityText(company, "simulatorCode"), readEntityText(company, "simuladorCodigo"),
    readEntityText(company, "simulatorName"), readEntityText(company, "simuladorNome"),
    readEntityText(company, "simulatorKey"), readEntityText(company, "simuladorKey"), simulatorId,
  ].filter(Boolean);
  if (!contextAliases.length) return trip;

  const currencyRecord: Record<string, unknown> = { ...trip };
  const simulatorFields = ["simulatorCode", "simulatorName", "simulatorKey", "simulator", "simulatorId", "simuladorCodigo", "simuladorNome", "simuladorKey", "simulador", "simuladorId", "gameCode", "packageId"];
  contextAliases.forEach((alias) => {
    const emptyField = simulatorFields.find((field) => !String(currencyRecord[field] ?? "").trim());
    if (emptyField) currencyRecord[emptyField] = alias;
  });
  const money = parseTripMoneyRecord(currencyRecord);
  return {
    ...trip,
    normalizedCurrency: money.currency,
    currencyStatus: money.currencyStatus,
    currencySource: money.currencySource,
    ...Object.fromEntries(simulatorFields.filter((field) => currencyRecord[field] !== undefined).map((field) => [field, currencyRecord[field]])),
  };
}

export function getTripSimulatorId(
  trip: NormalizedTrip | Record<string, unknown>,
  companies: Record<string, unknown>[] = [],
  simulators: Record<string, unknown>[] = [],
) {
  const tripRecord = trip as Record<string, unknown>;
  const company = getTripCompany(tripRecord, companies);

  // Ranking scope follows the company's current canonical simulator. A trip
  // snapshot is only a compatibility fallback when the company is unavailable
  // or has no simulator identity.
  if (company && hasSimulatorIdentity(company)) {
    return resolveSimulatorId(company, simulators, companies);
  }
  return hasSimulatorIdentity(tripRecord)
    ? resolveSimulatorId(tripRecord, simulators, companies)
    : "";
}

function createTripSimulatorMatcher(
  simulatorId: string | undefined,
  companies: Record<string, unknown>[],
  simulators: Record<string, unknown>[],
) {
  if (!simulatorId || isAllSimulatorSelection(simulatorId)) {
    return (_trip: NormalizedTrip) => true;
  }

  const canonicalTargetId = resolveSimulatorId(
    { simulatorId },
    simulators,
    companies,
  );
  if (!canonicalTargetId) return (_trip: NormalizedTrip) => false;

  // Most trips inherit their simulator from the company. Resolve each company
  // once per filter instead of searching and reconciling the same catalog for
  // every trip in the period.
  const companiesById = new Map(
    companies
      .map((company) => [String(company?.id || ""), company] as const)
      .filter(([id]) => Boolean(id)),
  );
  const companySimulatorIds = new Map<string, string>();

  return (trip: NormalizedTrip) => {
    const tripRecord = trip as Record<string, unknown>;
    const companyId = getCanonicalTripCompanyId(tripRecord);

    if (companyId) {
      let resolvedCompanySimulatorId = companySimulatorIds.get(companyId);
      if (resolvedCompanySimulatorId === undefined) {
        const company = companiesById.get(companyId);
        resolvedCompanySimulatorId = company
          ? resolveSimulatorId(company, simulators, companies)
          : "";
        companySimulatorIds.set(companyId, resolvedCompanySimulatorId);
      }
      if (resolvedCompanySimulatorId) {
        return resolvedCompanySimulatorId === canonicalTargetId;
      }
    }

    return hasSimulatorIdentity(tripRecord)
      ? resolveSimulatorId(tripRecord, simulators, companies) === canonicalTargetId
      : false;
  };
}

export function filterTripsBySimulator(
  trips: NormalizedTrip[],
  simulatorId?: string,
  companies: Record<string, unknown>[] = [],
  simulators: Record<string, unknown>[] = [],
) {
  // Undefined remains a generic no-filter mode for shared metric helpers. The
  // explicit cross-simulator UI option is still represented only by `all`.
  if (!simulatorId || isAllSimulatorSelection(simulatorId)) return trips;

  const matchesSimulator = createTripSimulatorMatcher(
    simulatorId,
    companies,
    simulators,
  );
  return trips.filter(matchesSimulator).map((trip) => applySimulatorCurrencyContext(trip, companies, simulators));
}

export function getFilteredTrips(
  trips: NormalizedTrip[],
  startDate?: Date,
  endDate?: Date,
  empresaId?: string,
  simulatorId?: string,
  companies?: EntityRecord[], // Needed for simulator filtering
  motorista?: string, // Motorista name or ID filter
  simulators?: Record<string, unknown>[],
) {
  const matchesSimulator = createTripSimulatorMatcher(
    simulatorId,
    companies || [],
    simulators || [],
  );

  return trips.filter((trip) => {
    if (!trip.isValid) return false;

    const completed = normalizeDate(trip.metricDate || trip.completedAt);

    if (startDate && completed < startDate) return false;
    if (endDate && completed > endDate) return false;

    const tripCompanyId = getCanonicalTripCompanyId(trip);
    if (empresaId && tripCompanyId !== empresaId) return false;

    if (!matchesSimulator(trip)) {
      return false;
    }

    if (motorista && motorista !== "Todos os Motoristas" && motorista !== "all") {
       if (
         getCanonicalTripDriverName(trip)?.toLowerCase() !== motorista.toLowerCase() &&
         getCanonicalTripDriverId(trip) !== motorista
       ) {
         return false;
       }
    }

    return true;
  }).map((trip) => applySimulatorCurrencyContext(trip, companies || [], simulators || []));
}

export function calculateWeeklyMetrics(
  trips: NormalizedTrip[],
  startDate?: Date,
  endDate?: Date,
  empresaId?: string,
  simulatorId?: string,
  companies?: EntityRecord[],
  motorista?: string,
  simulators?: EntityRecord[],
) {
  const filteredTrips = getFilteredTrips(
    trips,
    startDate,
    endDate,
    empresaId,
    simulatorId,
    companies,
    motorista,
    simulators,
  );

  const tripsCount = filteredTrips.length;
  const moneyGroups = summarizeTripMoney(filteredTrips);
  const totalRevenue = safeSingleCurrencyRevenue(moneyGroups);

  return {
    tripsCount,
    totalRevenue,
    moneyGroups,
    filteredTrips,
  };
}

/**
 * Returns the drivers that must participate in a company ranking for a
 * period. The population is intentionally the union of:
 *   1. drivers who are active members now; and
 *   2. every driver with at least one valid trip in the selected period.
 *
 * This keeps a driver who left the company during the period in historical
 * weekly/monthly rankings, while still showing currently active drivers with
 * zero trips.
 */
export function getDriverIdsForPeriod(
  trips: NormalizedTrip[],
  startDate?: Date,
  endDate?: Date,
  empresaId?: string,
  currentMembers: EntityRecord[] = [],
) {
  const driverIds = new Set<string>();

  currentMembers.forEach((member) => {
    const userId = readEntityText(member, "userId");
    const companyId = readEntityText(member, "companyId");
    if (
      userId &&
      member.status === "active" &&
      entityHasDriverRole(member) &&
      (!empresaId || companyId === empresaId)
    ) {
      driverIds.add(userId);
    }
  });

  trips.forEach((trip) => {
    if (!trip.isValid) return;
    if (startDate && trip.metricDate < startDate) return;
    if (endDate && trip.metricDate > endDate) return;
    const tripCompanyId = getCanonicalTripCompanyId(trip);
    if (empresaId && tripCompanyId !== empresaId) {
      return;
    }

    const driverId = getCanonicalTripDriverId(trip);
    if (driverId) driverIds.add(driverId);
  });

  return driverIds;
}

/**
 * Returns the companies that may participate in a company ranking.
 *
 * A trip is historical evidence, not proof that its company still exists.
 * Hard-deleted companies therefore keep their trips for audit/history, but
 * those trips can no longer recreate an "Empresa Desconhecida" in rankings.
 * `currentCompanies` defines the zero-trip population for the selected
 * simulator, while `existingCompanies` validates historical trip references.
 * A future archive policy can be added here without changing trip history.
 */
export function getCompanyIdsForPeriod(
  trips: NormalizedTrip[],
  startDate?: Date,
  endDate?: Date,
  currentCompanies: EntityRecord[] = [],
  existingCompanies: EntityRecord[] = currentCompanies,
) {
  const companyIds = new Set<string>();
  const existingCompanyIds = new Set(
    existingCompanies
      .map((company) => readEntityText(company, "id"))
      .filter(Boolean),
  );

  currentCompanies.forEach((company) => {
    const companyId = readEntityText(company, "id");
    if (companyId && existingCompanyIds.has(companyId)) {
      companyIds.add(companyId);
    }
  });

  trips.forEach((trip) => {
    if (!trip.isValid) return;
    if (startDate && trip.metricDate < startDate) return;
    if (endDate && trip.metricDate > endDate) return;

    const companyId = getCanonicalTripCompanyId(trip);
    if (companyId && existingCompanyIds.has(companyId)) {
      companyIds.add(companyId);
    }
  });

  return companyIds;
}

export function groupMetricsByCompany(
  trips: NormalizedTrip[],
  startDate?: Date,
  endDate?: Date,
  simulatorId?: string,
  companies?: EntityRecord[],
  simulators?: EntityRecord[],
) {
  const filteredTrips = getFilteredTrips(
    trips,
    startDate,
    endDate,
    undefined,
    simulatorId,
    companies,
    undefined,
    simulators,
  );
  const stats: Record<string, { id: string; name: string; logo: string; trips: number; _money: RankingMoneyAccumulator }> = {};

  const existingCompanies = companies || [];
  const companiesById = new Map(
    existingCompanies
      .map((company) => [readEntityText(company, "id"), company] as const)
      .filter(([id]) => Boolean(id)),
  );
  const canonicalTargetId = simulatorId
    ? resolveSimulatorId({ simulatorId }, simulators || [], existingCompanies)
    : "";
  const eligibleCompanyIds = new Set(
    existingCompanies
      .filter((company) => {
        if (!isRankingEligibleCompany(company)) return false;
        if (!simulatorId || isAllSimulatorSelection(simulatorId)) return true;
        return resolveSimulatorId(company, simulators || [], existingCompanies) === canonicalTargetId;
      })
      .map((company) => readEntityText(company, "id"))
      .filter(Boolean),
  );

  eligibleCompanyIds.forEach((companyId) => {
    const comp = companiesById.get(companyId);
    if (!comp) return;
    stats[companyId] = {
      id: companyId,
      name:
        readEntityText(comp, "companyName") ||
        readEntityText(comp, "name") ||
        "Empresa Desconhecida",
      logo:
        readEntityText(comp, "logoUrl") ||
        readEntityText(comp, "logoURL") ||
        readEntityText(comp, "logo"),
      trips: 0,
      _money: emptyRankingMoney(),
    };
  });

  filteredTrips.forEach((trip) => {
    const cId = getCanonicalTripCompanyId(trip);
    if (!cId) return;

    const comp = companiesById.get(cId);
    // Trips from a hard-deleted company stay stored, but are not ranking data.
    if (!comp || !eligibleCompanyIds.has(cId)) return;

    if (!stats[cId].name && trip.empresaNome) stats[cId].name = trip.empresaNome;
    stats[cId].trips += 1;
    addRankingTripMoney(stats[cId]._money, trip);
  });

  return finalizeRankingMoney(Object.values(stats));
}

export function groupMetricsByDriver(
  trips: NormalizedTrip[],
  startDate?: Date,
  endDate?: Date,
  empresaId?: string,
  users?: EntityRecord[],
  simulatorId?: string,
  companies?: EntityRecord[],
  companyDrivers?: EntityRecord[],
  simulators?: EntityRecord[],
) {
  const filteredTrips = getFilteredTrips(
    trips,
    startDate,
    endDate,
    empresaId,
    simulatorId,
    companies,
    undefined,
    simulators,
  );
  const stats: Record<string, { id: string; name: string; logo: string; trips: number; _money: RankingMoneyAccumulator }> = {};
  
  // Preload company drivers (Internal Ranking Dynamic)
  if (companyDrivers && companyDrivers.length > 0) {
    companyDrivers.forEach((member) => {
      const userId = readEntityText(member, "userId");
      if (userId && member.status === "active" && entityHasDriverRole(member)) {
        const user = users?.find(
          (candidate) => readEntityText(candidate, "id") === userId,
        );
        let driverName = readEntityText(user, "name") || "Motorista Desconhecido";
        if (driverName) {
          const parts = driverName.trim().split(" ");
          if (parts.length > 1) {
            driverName = `${parts[0]} ${parts[1]}`;
          } else {
            driverName = parts[0];
          }
        }
        stats[userId] = {
          id: userId,
          name: driverName,
          logo: readEntityText(user, "profilePhotoURL"),
          trips: 0,
          _money: emptyRankingMoney()
        };
      }
    });
  }

  filteredTrips.forEach((trip) => {
    const mId = getCanonicalTripDriverId(trip);
    if (!mId) return;

    if (!stats[mId]) {
      const user = users?.find((candidate) => readEntityText(candidate, "id") === mId);
      
      let driverName =
        getCanonicalTripDriverName(trip) ||
        readEntityText(user, "name") ||
        "Motorista Desconhecido";
      if (driverName) {
        const parts = driverName.trim().split(" ");
        if (parts.length > 1) {
          driverName = `${parts[0]} ${parts[1]}`;
        } else {
          driverName = parts[0];
        }
      }

      stats[mId] = {
        id: mId,
        name: driverName,
        logo: readEntityText(user, "profilePhotoURL"),
        trips: 0,
        _money: emptyRankingMoney()
      };
    }
    stats[mId].trips += 1;
    addRankingTripMoney(stats[mId]._money, trip);
  });

  return finalizeRankingMoney(Object.values(stats));
}

// Ensure time boundaries for day-level filtering
export function getStartOfDay(date: Date | string | number): Date {
  let d: Date;
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    d = new Date(date.trim() + 'T00:00:00.000Z');
  } else {
    d = new Date(date);
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function getEndOfDay(date: Date | string | number): Date {
  let d: Date;
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    d = new Date(date.trim() + 'T00:00:00.000Z');
  } else {
    d = new Date(date);
  }
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - 1,
  );
}

export function getCustomRange(start: Date | string, end: Date | string) {
  return {
    start: getStartOfDay(start),
    end: getEndOfDay(end),
  };
}
