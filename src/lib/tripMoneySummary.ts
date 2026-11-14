import { parseTripMoneyRecord, type TripCurrencyStatus } from "./tripNormalizer";

export type HistoryMoneyGroup = {
  currency?: string;
  currencyStatus: TripCurrencyStatus;
  currencySource?: string;
  currencySources: string[];
  value: number | null;
  tripCount: number;
  missingValueTrips: number;
};

/** One financial presentation policy for history, reports and profile cards. */
export function summarizeTripMoney(trips: Record<string, unknown>[]): HistoryMoneyGroup[] {
  const groups = new Map<string, HistoryMoneyGroup & { cents: number; valuedTrips: number; overflow: boolean }>();
  for (const trip of trips) {
    const money = parseTripMoneyRecord(trip);
    const comparable = money.currencyStatus === "known" && Boolean(money.currency);
    const key = comparable ? money.currency! : `${money.currencyStatus}:${money.currency || ""}`;
    const group = groups.get(key) || { currency: money.currency, currencyStatus: money.currencyStatus, currencySources: [],
      value: null, tripCount: 0, missingValueTrips: 0, cents: 0, valuedTrips: 0, overflow: false };
    if (money.currencySource && !group.currencySources.includes(money.currencySource)) group.currencySources.push(money.currencySource);
    group.tripCount++;
    if (money.amountCents === null || !Number.isSafeInteger(money.amountCents)) group.missingValueTrips++;
    else if (comparable) {
      group.valuedTrips++;
      group.cents += money.amountCents;
      if (!Number.isSafeInteger(group.cents)) group.overflow = true;
    }
    groups.set(key, group);
  }
  return [...groups.values()].map(({ cents, valuedTrips, overflow, ...group }) => ({ ...group,
    currencySource: group.currencySources.length === 1 ? group.currencySources[0] : group.currencySources.length ? "MIXED" : undefined,
    value: group.currencyStatus === "known" && valuedTrips > 0 && !overflow ? cents / 100 : null }));
}
