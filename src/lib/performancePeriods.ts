import {
  getMonthlyRange,
  getTodayRange,
  getWeeklyRange,
} from "./metricsEngine";

export type PerformancePeriodPreset =
  | "Semana atual"
  | "Mês atual"
  | "Hoje"
  | "Personalizado";

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

const startOfUtcDay = (value: Date) =>
  new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );

const endOfUtcDay = (value: Date) =>
  new Date(startOfUtcDay(value).getTime() + 86_400_000 - 1);

// react-day-picker returns a Date at local midnight. Convert the calendar
// fields the user selected into the platform's canonical UTC day instead of
// interpreting the device offset as part of the requested interval.
const selectedCalendarDayStartUtc = (value: Date) =>
  new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));

const selectedCalendarDayEndUtc = (value: Date) =>
  new Date(selectedCalendarDayStartUtc(value).getTime() + 86_400_000 - 1);

const addUtcDays = (value: Date, amount: number) => {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date;
};

const addUtcMonths = (value: Date, amount: number) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + amount, 1));

const inclusiveCalendarDays = (start: Date, end: Date) => {
  const startUtc = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
  );
  const endUtc = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate(),
  );
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
    return {
      start: selectedCalendarDayStartUtc(first),
      end: selectedCalendarDayEndUtc(last),
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
    const range = getTodayRange(addUtcDays(referenceDate, -1));
    return { start: range.start, end: range.end };
  }

  if (preset === "Semana atual") {
    const range = getWeeklyRange(addUtcDays(referenceDate, -7));
    return { start: range.start, end: range.end };
  }

  if (preset === "Mês atual") {
    const range = getMonthlyRange(addUtcMonths(referenceDate, -1));
    return { start: range.start, end: range.end };
  }

  const days = inclusiveCalendarDays(current.start, current.end);
  const previousEnd = endOfUtcDay(addUtcDays(current.start, -1));
  const previousStart = startOfUtcDay(addUtcDays(previousEnd, -(days - 1)));
  return { start: previousStart, end: previousEnd };
}

export function buildClassificationPeriods(
  view: ClassificationPeriodView,
  referenceDate = new Date(),
  count = 5,
): ClassificationPeriod[] {
  return Array.from({ length: Math.max(1, count) }, (_, index) => {
    if (view === "Semanal") {
      const range = getWeeklyRange(addUtcDays(referenceDate, index * -7));
      return {
        id: index,
        start: range.start,
        end: range.end,
        label: `${range.start.toLocaleDateString("pt-BR", {
          timeZone: "UTC",
          day: "2-digit",
          month: "2-digit",
        })} a ${range.end.toLocaleDateString("pt-BR", {
          timeZone: "UTC",
          day: "2-digit",
          month: "2-digit",
        })}`,
      };
    }

    const range = getMonthlyRange(addUtcMonths(referenceDate, -index));
    const formattedMonth = range.start
      .toLocaleDateString("pt-BR", { timeZone: "UTC", month: "short" })
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
    start: new Date(Math.min(...periods.map((period) => period.start.getTime()))),
    end: new Date(Math.max(...periods.map((period) => period.end.getTime()))),
  };
}
