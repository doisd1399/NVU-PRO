import { getTripMetricDate } from "./tripNormalizer";
import {
  getCanonicalTripCompanyId,
  getCanonicalTripDriverId,
} from "./tripIdentity";

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function getTripIdentity(trip: any, fallbackIndex: number): string {
  const explicitId = trip?.id || trip?.tripId || trip?.documentId;
  if (hasValue(explicitId)) return `id:${String(explicitId)}`;

  const receiptUrl =
    trip?.comprovanteUrl || trip?.receiptUrl || trip?.imageUrl || trip?.comprovante;
  if (hasValue(receiptUrl)) return `receipt:${String(receiptUrl)}`;

  const metricTime = getTripMetricDate(trip).getTime();
  return [
    "legacy",
    getCanonicalTripCompanyId(trip) || "",
    getCanonicalTripDriverId(trip) || "",
    trip?.jobId || trip?.trabalhoId || "",
    trip?.contractId || trip?.contratoId || "",
    Number.isFinite(metricTime) ? metricTime : "no-date",
    trip?.valor ?? trip?.value ?? "",
    fallbackIndex,
  ].join(":");
}

function mergeDefinedFields(base: any, incoming: any) {
  const merged = { ...base };
  Object.entries(incoming || {}).forEach(([key, value]) => {
    if (hasValue(value)) merged[key] = value;
  });
  return merged;
}

/**
 * Reconciles overlapping trip sources without double-counting documents.
 * The profile receives the complete active-company history while ranking uses
 * a bounded completedAt query. Merging both sources keeps KPIs and ranking
 * aligned with Trip History, including legacy/transitional documents.
 */
export function mergeTripDatasets(...datasets: Array<any[] | null | undefined>) {
  const merged = new Map<string, any>();
  let fallbackIndex = 0;

  datasets.forEach((dataset) => {
    (dataset || []).forEach((trip) => {
      if (!trip || typeof trip !== "object") return;
      const key = getTripIdentity(trip, fallbackIndex++);
      const current = merged.get(key);
      merged.set(key, current ? mergeDefinedFields(current, trip) : trip);
    });
  });

  return Array.from(merged.values());
}

export function mergeTripDatasetsInInterval(
  startDate: Date,
  endDate: Date,
  ...datasets: Array<any[] | null | undefined>
) {
  const start = startDate.getTime();
  const end = endDate.getTime();

  return mergeTripDatasets(...datasets).filter((trip) => {
    const time = getTripMetricDate(trip).getTime();
    return Number.isFinite(time) && time >= start && time <= end;
  });
}
