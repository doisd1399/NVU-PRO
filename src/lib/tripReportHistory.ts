import { getMonthlyRange, getWeeklyRange } from "./metricsEngine";
import type { NormalizedTrip } from "./tripNormalizer";
import { summarizeTripMoney, type HistoryMoneyGroup } from "./tripMoneySummary";

export type ReportPeriod = "semanal" | "mensal";
export type ReportHistoryItem = {
  id: string; title: string; subTitle: string; totalValue: number; tripCount: number; sortDate: Date;
  moneyGroups: HistoryMoneyGroup[];
  currencySummaries: Array<{ currency: string; totalValue: number | null; tripCount: number; avgTicket: number | null }>;
  unknownCurrencySummaries: Array<{ currency?: string; reason: "missing" | "unknown" | "conflict";
    totalValue: number | null; tripCount: number; avgTicket: number | null }>;
  variation: number; hasPrevious: boolean;
};
const formatDate = (date: Date) => date.toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
const formatMonth = (date: Date) => {
  const value = date.toLocaleDateString("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" });
  return value.charAt(0).toUpperCase() + value.slice(1);
};
const rangeFor = (date: Date, period: ReportPeriod) => period === "semanal" ? getWeeklyRange(date) : getMonthlyRange(date);
const keyFor = (date: Date, period: ReportPeriod) => date.toISOString().slice(0, period === "semanal" ? 10 : 7);

/** Reports partition the same eligible rows as history; paging never changes totals. */
export function buildTripReportHistory(trips: NormalizedTrip[], period: ReportPeriod, now = new Date()): ReportHistoryItem[] {
  const groups = new Map<string, { start: Date; end: Date; trips: NormalizedTrip[] }>();
  for (const trip of trips) {
    if (!trip.isValid || !Number.isFinite(trip.metricDate?.getTime())) continue;
    const range = rangeFor(trip.metricDate, period), key = keyFor(range.start, period);
    const group = groups.get(key) || { ...range, trips: [] };
    group.trips.push(trip); groups.set(key, group);
  }
  const current = rangeFor(now, period).start.getTime();
  const sorted = [...groups.entries()].map(([id, group]): ReportHistoryItem => {
    const moneyGroups = summarizeTripMoney(group.trips);
    const known = moneyGroups.filter(money => money.currencyStatus === "known");
    const comparable = moneyGroups.length === 1 && known.length === 1 && known[0].value !== null && !known[0].missingValueTrips;
    const isCurrent = group.start.getTime() === current;
    return { id, sortDate: group.start, tripCount: group.trips.length, moneyGroups,
      title: period === "semanal" ? (isCurrent ? "Semana atual" : `Semana de ${formatDate(group.start)}`)
        : isCurrent ? "Mês atual" : formatMonth(group.start),
      subTitle: period === "semanal" ? `${formatDate(group.start)} até ${formatDate(group.end)}` : formatMonth(group.start),
      totalValue: comparable ? known[0].value! : 0,
      currencySummaries: known.map(money => ({ currency: money.currency!, totalValue: money.value, tripCount: money.tripCount,
        avgTicket: money.value !== null && !money.missingValueTrips ? money.value / money.tripCount : null })),
      unknownCurrencySummaries: moneyGroups.filter(money => money.currencyStatus !== "known").map(money => ({
        currency: money.currency, reason: money.currencyStatus as "missing" | "unknown" | "conflict",
        totalValue: null, tripCount: money.tripCount, avgTicket: null })),
      variation: 0, hasPrevious: false };
  }).sort((a, b) => a.sortDate.getTime() - b.sortDate.getTime());
  const byPeriod = new Map(sorted.map(item => [item.id, item]));
  for (const item of sorted) {
    const previousDate = new Date(item.sortDate);
    if (period === "semanal") previousDate.setUTCDate(previousDate.getUTCDate() - 7);
    else previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
    const previous = byPeriod.get(keyFor(rangeFor(previousDate, period).start, period));
    const currentMoney = item.moneyGroups[0], previousMoney = previous?.moneyGroups[0];
    const comparable = item.moneyGroups.length === 1 && previous?.moneyGroups.length === 1 &&
      currentMoney?.currencyStatus === "known" && previousMoney?.currencyStatus === "known" &&
      currentMoney.currency === previousMoney.currency && currentMoney.value !== null &&
      previousMoney.value !== null && previousMoney.value !== 0 &&
      !currentMoney.missingValueTrips && !previousMoney.missingValueTrips;
    if (comparable) { item.hasPrevious = true; item.variation = ((currentMoney.value! - previousMoney.value!) / previousMoney.value!) * 100; }
  }
  return sorted.reverse();
}
