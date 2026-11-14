import {
  getRankingCalendarDateParts,
  getRankingUtcCustomRange,
  getRankingUtcMonthlyRange,
  getRankingUtcWeeklyRange,
} from "./rankingPeriods";

export type RankingPeriodPreset = "semana" | "mes" | "custom";
export type RankingPickerRange = { from: Date | undefined; to?: Date };
export type RankingPeriodSelection = { preset: RankingPeriodPreset; startDate: string; endDate: string };
const pad = (value: number) => String(value).padStart(2, "0");

/** Calendar widgets return device-local civil dates, not ranking instants. */
export function rankingPickerDateKey(date: Date): string {
  return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function rankingPickerDateFromKey(key: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return undefined;
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  return rankingPickerDateKey(date) === key ? date : undefined;
}

export function rankingPickerBusinessDate(instant: Date): Date {
  const { year, month, day } = getRankingCalendarDateParts(instant);
  return new Date(year, month - 1, day, 12);
}

export function rankingPeriodPickerRange(
  preset: RankingPeriodPreset, startDate: string, endDate: string, referenceDate: Date,
): RankingPickerRange {
  const validCustom = rankingPickerDateFromKey(startDate) && rankingPickerDateFromKey(endDate);
  const range = preset === "semana" ? getRankingUtcWeeklyRange(referenceDate)
    : preset === "custom" && validCustom ? getRankingUtcCustomRange(startDate, endDate)
    : getRankingUtcMonthlyRange(referenceDate);
  return { from: rankingPickerBusinessDate(range.start), to: rankingPickerBusinessDate(range.end) };
}

/** Emit inclusive civil keys; the existing ranking query owns São Paulo bounds. */
export function rankingPeriodSelectionFromPicker(
  range: RankingPickerRange, preset: RankingPeriodPreset,
): RankingPeriodSelection | null {
  if (!range.from || !range.to) return null;
  const keys = [rankingPickerDateKey(range.from), rankingPickerDateKey(range.to)].sort();
  if (!keys.every(key => rankingPickerDateFromKey(key))) return null;
  return { preset, startDate: keys[0], endDate: keys[1] };
}
