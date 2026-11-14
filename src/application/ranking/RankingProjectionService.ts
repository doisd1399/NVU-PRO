import type { CanonicalTrip } from "../../domain/trip/CanonicalTrip";
import { isTripTombstoned } from "../../lib/tripTombstones";
import { getTripMetricDate, parseTripMoneyRecord } from "../../lib/tripNormalizer";
import { isCanonicalConfirmedTrip } from "../../../functions/src/isCanonicalConfirmedTrip";

export type RankingProjectionScope = "global" | "company" | "internal";
export type RankingProjectionContext = {
  scope: RankingProjectionScope;
  simulatorId?: string;
  companyId?: string;
  periodStart?: number;
  periodEnd?: number;
};
export type RankingProjectionRow = {
  id: string;
  driverId?: string;
  companyId?: string;
  trips: number;
  earnings: number;
  currency?: string;
  currencyBreakdown: { currency: string; value: number; tripCount: number; missingValueTrips: number; currencySources: Record<string, number> }[];
  currencyUnresolvedTrips: number;
};
export type RankingProjection = {
  version: 2;
  generatedAt: string;
  sourceRevision: number;
  scope: RankingProjectionScope;
  simulatorId: string;
  companyId?: string;
  rows: RankingProjectionRow[];
  tripIds: string[];
};

const cache = new Map<string, RankingProjection>();
let sourceRevision = 0;
const clean = (value: unknown) => String(value ?? "").trim();
const tripId = (trip: CanonicalTrip) => clean(trip.canonicalTripId || trip.tripId);
const tripDriverId = (trip: CanonicalTrip) => clean(trip.driverId || (trip as any).motoristaId);
const tripCompanyId = (trip: CanonicalTrip) => clean(trip.companyId || (trip as any).empresaId);
const tripSimulatorId = (trip: CanonicalTrip) => clean(trip.simulatorId || (trip as any).simulatorKey || (trip as any).simulatorCode);

function rankingEligible(trip: CanonicalTrip): boolean {
  if (isTripTombstoned(tripId(trip)) || trip.deleted) return false;
  return isCanonicalConfirmedTrip(trip, {
    operationId: clean((trip as any).operationId || (trip as any).jobId),
    driverId: tripDriverId(trip),
    companyId: tripCompanyId(trip),
    contractId: clean((trip as any).contractId || (trip as any).contratoId),
  });
}

function cacheKey(context: RankingProjectionContext, trips: readonly CanonicalTrip[]): string {
  const sourceFingerprint = trips.map((trip) => [
    tripId(trip), trip.status, (trip as any).recordStatus,
    (trip as any).uploadedAt, (trip as any).deleted,
    (trip as any).currency, (trip as any).moeda, (trip as any).simulatorId,
    (trip as any).simulatorCode, (trip as any).simulatorName,
    (trip as any).valorCents, (trip as any).amountCents, (trip as any).earningsCents,
    (trip as any).valor, (trip as any).value, (trip as any).currencyEvidenceStatus,
  ].map(clean).join(":")).sort().join(",");
  return [
    context.scope,
    clean(context.simulatorId) || "all",
    clean(context.companyId),
    context.periodStart || 0,
    context.periodEnd || 0,
    sourceRevision,
    sourceFingerprint,
  ].join("|");
}

/**
 * Rebuilds all ranking scopes from the same canonical trip array. No ranking
 * surface is allowed to mutate this projection or use a deleted record.
 */
export class RankingProjectionService {
  project(trips: readonly CanonicalTrip[], context: RankingProjectionContext): RankingProjection {
    const key = cacheKey(context, trips);
    const cached = cache.get(key);
    if (cached) return cached;
    const start = context.periodStart ?? Number.NEGATIVE_INFINITY;
    const end = context.periodEnd ?? Number.POSITIVE_INFINITY;
    const simulatorId = clean(context.simulatorId);
    const companyId = clean(context.companyId);
    const selected = trips.filter((trip) => {
      if (!rankingEligible(trip)) return false;
      if (simulatorId && simulatorId !== "all" && tripSimulatorId(trip) !== simulatorId) return false;
      if (context.scope !== "global" && companyId && tripCompanyId(trip) !== companyId) return false;
      const metricDate = getTripMetricDate(trip as any).getTime();
      return metricDate >= start && metricDate <= end;
    });
    type MutableRow = RankingProjectionRow & { _totals: Record<string, { value: number; tripCount: number; missingValueTrips: number; currencySources: Record<string, number> }> };
    const rowsByDriver = new Map<string, MutableRow>();
    const rowsByCompany = new Map<string, MutableRow>();
    selected.forEach((trip) => {
      const driverId = tripDriverId(trip);
      const companyKey = tripCompanyId(trip);
      const rowKey = context.scope === "global" ? companyKey : driverId;
      if (!rowKey) return;
      const target = context.scope === "global" ? rowsByCompany : rowsByDriver;
      const current = target.get(rowKey) || {
        id: rowKey,
        driverId: context.scope === "global" ? undefined : driverId,
        companyId: companyKey || undefined,
        trips: 0,
        earnings: 0,
        currencyBreakdown: [],
        currencyUnresolvedTrips: 0,
        _totals: {},
      };
      current.trips += 1;
      const money = parseTripMoneyRecord(trip as unknown as Record<string, unknown>);
      if (money.currencyStatus === "known" && money.currency) {
        const total = current._totals[money.currency] || { value: 0, tripCount: 0, missingValueTrips: 0, currencySources: {} };
        total.tripCount += 1;
        if (money.amountCents === null) total.missingValueTrips += 1;
        else total.value += money.amount;
        if (money.currencySource) total.currencySources[money.currencySource] = (total.currencySources[money.currencySource] || 0) + 1;
        current._totals[money.currency] = total;
      } else current.currencyUnresolvedTrips += 1;
      target.set(rowKey, current);
    });
    const mutableRows = Array.from((context.scope === "global" ? rowsByCompany : rowsByDriver).values());
    const currencies = new Set(mutableRows.flatMap((row) => Object.keys(row._totals)));
    const unresolved = mutableRows.reduce((sum, row) => sum + row.currencyUnresolvedTrips, 0);
    const missing = mutableRows.reduce((sum, row) => sum + Object.values(row._totals).reduce((a, item) => a + item.missingValueTrips, 0), 0);
    const comparableCurrency = currencies.size === 1 && unresolved === 0 && missing === 0 ? [...currencies][0] : undefined;
    const rows = mutableRows.map((row) => {
      const { _totals, ...base } = row;
      const currencyBreakdown = Object.entries(_totals).map(([currency, total]) => ({ currency, ...total }));
      return { ...base, currency: comparableCurrency, earnings: comparableCurrency ? _totals[comparableCurrency]?.value || 0 : 0, currencyBreakdown };
    }).sort((left, right) => (comparableCurrency ? right.earnings - left.earnings : 0) || right.trips - left.trips || left.id.localeCompare(right.id));
    const projection: RankingProjection = {
      version: 2,
      generatedAt: new Date().toISOString(),
      sourceRevision,
      scope: context.scope,
      simulatorId: simulatorId || "all",
      companyId: companyId || undefined,
      rows,
      tripIds: selected.map(tripId).filter(Boolean),
    };
    cache.set(key, projection);
    return projection;
  }

  invalidate(reason = "CANONICAL_TRIP_UPDATED"): void {
    sourceRevision += 1;
    cache.clear();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("nvu:ranking-projection-invalidated", {
        detail: { reason, sourceRevision },
      }));
    }
  }

  invalidateAll(reason = "CANONICAL_TRIP_UPDATED"): void {
    this.invalidate(reason);
  }

  getRevision(): number {
    return sourceRevision;
  }
}

export const rankingProjectionService = new RankingProjectionService();
