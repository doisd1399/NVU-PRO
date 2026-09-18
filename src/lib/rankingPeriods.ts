export type RankingCalendarPeriod = "semana" | "mes";

export const RANKING_TIME_ZONE = "America/Sao_Paulo";

const DAY_MS = 24 * 60 * 60 * 1000;
const RANKING_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

type CalendarDateParts = {
  year: number;
  month: number;
  day: number;
};

const calendarPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: RANKING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const monthLabelFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  month: "long",
});

function readCalendarPart(
  parts: Intl.DateTimeFormatPart[],
  type: "year" | "month" | "day",
): number {
  return Number(parts.find((part) => part.type === type)?.value || 0);
}

/**
 * Returns the business calendar date used by ranking periods.
 *
 * Ranking periods are calendar periods for Brazil, not UTC periods. A Date is
 * still returned by the range helpers as a real UTC instant so Firestore
 * queries remain deterministic on every device.
 */
export function getRankingCalendarDateParts(value: Date | string | number): CalendarDateParts {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (isoMatch) {
      return {
        year: Number(isoMatch[1]),
        month: Number(isoMatch[2]),
        day: Number(isoMatch[3]),
      };
    }

    const brazilianMatch = /^(\d{2})\/(\d{2})\/(\d{2,4})/.exec(trimmed);
    if (brazilianMatch) {
      const rawYear = Number(brazilianMatch[3]);
      return {
        year: rawYear < 100 ? 2000 + rawYear : rawYear,
        month: Number(brazilianMatch[2]),
        day: Number(brazilianMatch[1]),
      };
    }
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { year: 1970, month: 1, day: 1 };
  }

  const parts = calendarPartsFormatter.formatToParts(parsed);
  return {
    year: readCalendarPart(parts, "year"),
    month: readCalendarPart(parts, "month"),
    day: readCalendarPart(parts, "day"),
  };
}

function calendarDateToRankingInstant(parts: CalendarDateParts): Date {
  return new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day) + RANKING_UTC_OFFSET_MS,
  );
}

function calendarDateToCivilUtc(parts: CalendarDateParts): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function civilUtcToCalendarParts(value: Date): CalendarDateParts {
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

export function formatRankingMonthLabel(
  value: Date | string | number = new Date(),
): string {
  const { year, month } = getRankingCalendarDateParts(value);
  const monthName = monthLabelFormatter.format(new Date(Date.UTC(year, month - 1, 1)));
  return `Mês de ${monthName.charAt(0).toLocaleUpperCase("pt-BR")}${monthName.slice(1)}`;
}

export function getRankingUtcStartOfDay(
  value: Date | string | number,
): Date {
  return calendarDateToRankingInstant(getRankingCalendarDateParts(value));
}

export function getRankingUtcEndOfDay(
  value: Date | string | number,
): Date {
  return new Date(getRankingUtcStartOfDay(value).getTime() + DAY_MS - 1);
}

/**
 * Returns the next midnight in the ranking calendar (America/Sao_Paulo).
 * This is used by live consumers so a device refreshes at the business
 * calendar boundary rather than at midnight UTC.
 */
export function getRankingNextCalendarMidnight(referenceDate = new Date()): Date {
  const current = calendarDateToCivilUtc(getRankingCalendarDateParts(referenceDate));
  current.setUTCDate(current.getUTCDate() + 1);
  return new Date(current.getTime() + RANKING_UTC_OFFSET_MS + 1000);
}

/**
 * Canonical weekly ranking window shared by every device and Cloud Function.
 * The existing NVU season convention is preserved: Sunday 00:00:00.000 in
 * the Brazil business calendar through Saturday 23:59:59.999 in that same
 * calendar. The returned values are UTC instants for querying Firestore.
 */
export function getRankingUtcWeeklyRange(referenceDate = new Date()) {
  const current = calendarDateToCivilUtc(getRankingCalendarDateParts(referenceDate));
  current.setUTCDate(current.getUTCDate() - current.getUTCDay());
  const start = calendarDateToRankingInstant(civilUtcToCalendarParts(current));
  return {
    start,
    end: new Date(start.getTime() + 7 * DAY_MS - 1),
  };
}

export function getRankingUtcMonthlyRange(referenceDate = new Date()) {
  const current = getRankingCalendarDateParts(referenceDate);
  const start = calendarDateToRankingInstant({
    year: current.year,
    month: current.month,
    day: 1,
  });
  const nextMonthCivil = new Date(Date.UTC(current.year, current.month, 1));
  const nextMonth = calendarDateToRankingInstant(
    civilUtcToCalendarParts(nextMonthCivil),
  );
  return {
    start,
    end: new Date(nextMonth.getTime() - 1),
  };
}

export function getRankingUtcCustomRange(
  startValue: Date | string,
  endValue: Date | string,
) {
  const start = getRankingUtcStartOfDay(startValue);
  const end = getRankingUtcEndOfDay(endValue);
  return start <= end
    ? { start, end }
    : {
        start: getRankingUtcStartOfDay(endValue),
        end: getRankingUtcEndOfDay(startValue),
      };
}

export function addRankingUtcDays(value: Date, amount: number): Date {
  const civil = calendarDateToCivilUtc(getRankingCalendarDateParts(value));
  civil.setUTCDate(civil.getUTCDate() + amount);
  return calendarDateToRankingInstant(civilUtcToCalendarParts(civil));
}

export function addRankingUtcMonths(value: Date, amount: number): Date {
  const current = getRankingCalendarDateParts(value);
  const civil = new Date(Date.UTC(current.year, current.month - 1 + amount, 1));
  return calendarDateToRankingInstant(civilUtcToCalendarParts(civil));
}

export function buildRankingUtcPeriodKey(
  periodType: RankingCalendarPeriod,
  referenceDate = new Date(),
): string {
  const current = getRankingCalendarDateParts(referenceDate);
  if (periodType === "mes") {
    return `mes_${current.year}-${pad(current.month)}`;
  }

  const start = getRankingUtcWeeklyRange(referenceDate).start;
  const startCalendar = getRankingCalendarDateParts(start);
  return `semana_${startCalendar.year}-${pad(startCalendar.month)}-${pad(startCalendar.day)}`;
}

/**
 * A monthly/weekly ranking post is publishable only after its final business
 * calendar day has ended. Missing period metadata is treated as legacy data
 * and remains visible rather than being hidden speculatively.
 */
export function isRankingPeriodClosed(
  periodType: unknown,
  startValue?: Date | string | number,
  endValue?: Date | string | number,
  referenceDate = new Date(),
): boolean {
  if (periodType !== "mes" && periodType !== "semana") return true;
  if (!startValue && !endValue) return true;

  let end: Date;
  if (endValue) {
    end = getRankingUtcEndOfDay(endValue);
  } else if (periodType === "mes") {
    end = getRankingUtcMonthlyRange(
      getRankingUtcStartOfDay(startValue as Date | string | number),
    ).end;
  } else {
    end = getRankingUtcWeeklyRange(
      getRankingUtcStartOfDay(startValue as Date | string | number),
    ).end;
  }

  return end.getTime() < referenceDate.getTime();
}
