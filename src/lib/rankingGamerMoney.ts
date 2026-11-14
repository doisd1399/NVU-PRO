export interface RankingLeadershipGap {
  amount: number;
  currency: string;
  leaderName: string;
  challengerName: string;
}

function comparableMoney(item: Record<string, unknown> | undefined) {
  if (!item || Number(item.currencyUnresolvedTrips || 0) > 0 || Number(item.currencyMissingValueTrips || 0) > 0) return null;
  const groups = Array.isArray(item.currencyBreakdown) ? item.currencyBreakdown : [];
  if (groups.length > 1) return null;
  const group = groups[0] as { currency?: unknown; value?: unknown; missingValueTrips?: unknown } | undefined;
  if (Number(group?.missingValueTrips || 0) > 0) return null;
  const currency = String(group?.currency ?? item.currency ?? "").trim().toUpperCase();
  const value = group ? group.value : item.val;
  if (!/^[A-Z]{3}$/.test(currency) || currency === "UNK" || typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const cents = Math.round((value + Number.EPSILON) * 100);
  return Number.isSafeInteger(cents) ? { currency, cents } : null;
}

/** Only the two displayed leaders, in the same known single currency, are comparable. */
export function getRankingLeadershipGap(items: Record<string, unknown>[]): RankingLeadershipGap | null {
  const leader = comparableMoney(items[0]);
  const challenger = comparableMoney(items[1]);
  if (!leader || !challenger || leader.currency !== challenger.currency || leader.cents < challenger.cents) return null;
  return {
    amount: (leader.cents - challenger.cents) / 100,
    currency: leader.currency,
    leaderName: String(items[0].name || "1º colocado"),
    challengerName: String(items[1].name || "2º colocado"),
  };
}
