import {
  getMonthlyRange,
  getTodayRange,
  getWeeklyRange,
  safeSingleCurrencyRevenue,
} from "./metricsEngine";
import { normalizeTrip, NormalizedTrip } from "./tripNormalizer";
import { summarizeTripMoney } from "./tripMoneySummary";
import { isPendingHistoryTrip } from "./pendingHistoryTrips";
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
  includePending?: boolean;
  periodPreset?: TripHistoryPeriodPreset | string;
  customStartDate?: string;
  customEndDate?: string;
  driverId?: string;
  driverName?: string;
  embeddedJob?: any;
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

export function belongsToEmbeddedJob(trip: NormalizedTrip, embeddedJob: any): boolean {
  if (!embeddedJob) return true;

  const tripJobId = String((trip as any).jobId || (trip as any).trabalhoId || "").trim();
  const embeddedJobId = String(embeddedJob.id || "").trim();
  // A row without a physical job binding is legacy-unbound. It may remain in
  // general history, but it is never auto-attached to the current execution.
  if (!tripJobId || !embeddedJobId || tripJobId !== embeddedJobId) return false;
  const tripDriverId = getCanonicalTripDriverId(trip);
  if (tripDriverId !== String(embeddedJob.driverId || embeddedJob.motoristaId || "").trim()) return false;
  const tripCompanyId = String((trip as any).companyId || trip.empresaId || "").trim();
  const jobCompanyId = String(embeddedJob.companyId || embeddedJob.empresaId || "").trim();
  if (tripCompanyId !== jobCompanyId) return false;
  const tripContractId = String(trip.contratoId || (trip as any).contractId || (trip as any).contrato_id || "").trim();
  return tripContractId === String(embeddedJob.contractId || embeddedJob.contratoId || "").trim();
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
      if (!trip.isValid && !(input.includePending && isPendingHistoryTrip(trip))) return false;
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
  const confirmed = trips.filter(trip => trip.isValid);
  const moneyGroups = summarizeTripMoney(confirmed);
  return {
    totalViagens: confirmed.length,
    faturamentoTotal: safeSingleCurrencyRevenue(moneyGroups),
    moneyGroups,
  };
}

export function getTripDisplayDate(trip: any): Date {
  return normalizeTrip(trip).metricDate;
}
