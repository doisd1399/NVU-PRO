import type { NormalizedTrip } from "./tripNormalizer";

export function toProOperationHistoryRows(
  trips: readonly NormalizedTrip[],
  scope: { jobId: string; companyId: string; driverId: string },
) {
  return trips.filter((trip) => Number.isFinite(trip.normalizedValor)).map((trip) => ({
    ...scope,
    tripId: String(trip.canonicalTripId || trip.tripId || trip.id || "").trim(),
    origin: String(trip.origem || trip.origin || "").trim(),
    destination: String(trip.destino || trip.destination || "").trim(),
    amountCents: Math.round(Number(trip.normalizedValor || 0) * 100),
    // Missing/unknown/conflicting currency must stay explicit; inferring BRL
    // here corrupts the financial projection and makes legacy rows look known.
    currency: trip.currencyStatus === "known" && trip.normalizedCurrency
      ? trip.normalizedCurrency
      : "UNKNOWN",
    currencySource: trip.currencySource || "UNKNOWN",
    completedAt: trip.metricDate.getTime(),
  })).filter((trip) => trip.tripId && Number.isFinite(trip.completedAt) && trip.completedAt > 0);
}
