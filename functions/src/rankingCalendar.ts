export const RANKING_TIME_ZONE = "America/Sao_Paulo";
export const RANKING_PERIOD_POLICY = "SAO_PAULO_CALENDAR";

// O Ranking usa o calendário civil oficial de São Paulo para todos os
// usuários. Os limites são persistidos como instantes UTC equivalentes,
// mantendo o Firestore determinístico sem deslocar semanas/meses no cliente.
// O período é elegível no instante seguinte ao fechamento local; não há
// atraso adicional de publicação neste contrato.
export const PUBLICATION_DELAY_MINUTES = 0;
/**
 * Consolidation windows, shared by the callable and the app. A period that started within the recent window is
 * (re)reconciled hourly; a CLOSED period up to the history window is built once and then kept (closed history does not
 * change). Anything older is never scanned: it stays "não consolidado".
 */
export const RANKING_RECENT_WINDOW_DAYS = 70;
export const RANKING_HISTORY_WINDOW_DAYS = 240;

const DAY_MS = 24 * 60 * 60 * 1000;

type CalendarDateParts = {
  year: number;
  month: number;
  day: number;
};

export type RankingPeriodType = "semana" | "mes";

export type RankingPeriodDescriptor = {
  key: string;
  type: RankingPeriodType;
  start: Date;
  end: Date;
  publicationAt: Date;
  label: string;
};

const calendarPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: RANKING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: RANKING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function readPart(parts: Intl.DateTimeFormatPart[], type: string): number {
  return Number(parts.find((part) => part.type === type)?.value || 0);
}

export function getCalendarDateParts(value: Date | string | number): CalendarDateParts {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (isoDate) {
      return {
        year: Number(isoDate[1]),
        month: Number(isoDate[2]),
        day: Number(isoDate[3]),
      };
    }

    const brazilianDate = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(trimmed);
    if (brazilianDate) {
      const rawYear = Number(brazilianDate[3]);
      return {
        year: rawYear < 100 ? 2000 + rawYear : rawYear,
        month: Number(brazilianDate[2]),
        day: Number(brazilianDate[1]),
      };
    }
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { year: 1970, month: 1, day: 1 };
  }

  const parts = calendarPartsFormatter.formatToParts(parsed);
  return {
    year: readPart(parts, "year"),
    month: readPart(parts, "month"),
    day: readPart(parts, "day"),
  };
}

function timeZoneOffsetMs(date: Date): number {
  const parts = dateTimePartsFormatter.formatToParts(date);
  const asUtc = Date.UTC(
    readPart(parts, "year"),
    readPart(parts, "month") - 1,
    readPart(parts, "day"),
    readPart(parts, "hour"),
    readPart(parts, "minute"),
    readPart(parts, "second"),
  );
  return asUtc - date.getTime();
}

export function zonedDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const first = new Date(guess.getTime() - timeZoneOffsetMs(guess));
  return new Date(guess.getTime() - timeZoneOffsetMs(first));
}

export function dateKey(date: Date): string {
  const parts = getCalendarDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function formatDatePt(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: RANKING_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatMonthPt(date: Date): string {
  const label = new Intl.DateTimeFormat("pt-BR", {
    timeZone: RANKING_TIME_ZONE,
    month: "long",
    year: "numeric",
  }).format(date);
  return label.charAt(0).toLocaleUpperCase("pt-BR") + label.slice(1);
}

function civilDateFromParts(parts: CalendarDateParts): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function partsFromCivilDate(date: Date): CalendarDateParts {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function periodBoundsForDate(
  date: Date,
  type: RankingPeriodType,
): RankingPeriodDescriptor {
  const parts = getCalendarDateParts(date);
  let start: Date;
  let end: Date;

  if (type === "semana") {
    const weekday = civilDateFromParts(parts).getUTCDay();
    const startCivil = civilDateFromParts(parts);
    startCivil.setUTCDate(startCivil.getUTCDate() - weekday);
    const startParts = partsFromCivilDate(startCivil);
    const nextCivil = new Date(startCivil.getTime() + 7 * DAY_MS);
    const nextParts = partsFromCivilDate(nextCivil);
    start = zonedDate(startParts.year, startParts.month, startParts.day);
    end = new Date(
      zonedDate(nextParts.year, nextParts.month, nextParts.day).getTime() - 1,
    );
  } else {
    start = zonedDate(parts.year, parts.month, 1);
    const nextMonth = new Date(Date.UTC(parts.year, parts.month, 1));
    const nextParts = partsFromCivilDate(nextMonth);
    end = new Date(
      zonedDate(nextParts.year, nextParts.month, nextParts.day).getTime() - 1,
    );
  }

  const publicationAt = new Date(
    end.getTime() + 1 + PUBLICATION_DELAY_MINUTES * 60 * 1000,
  );
  const key = type === "mes"
    ? `mes_${String(parts.year)}-${String(parts.month).padStart(2, "0")}`
    : `semana_${dateKey(start)}`;
  return {
    key,
    type,
    start,
    end,
    publicationAt,
    label: type === "mes"
      ? formatMonthPt(start)
      : `${formatDatePt(start)} a ${formatDatePt(end)}`,
  };
}

export function periodForDate(
  date: Date,
  type: RankingPeriodType,
  now = new Date(),
): RankingPeriodDescriptor | null {
  const period = periodBoundsForDate(date, type);
  return period.publicationAt.getTime() <= now.getTime() ? period : null;
}

export function periodFromKey(
  type: RankingPeriodType,
  periodKey: string,
): RankingPeriodDescriptor | null {
  if (type === "mes") {
    const match = /^mes_(\d{4})-(\d{2})$/.exec(periodKey);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    const start = zonedDate(year, month, 1);
    return periodBoundsForDate(start, type);
  }

  const match = /^semana_(\d{4})-(\d{2})-(\d{2})$/.exec(periodKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const civil = new Date(Date.UTC(year, month - 1, day));
  if (
    civil.getUTCFullYear() !== year ||
    civil.getUTCMonth() + 1 !== month ||
    civil.getUTCDate() !== day ||
    civil.getUTCDay() !== 0
  ) {
    return null;
  }
  return periodBoundsForDate(zonedDate(year, month, day), type);
}

export function periodsForDate(date: Date): RankingPeriodDescriptor[] {
  return [
    periodBoundsForDate(date, "semana"),
    periodBoundsForDate(date, "mes"),
  ];
}

export function closedPeriodsInRange(
  rangeStart: Date,
  rangeEnd: Date,
  periodTypes: RankingPeriodType[],
  now = new Date(),
): RankingPeriodDescriptor[] {
  const start = getCalendarDateParts(rangeStart);
  const end = getCalendarDateParts(rangeEnd);
  const cursor = civilDateFromParts(start);
  const lastDay = civilDateFromParts(end);
  const byIdentity = new Map<string, RankingPeriodDescriptor>();

  while (cursor.getTime() <= lastDay.getTime()) {
    const cursorParts = partsFromCivilDate(cursor);
    const cursorInstant = zonedDate(cursorParts.year, cursorParts.month, cursorParts.day);
    periodTypes.forEach((type) => {
      const period = periodForDate(cursorInstant, type, now);
      if (period) byIdentity.set(`${period.type}:${period.key}`, period);
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return Array.from(byIdentity.values()).sort(
    (left, right) => left.start.getTime() - right.start.getTime() ||
      left.type.localeCompare(right.type),
  );
}

export function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const timestampLike = value as { toDate?: () => Date; seconds?: unknown; _seconds?: unknown };
  if (typeof timestampLike?.toDate === "function") {
    const date = timestampLike.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  const seconds = Number(timestampLike?.seconds ?? timestampLike?._seconds);
  if (Number.isFinite(seconds)) {
    const date = new Date(seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (dateOnly) {
      return zonedDate(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
    }

    const brazilianDate = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(trimmed);
    if (brazilianDate) {
      const rawYear = Number(brazilianDate[3]);
      return zonedDate(
        rawYear < 100 ? 2000 + rawYear : rawYear,
        Number(brazilianDate[2]),
        Number(brazilianDate[1]),
      );
    }

    const naiveDateTime = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(trimmed);
    if (naiveDateTime) {
      return zonedDate(
        Number(naiveDateTime[1]),
        Number(naiveDateTime[2]),
        Number(naiveDateTime[3]),
        Number(naiveDateTime[4]),
        Number(naiveDateTime[5]),
        Number(naiveDateTime[6] || 0),
      );
    }
  }

  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
}
