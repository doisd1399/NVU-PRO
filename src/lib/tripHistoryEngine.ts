import {
  getMonthlyRange,
  getTodayRange,
  getWeeklyRange,
} from "./metricsEngine";
import { normalizeTrip, NormalizedTrip } from "./tripNormalizer";
import {
  getCanonicalTripDriverId,
  getCanonicalTripDriverName,
} from "./tripIdentity";

export type TripHistoryPeriodPreset =
  | "todos"
  | "hoje"
  | "semana"
  | "7dias"
  | "mes"
  | "data";

export interface TripHistoryFilterInput {
  periodPreset?: TripHistoryPeriodPreset | string;
  customStartDate?: string;
  customEndDate?: string;
  driverId?: string;
  driverName?: string;
  embeddedJob?: any;
}

function safeTimestamp(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if ((value as any)?.toDate) return (value as any).toDate().getTime();
  if ((value as any)?.seconds) return Number((value as any).seconds) * 1000;
  const parsed = new Date((value as any) || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveRange(input: TripHistoryFilterInput): {
  startDate?: Date;
  endDate?: Date;
} {
  if (input.periodPreset === "hoje") {
    const { start, end } = getTodayRange();
    return { startDate: start, endDate: end };
  }

  if (input.periodPreset === "semana" || input.periodPreset === "7dias") {
    const { start, end } = getWeeklyRange();
    return { startDate: start, endDate: end };
  }

  if (input.periodPreset === "mes") {
    const { start, end } = getMonthlyRange();
    return { startDate: start, endDate: end };
  }

  if (input.periodPreset === "data") {
    const startDate = input.customStartDate
      ? new Date(`${input.customStartDate}T00:00:00.000Z`)
      : undefined;
    const endDate = input.customEndDate
      ? new Date(`${input.customEndDate}T23:59:59.999Z`)
      : undefined;
    return { startDate, endDate };
  }

  return {};
}

function belongsToEmbeddedJob(trip: NormalizedTrip, embeddedJob: any): boolean {
  if (!embeddedJob) return true;

  if ((trip as any).jobId && (trip as any).jobId === embeddedJob.id) {
    return true;
  }

  const tripContractId =
    trip.contratoId || (trip as any).contractId || (trip as any).contrato_id;
  if (tripContractId !== embeddedJob.contractId) return false;
  if (getCanonicalTripDriverId(trip) !== embeddedJob.driverId) return false;

  const tripTime = trip.metricDate.getTime();
  const assignedAt = safeTimestamp(embeddedJob.assignedAt);
  const completedAt = embeddedJob.completedAt
    ? safeTimestamp(embeddedJob.completedAt)
    : Date.now() + 86_400_000;

  return tripTime >= assignedAt && tripTime <= completedAt;
}

/**
 * Canonical dataset for the trip-history screen.
 *
 * The same validity rule, metric date and value normalization used by ranking
 * are applied here before counting, summing, ordering or paginating. This
 * prevents the visible first page (30 rows) from being mistaken for the total.
 */
export function filterAndSortTripHistory(
  trips: any[],
  input: TripHistoryFilterInput,
): NormalizedTrip[] {
  const { startDate, endDate } = resolveRange(input);
  const normalizedDriverName = String(input.driverName || "").trim().toLowerCase();

  return trips
    .map((trip) => normalizeTrip(trip))
    .filter((trip) => {
      if (!trip.isValid) return false;
      if (!belongsToEmbeddedJob(trip, input.embeddedJob)) return false;

      if (
        input.driverId &&
        getCanonicalTripDriverId(trip) !== String(input.driverId).trim()
      ) {
        return false;
      }
      if (
        !input.driverId &&
        normalizedDriverName &&
        (getCanonicalTripDriverName(trip) || "").toLowerCase() !==
          normalizedDriverName
      ) {
        return false;
      }

      if (startDate && trip.metricDate < startDate) return false;
      if (endDate && trip.metricDate > endDate) return false;
      return true;
    })
    .sort((a, b) => b.metricDate.getTime() - a.metricDate.getTime());
}

export function summarizeTripHistory(trips: NormalizedTrip[]) {
  return {
    totalViagens: trips.length,
    faturamentoTotal: trips.reduce(
      (total, trip) => total + trip.normalizedValor,
      0,
    ),
  };
}

export function getTripDisplayDate(trip: any): Date {
  return normalizeTrip(trip).metricDate;
}
