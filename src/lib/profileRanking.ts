import type { NormalizedTrip } from "./tripNormalizer";
import {
  addRankingUtcDays,
  getRankingCalendarDateParts,
  getRankingUtcStartOfDay,
} from "./rankingPeriods";

export type ProfileRankingScope = "internal" | "global" | "companies";

export interface ProfileRankingEntry {
  id: string;
  name: string;
  val: number;
  trips: number;
  currency?: string;
  currencyBreakdown?: { currency: string; value: number; tripCount: number; missingValueTrips?: number }[];
  currencyUnresolvedTrips?: number;
  companyId?: string;
  companyName?: string;
}

/** Consume the authoritative order; a profile never creates its own score. */
export function summarizeProfileRanking(
  ranking: ProfileRankingEntry[],
  participantId: string,
) {
  const index = ranking.findIndex((entry) => entry.id === participantId);
  const current = index >= 0 ? ranking[index] : null;
  const leader = ranking[0] || null;
  const next = index > 0 ? ranking[index - 1] : null;
  const hasActivity = Boolean(current && current.trips > 0);
  const comparableCurrency = Boolean(current?.currency && leader?.currency && current.currency === leader.currency);
  const leaderRatio =
    comparableCurrency && current && leader && leader.val > 0
      ? Math.min(100, Math.max(0, (current.val / leader.val) * 100))
      : null;

  return {
    current,
    leader,
    next,
    position: index >= 0 ? index + 1 : null,
    total: ranking.length,
    activeParticipants: ranking.filter((entry) => entry.trips > 0).length,
    hasActivity,
    comparableCurrency,
    isLeader: index === 0 && hasActivity,
    gapToNext: comparableCurrency && current && next ? Math.max(0, next.val - current.val) : null,
    gapToLeader:
      comparableCurrency && current && leader ? Math.max(0, leader.val - current.val) : null,
    leaderRatio,
  };
}

export function rankingCalendarDateKey(date: Date): string {
  const { year, month, day } = getRankingCalendarDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function buildProfileActivityCalendar(
  start: Date,
  end: Date,
  trips: NormalizedTrip[],
  referenceDate = new Date(),
) {
  const activity = new Map<string, number>();
  trips.forEach((trip) => {
    if (!trip.isValid || trip.metricDate < start || trip.metricDate > end)
      return;
    const key = rankingCalendarDateKey(trip.metricDate);
    activity.set(key, (activity.get(key) || 0) + 1);
  });
  const todayKey = rankingCalendarDateKey(referenceDate);
  const lastDay = getRankingUtcStartOfDay(end);
  const days = [];
  for (
    let date = getRankingUtcStartOfDay(start);
    date <= lastDay && days.length < 366;
    date = addRankingUtcDays(date, 1)
  ) {
    const key = rankingCalendarDateKey(date);
    const parts = getRankingCalendarDateParts(date);
    days.push({
      key,
      day: parts.day,
      weekday: new Date(
        Date.UTC(parts.year, parts.month - 1, parts.day),
      ).getUTCDay(),
      trips: activity.get(key) || 0,
      future: key > todayKey,
    });
  }
  return days;
}
