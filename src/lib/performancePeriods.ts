import {
  getMonthlyRange,
  getTodayRange,
  getWeeklyRange,
} from "./metricsEngine";
import {
  addRankingUtcDays,
  addRankingUtcMonths,
  getRankingUtcEndOfDay,
  getRankingUtcStartOfDay,
  RANKING_TIME_ZONE,
} from "./rankingPeriods";

export type PerformancePeriodPreset =
  "Semana atual" | "Mês atual" | "Hoje" | "Personalizado";

export type ClassificationPeriodView = "Semanal" | "Mensal";

export interface DateInterval {
  start: Date;
  end: Date;
}

export interface OptionalDateRange {
  from?: Date;
  to?: Date;
}

export interface ClassificationPeriod extends DateInterval {
  id: number;
  label: string;
}

// react-day-picker returns a Date at local midnight. Convert the calendar
// fields the user selected into the platform's canonical UTC day instead of
// interpreting the device offset as part of the requested interval.
const selectedCalendarDateKey = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

const inclusiveCalendarDays = (start: Date, end: Date) => {
  const startUtc = getRankingUtcStartOfDay(start).getTime();
  const endUtc = getRankingUtcStartOfDay(end).getTime();
  return Math.max(1, Math.round((endUtc - startUtc) / 86_400_000) + 1);
};

export function resolvePerformanceInterval(
  preset: PerformancePeriodPreset,
  customRange: OptionalDateRange | undefined,
  referenceDate = new Date(),
): DateInterval {
  if (preset === "Hoje") {
    const range = getTodayRange(referenceDate);
    return { start: range.start, end: range.end };
  }

  if (preset === "Mês atual") {
    const range = getMonthlyRange(referenceDate);
    return { start: range.start, end: range.end };
  }

  if (preset === "Personalizado" && customRange?.from) {
    const rawStart = new Date(customRange.from);
    const rawEnd = new Date(customRange.to || customRange.from);
    const first = rawStart <= rawEnd ? rawStart : rawEnd;
    const last = rawStart <= rawEnd ? rawEnd : rawStart;
    const firstKey = selectedCalendarDateKey(first);
    const lastKey = selectedCalendarDateKey(last);
    return {
      start: getRankingUtcStartOfDay(firstKey),
      end: getRankingUtcEndOfDay(lastKey),
    };
  }

  const range = getWeeklyRange(referenceDate);
  return { start: range.start, end: range.end };
}

/**
 * Returns the immediately preceding comparable interval.
 * Calendar presets use the previous calendar day/week/month. A custom range
 * uses the immediately preceding interval with the same inclusive day count.
 */
export function resolvePreviousPerformanceInterval(
  preset: PerformancePeriodPreset,
  current: DateInterval,
  referenceDate = new Date(),
): DateInterval {
  if (preset === "Hoje") {
    const range = getTodayRange(addRankingUtcDays(referenceDate, -1));
    return { start: range.start, end: range.end };
  }

  if (preset === "Semana atual") {
    const range = getWeeklyRange(addRankingUtcDays(referenceDate, -7));
    return { start: range.start, end: range.end };
  }

  if (preset === "Mês atual") {
    const range = getMonthlyRange(addRankingUtcMonths(referenceDate, -1));
    return { start: range.start, end: range.end };
  }

  const days = inclusiveCalendarDays(current.start, current.end);
  const previousEnd = getRankingUtcEndOfDay(
    addRankingUtcDays(current.start, -1),
  );
  const previousStart = addRankingUtcDays(current.start, -days);
  return { start: previousStart, end: previousEnd };
}

export function buildClassificationPeriods(
  view: ClassificationPeriodView,
  referenceDate = new Date(),
  count = 5,
): ClassificationPeriod[] {
  return Array.from({ length: Math.max(1, count) }, (_, index) => {
    if (view === "Semanal") {
      const range = getWeeklyRange(
        addRankingUtcDays(referenceDate, index * -7),
      );
      return {
        id: index,
        start: range.start,
        end: range.end,
        label: `${range.start.toLocaleDateString("pt-BR", {
          timeZone: RANKING_TIME_ZONE,
          day: "2-digit",
          month: "2-digit",
        })} a ${range.end.toLocaleDateString("pt-BR", {
          timeZone: RANKING_TIME_ZONE,
          day: "2-digit",
          month: "2-digit",
        })}`,
      };
    }

    const range = getMonthlyRange(addRankingUtcMonths(referenceDate, -index));
    const formattedMonth = range.start
      .toLocaleDateString("pt-BR", {
        timeZone: RANKING_TIME_ZONE,
        month: "short",
      })
      .replace(".", "");
    return {
      id: index,
      start: range.start,
      end: range.end,
      label: `${formattedMonth.charAt(0).toUpperCase() + formattedMonth.slice(1)} ${range.start.getUTCFullYear()}`,
    };
  });
}

export function getClassificationHistoryInterval(
  periods: ClassificationPeriod[],
): DateInterval {
  if (periods.length === 0) {
    const fallback = getWeeklyRange();
    return { start: fallback.start, end: fallback.end };
  }

  return {
    start: new Date(
      Math.min(...periods.map((period) => period.start.getTime())),
    ),
    end: new Date(Math.max(...periods.map((period) => period.end.getTime()))),
  };
}
