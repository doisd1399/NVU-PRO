import { driverDisplayIdentity } from "./driverDisplayIdentity";
import type { RankingPageDriverItem } from "./rankingPageEngine";
import { hasSimulatorIdentity, resolveSimulatorId } from "./resolveSimulator";
import { buildRankingUtcPeriodKey } from "./rankingPeriods";
import { normalizeExplicitCurrency, resolveSimulatorCurrency } from "./simulatorCurrencyRegistry";

export const RANKING_AGGREGATES_COLLECTION = "ranking_aggregates";
// v4 is reserved for aggregates produced after every live/open period moved
// to the canonical historico_viagens source. Closed-period documents remain a
// performance snapshot, never a competing source for mutable current totals.
// v5 stores totals by currency and avoids cross-currency scalar comparisons.
export const RANKING_AGGREGATE_SCHEMA_VERSION = 5;
export const RANKING_AGGREGATE_COMPATIBLE_SCHEMA_VERSIONS = [5, 4] as const;
export const RANKING_AGGREGATE_TIME_ZONE = "America/Sao_Paulo";
export const RANKING_AGGREGATE_PERIOD_POLICY = "SAO_PAULO_CALENDAR";
export const RANKING_AGGREGATE_RECONCILE_AFTER_MS = 60 * 60 * 1000;

export type RankingAggregatePeriodType = "semana" | "mes";

export interface RankingAggregateCompanyStat {
  trips: number;
  val: number;
  name?: string;
  currencyTotals?: Record<string, number>;
  currencyTripCounts?: Record<string, number>;
  currencySourceCounts?: Record<string, number>;
  currencyMissingValueTrips?: number;
  currencyUnresolvedTrips?: number;
}

export interface RankingAggregateDriverStat {
  trips: number;
  val: number;
  companyId?: string;
  name?: string;
  currencyTotals?: Record<string, number>;
  currencyTripCounts?: Record<string, number>;
  currencySourceCounts?: Record<string, number>;
  currencyMissingValueTrips?: number;
  currencyUnresolvedTrips?: number;
}

export interface RankingAggregateDocument {
  schemaVersion: number;
  simulatorId: string;
  periodType: RankingAggregatePeriodType;
  periodKey: string;
  periodTimeZone: string;
  periodPolicy: string;
  periodClosed?: boolean;
  complete: boolean;
  sourceTripCount: number;
  companies: Record<string, RankingAggregateCompanyStat>;
  drivers: Record<string, RankingAggregateDriverStat>;
  generatedAt?: unknown;
  updatedAt?: unknown;
  lastReconciledAt?: unknown;
}

export function buildRankingAggregatePeriodKey(
  periodType: RankingAggregatePeriodType,
  referenceDate = new Date(),
) {
  return buildRankingUtcPeriodKey(periodType, referenceDate);
}

export function buildRankingAggregateDocumentId(
  simulatorId: string,
  periodKey: string,
  schemaVersion = RANKING_AGGREGATE_SCHEMA_VERSION,
) {
  return `v${schemaVersion}__${encodeURIComponent(
    simulatorId.trim(),
  )}__${periodKey}`
    .replace(/[^a-zA-Z0-9%_.~-]/g, "_")
    .slice(0, 1400);
}

function asFiniteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseNumberMap(value: unknown, integer = false): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, raw]) => {
    const number = asFiniteNumber(raw);
    if (!key || number < 0 || !Number.isFinite(number)) return [];
    return [[key, integer ? Math.trunc(number) : number]];
  }));
}

function parseLegacyMoneyFields(
  record: Record<string, unknown>,
  trips: number,
  val: number,
  fallbackCurrency?: string,
) {
  const currencyTotals = parseNumberMap(record.currencyTotals);
  const currencyTripCounts = parseNumberMap(record.currencyTripCounts, true);
  const currencySourceCounts = parseNumberMap(record.currencySourceCounts, true);
  let currencyUnresolvedTrips = Math.max(0, Math.trunc(asFiniteNumber(record.currencyUnresolvedTrips)));
  const explicitValues = ["currency", "moeda", "simpleReceiptCurrency", "moneyCurrency", "receiptCurrency"]
    .map((field) => record[field])
    .filter((value) => asText(value));
  const explicitResults = explicitValues.map(normalizeExplicitCurrency);
  const explicitCurrencies = [...new Set(explicitResults
    .filter((result) => result.recognized && result.currency)
    .map((result) => result.currency!))];
  const explicitCurrency = explicitCurrencies[0];
  const explicitUnsupported = explicitResults.some((result) => !result.recognized || !result.supported);
  const explicitConflict = explicitCurrencies.length > 1;

  // v4 stored one scalar per entity. Reconstruct it using the product-approved
  // simulator registry only when currency partitions are absent; explicit
  // contradictory/unsupported currency remains unresolved instead of summed.
  if (!Object.keys(currencyTotals).length && !Object.keys(currencyTripCounts).length && (fallbackCurrency || explicitValues.length > 0)) {
    if (explicitConflict || (explicitUnsupported && fallbackCurrency)) {
      currencyUnresolvedTrips = Math.max(currencyUnresolvedTrips, trips);
      currencySourceCounts.CONFLICT = Math.max(currencySourceCounts.CONFLICT || 0, trips);
    } else if (explicitUnsupported) {
      currencyUnresolvedTrips = Math.max(currencyUnresolvedTrips, trips);
      currencySourceCounts.UNSUPPORTED_EXPLICIT_CURRENCY = Math.max(
        currencySourceCounts.UNSUPPORTED_EXPLICIT_CURRENCY || 0,
        trips,
      );
    } else if (explicitCurrency && fallbackCurrency && explicitCurrency !== fallbackCurrency) {
      currencyUnresolvedTrips = Math.max(currencyUnresolvedTrips, trips);
      currencySourceCounts.CONFLICT = Math.max(currencySourceCounts.CONFLICT || 0, trips);
    } else {
      const currency = explicitCurrency || fallbackCurrency;
      if (currency) {
        currencyTotals[currency] = val;
        currencyTripCounts[currency] = trips;
        const source = explicitCurrency ? "EXPLICIT_AGGREGATE_CURRENCY" : "SIMULATOR_REGISTRY";
        currencySourceCounts[source] = Math.max(currencySourceCounts[source] || 0, trips);
      }
    }
  }

  return {
    currencyTotals,
    currencyTripCounts,
    currencySourceCounts,
    currencyMissingValueTrips: Math.max(0, Math.trunc(asFiniteNumber(record.currencyMissingValueTrips))),
    currencyUnresolvedTrips,
  };
}

function parseCompanyStats(value: unknown, fallbackCurrency?: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, RankingAggregateCompanyStat>;
  }

  const result: Record<string, RankingAggregateCompanyStat> = {};
  Object.entries(value as Record<string, unknown>).forEach(([id, raw]) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const record = raw as Record<string, unknown>;
    const trips = Math.max(0, Math.trunc(asFiniteNumber(record.trips)));
    const val = Math.max(0, asFiniteNumber(record.val));
    result[id] = {
      trips,
      val,
      name: asText(record.name) || undefined,
      ...parseLegacyMoneyFields(record, trips, val, fallbackCurrency),
    };
  });
  return result;
}

function parseDriverStats(value: unknown, fallbackCurrency?: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, RankingAggregateDriverStat>;
  }

  const result: Record<string, RankingAggregateDriverStat> = {};
  Object.entries(value as Record<string, unknown>).forEach(([id, raw]) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const record = raw as Record<string, unknown>;
    const trips = Math.max(0, Math.trunc(asFiniteNumber(record.trips)));
    const val = Math.max(0, asFiniteNumber(record.val));
    result[id] = {
      trips,
      val,
      companyId: asText(record.companyId) || undefined,
      name: asText(record.name) || undefined,
      ...parseLegacyMoneyFields(record, trips, val, fallbackCurrency),
    };
  });
  return result;
}

export function parseRankingAggregateDocument(
  value: Record<string, unknown> | undefined,
): RankingAggregateDocument | null {
  if (!value) return null;
  const schemaVersion = asFiniteNumber(value.schemaVersion);
  const simulatorId = asText(value.simulatorId);
  const periodType = asText(value.periodType);
  const periodKey = asText(value.periodKey);

  if (
    !RANKING_AGGREGATE_COMPATIBLE_SCHEMA_VERSIONS.includes(schemaVersion as 4 | 5) ||
    !simulatorId ||
    !periodKey ||
    value.periodTimeZone !== RANKING_AGGREGATE_TIME_ZONE ||
    value.periodPolicy !== RANKING_AGGREGATE_PERIOD_POLICY ||
    (periodType !== "semana" && periodType !== "mes") ||
    value.complete !== true
  ) {
    return null;
  }

  const fallbackCurrency = schemaVersion === 4
    ? resolveSimulatorCurrency({ simulatorId, simulatorCode: simulatorId }).currency
    : undefined;

  return {
    schemaVersion,
    simulatorId,
    periodType,
    periodKey,
    periodTimeZone: RANKING_AGGREGATE_TIME_ZONE,
    periodPolicy: RANKING_AGGREGATE_PERIOD_POLICY,
    periodClosed: value.periodClosed === true,
    complete: true,
    sourceTripCount: Math.max(
      0,
      Math.trunc(asFiniteNumber(value.sourceTripCount)),
    ),
    companies: parseCompanyStats(value.companies, fallbackCurrency),
    drivers: parseDriverStats(value.drivers, fallbackCurrency),
    generatedAt: value.generatedAt,
    updatedAt: value.updatedAt,
    lastReconciledAt: value.lastReconciledAt,
  };
}

export function rankingAggregateTimestampMs(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();

  const timestamp = value as {
    toDate?: () => Date;
    seconds?: unknown;
    _seconds?: unknown;
  };
  if (typeof timestamp.toDate === "function") {
    return timestamp.toDate().getTime();
  }

  const seconds = Number(timestamp.seconds ?? timestamp._seconds);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;

  const parsed = new Date(value as string | number).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function readEntityText(
  record: Record<string, unknown> | undefined,
  key: string,
) {
  const value = record?.[key];
  return typeof value === "string" ? value.trim() : "";
}

export function isRankingEligibleCompany(
  company: Record<string, unknown> | undefined,
): boolean {
  if (!company) return false;
  const status = String(
    company.status || company.situacao || company.state || "active",
  )
    .trim()
    .toLocaleLowerCase("pt-BR");
  const deleted =
    company.deleted === true ||
    company.softDeleted === true ||
    company.excluida === true ||
    company.excluido === true ||
    [
      "deleted",
      "excluida",
      "excluido",
      "removed",
      "removida",
      "removido",
    ].includes(status);
  return (
    !deleted &&
    ["active", "approved", "ativo"].includes(status) &&
    hasSimulatorIdentity(company)
  );
}

/** A confirmed missing document must not be restored from a stale catalog. */
export function mergeRankingCompanyCatalogs(
  knownCompanies: Record<string, unknown>[],
  confirmedCompanies: Record<string, unknown>[],
  confirmedIds: string[] = [],
) {
  const authoritativeIds = new Set(confirmedIds);
  const byId = new Map<string, Record<string, unknown>>();
  knownCompanies.forEach((company) => {
    const id = String(company.id || "").trim();
    if (id && !authoritativeIds.has(id)) byId.set(id, company);
  });
  confirmedCompanies.forEach((company) => {
    const id = String(company.id || "").trim();
    if (id) byId.set(id, company);
  });
  return Array.from(byId.values()).filter(isRankingEligibleCompany);
}

function stableRankingSort<
  T extends { val: number; trips: number; name?: string; id: string },
>(left: T, right: T): number {
  if (right.val !== left.val) return right.val - left.val;
  if (right.trips !== left.trips) return right.trips - left.trips;
  const nameOrder = String(left.name || "").localeCompare(
    String(right.name || ""),
    "pt-BR",
    { sensitivity: "base", numeric: true },
  );
  return nameOrder || left.id.localeCompare(right.id);
}

function finalizeCurrencyRanking<T extends {
  id: string; name?: string; trips: number; val: number;
  currencyTotals?: Record<string, number>; currencyTripCounts?: Record<string, number>;
  currencyMissingValueTrips?: number; currencyUnresolvedTrips?: number;
}>(items: T[]) {
  const currencies = new Set(items.flatMap((item) => [
    ...Object.keys(item.currencyTotals || {}),
    ...Object.keys(item.currencyTripCounts || {}),
  ]));
  const unresolved = items.reduce((sum, item) => sum + (item.currencyUnresolvedTrips || 0), 0);
  const missing = items.reduce((sum, item) => sum + (item.currencyMissingValueTrips || 0), 0);
  const comparableCurrency = currencies.size === 1 && unresolved === 0 && missing === 0
    ? [...currencies][0]
    : undefined;
  const ranked = items.map((item) => ({
    ...item,
    val: comparableCurrency ? item.currencyTotals?.[comparableCurrency] || 0 : 0,
    currency: comparableCurrency,
    currencyBreakdown: [...new Set([
      ...Object.keys(item.currencyTotals || {}),
      ...Object.keys(item.currencyTripCounts || {}),
    ])].map((currency) => ({
      currency,
      value: item.currencyTotals?.[currency] || 0,
      tripCount: item.currencyTripCounts?.[currency] || 0,
      missingValueTrips: item.currencyMissingValueTrips || 0,
    })),
  }));
  return ranked.sort(stableRankingSort);
}

function shortDriverName(value: unknown) {
  const parts = String(value || "Motorista Desconhecido")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.slice(0, 2).join(" ") || "Motorista Desconhecido";
}

function resolveAggregateSimulatorCurrency(
  simulatorId: string,
  simulators: Record<string, unknown>[],
) {
  const catalog = simulators.find((item) => readEntityText(item, "id") === simulatorId);
  const readFirst = (...keys: string[]) => keys.map((key) => readEntityText(catalog, key)).find(Boolean) || "";
  return resolveSimulatorCurrency({
    simulatorId,
    simulatorCode: readFirst("simulatorCode", "simuladorCodigo", "code", "slug", "key"),
    simulatorName: readFirst("simulatorName", "simuladorNome", "name", "nome", "label", "title", "displayName"),
  });
}

function applyLegacyAggregateCurrency<T extends {
  trips: number;
  val: number;
  currencyTotals?: Record<string, number>;
  currencyTripCounts?: Record<string, number>;
  currencySourceCounts?: Record<string, number>;
  currencyMissingValueTrips?: number;
  currencyUnresolvedTrips?: number;
}>(stats: T, schemaVersion: number, simulatorResolution: ReturnType<typeof resolveSimulatorCurrency>): T {
  if (schemaVersion !== 4) return stats;

  const currencyTotals = { ...(stats.currencyTotals || {}) };
  const currencyTripCounts = { ...(stats.currencyTripCounts || {}) };
  const currencySourceCounts = { ...(stats.currencySourceCounts || {}) };
  let currencyUnresolvedTrips = Math.max(0, Math.trunc(stats.currencyUnresolvedTrips || 0));
  const partitionKeys = new Set([...Object.keys(currencyTotals), ...Object.keys(currencyTripCounts)]);

  if (simulatorResolution.status === "conflict") {
    Object.keys(currencyTotals).forEach((key) => delete currencyTotals[key]);
    Object.keys(currencyTripCounts).forEach((key) => delete currencyTripCounts[key]);
    currencyUnresolvedTrips = Math.max(currencyUnresolvedTrips, stats.trips);
    currencySourceCounts.SIMULATOR_METADATA_CONFLICT = Math.max(
      currencySourceCounts.SIMULATOR_METADATA_CONFLICT || 0,
      stats.trips,
    );
  } else if (simulatorResolution.currency) {
    const conflictsWithRegistry = [...partitionKeys].some((currency) => currency !== simulatorResolution.currency);
    if (conflictsWithRegistry) {
      Object.keys(currencyTotals).forEach((key) => delete currencyTotals[key]);
      Object.keys(currencyTripCounts).forEach((key) => delete currencyTripCounts[key]);
      currencyUnresolvedTrips = Math.max(currencyUnresolvedTrips, stats.trips);
      currencySourceCounts.CONFLICT = Math.max(currencySourceCounts.CONFLICT || 0, stats.trips);
    } else if (partitionKeys.size === 0 && currencyUnresolvedTrips === 0) {
      currencyTotals[simulatorResolution.currency] = stats.val;
      currencyTripCounts[simulatorResolution.currency] = stats.trips;
      currencySourceCounts.SIMULATOR_REGISTRY = Math.max(
        currencySourceCounts.SIMULATOR_REGISTRY || 0,
        stats.trips,
      );
    }
  }

  return {
    ...stats,
    currencyTotals,
    currencyTripCounts,
    currencySourceCounts,
    currencyUnresolvedTrips,
  };
}

export function buildCompanyRankingFromAggregate(
  aggregate: RankingAggregateDocument,
  companies: Record<string, unknown>[],
  simulators: Record<string, unknown>[] = [],
) {
  const simulatorCurrency = resolveAggregateSimulatorCurrency(aggregate.simulatorId, simulators);
  const companiesById = new Map(
    companies
      .map((company) => [readEntityText(company, "id"), company] as const)
      .filter(([id]) => Boolean(id)),
  );

  const rows = Object.entries(aggregate.companies)
    .map(([id, rawStats]) => {
      const stats = applyLegacyAggregateCurrency(rawStats, aggregate.schemaVersion, simulatorCurrency);
      const company = companiesById.get(id);
      // The public ranking is an operational view, not an archive. A snapshot
      // row is only renderable while its current catalog record is active and
      // simulator-compatible; missing catalog data must never leak a stale or
      // deleted company into the ranking.
      if (!company || !isRankingEligibleCompany(company)) return null;
      if (
        company &&
        resolveSimulatorId(company, simulators, companies) !==
          aggregate.simulatorId
      )
        return null;
      return {
        id,
        name:
          readEntityText(company, "companyName") ||
          readEntityText(company, "name") ||
          stats.name ||
          "Empresa",
        logo:
          readEntityText(company, "logoUrl") ||
          readEntityText(company, "logoURL") ||
          readEntityText(company, "companyLogoURL") ||
          readEntityText(company, "logo"),
        trips: stats.trips,
        val: stats.val,
        currencyTotals: stats.currencyTotals,
        currencyTripCounts: stats.currencyTripCounts,
        currencySourceCounts: stats.currencySourceCounts,
        currencyMissingValueTrips: stats.currencyMissingValueTrips,
        currencyUnresolvedTrips: stats.currencyUnresolvedTrips,
        pendingCatalog: false,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort(stableRankingSort);
  return finalizeCurrencyRanking(rows);
}

export function buildDriverRankingFromAggregate(
  aggregate: RankingAggregateDocument,
  users: Record<string, unknown>[],
  companies: Record<string, unknown>[],
  simulators: Record<string, unknown>[] = [],
  companyMembers: Record<string, unknown>[] = [],
): RankingPageDriverItem[] {
  const simulatorCurrency = resolveAggregateSimulatorCurrency(aggregate.simulatorId, simulators);
  const usersById = new Map(
    users
      .map((user) => [readEntityText(user, "id"), user] as const)
      .filter(([id]) => Boolean(id)),
  );
  const companiesById = new Map(
    companies
      .map((company) => [readEntityText(company, "id"), company] as const)
      .filter(([id]) => Boolean(id)),
  );
  const activeMembershipByUser = new Map<
    string,
    { companyId: string; joinedAt: number }
  >();
  companyMembers.forEach((membership) => {
    const userId = readEntityText(membership, "userId");
    const companyId = readEntityText(membership, "companyId");
    const status = readEntityText(membership, "status").toLowerCase();
    const roles = Array.isArray(membership.roles)
      ? membership.roles.map((role) => String(role).toLowerCase())
      : [];
    const isDriver =
      roles.includes("driver") ||
      readEntityText(membership, "role").toLowerCase() === "driver";
    const company = companiesById.get(companyId);
    if (
      !userId ||
      !companyId ||
      status !== "active" ||
      !isDriver ||
      !isRankingEligibleCompany(company) ||
      resolveSimulatorId(company, simulators, companies) !==
        aggregate.simulatorId
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
      activeMembershipByUser.set(userId, { companyId, joinedAt });
    }
  });

  const rows = Object.entries(aggregate.drivers)
    .map(([id, rawStats]): RankingPageDriverItem | null => {
      const stats = applyLegacyAggregateCurrency(rawStats, aggregate.schemaVersion, simulatorCurrency);
      const user = usersById.get(id);
      const membershipCompanyId =
        activeMembershipByUser.get(id)?.companyId || "";
      const profileCompanyId =
        readEntityText(user, "companyId") ||
        readEntityText(user, "activeCompanyId");
      const profileCompany = profileCompanyId
        ? companiesById.get(profileCompanyId)
        : undefined;
      const profileCompanyMatchesAggregate = Boolean(
        isRankingEligibleCompany(profileCompany) &&
        resolveSimulatorId(profileCompany, simulators, companies) ===
          aggregate.simulatorId,
      );
      const candidateCompanyId =
        membershipCompanyId ||
        (profileCompanyMatchesAggregate ? profileCompanyId : "") ||
        stats.companyId ||
        "";
      const company = candidateCompanyId
        ? companiesById.get(candidateCompanyId)
        : undefined;
      // Driver rows follow the same active-company policy as company rows.
      // Never render a historical driver under a deleted/inactive/missing
      // company, even when the aggregate still contains the old contribution.
      if (!company || !isRankingEligibleCompany(company)) return null;
      if (
        resolveSimulatorId(company, simulators, companies) !==
        aggregate.simulatorId
      )
        return null;

      return {
        id,
        name: shortDriverName(user ? driverDisplayIdentity(user).name : stats.name),
        logo: driverDisplayIdentity(user).profilePhotoURL,
        trips: stats.trips,
        val: stats.val,
        currencyTotals: stats.currencyTotals,
        currencyTripCounts: stats.currencyTripCounts,
        currencySourceCounts: stats.currencySourceCounts,
        currencyMissingValueTrips: stats.currencyMissingValueTrips,
        currencyUnresolvedTrips: stats.currencyUnresolvedTrips,
        companyId: candidateCompanyId,
        companyName:
          readEntityText(company, "companyName") ||
          readEntityText(company, "name"),
      };
    })
    .filter((item): item is RankingPageDriverItem => item !== null)
    .sort(stableRankingSort);
  return finalizeCurrencyRanking(rows) as RankingPageDriverItem[];
}
