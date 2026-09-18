import { getTripMetricDate } from "./tripNormalizer";

export const TRIP_RECEIPT_RETENTION_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;

function toMillis(value: any): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (value?.seconds != null) return Number(value.seconds) * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getTripReceiptReferenceTime(trip: any): number {
  const uploadedAt = toMillis(trip?.uploadedAt);
  if (uploadedAt > 0) return uploadedAt;

  const metricTime = getTripMetricDate(trip).getTime();
  return Number.isFinite(metricTime) && metricTime > 0 ? metricTime : 0;
}

export function isTripReceiptExpired(
  trip: any,
  nowMs: number = Date.now(),
): boolean {
  const referenceTime = getTripReceiptReferenceTime(trip);
  if (referenceTime <= 0) return false;
  return nowMs - referenceTime >= TRIP_RECEIPT_RETENTION_DAYS * DAY_MS;
}

export function shouldLoadTripReceipt(trip: any, nowMs: number = Date.now()): boolean {
  const url = String(trip?.comprovanteUrl || "").trim();
  return Boolean(url) && !isTripReceiptExpired(trip, nowMs);
}
