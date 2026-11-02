/** SDK evidence is client-reported, never an anti-cheat attestation. */
export type ScsDelivery = {
  version: 1; type: "job.delivered"; eventId: string; simulatorKey: "ets2" | "ats";
  capturedAt: number; origin: string; destination: string; amountCents: number;
  currency: "EUR" | "USD"; distanceKm: number;
};
export function validateScsDelivery(value: unknown): ScsDelivery {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("SCS_EVIDENCE_REQUIRED");
  const e = value as ScsDelivery;
  const allowed = ["version", "type", "eventId", "simulatorKey", "capturedAt", "origin", "destination", "amountCents", "currency", "distanceKm"];
  if (Object.keys(e).some(k => !allowed.includes(k)) || e.version !== 1 || e.type !== "job.delivered"
    || !["ets2", "ats"].includes(e.simulatorKey) || !/^[a-f0-9-]{36}$/.test(e.eventId)
    || !Number.isSafeInteger(e.capturedAt) || e.capturedAt <= 0 || e.capturedAt > Date.now() + 300000
    || typeof e.origin !== "string" || typeof e.destination !== "string" || !e.origin.trim() || !e.destination.trim()
    || e.origin.length > 180 || e.destination.length > 180 || e.origin.trim().toLowerCase() === e.destination.trim().toLowerCase()
    || !Number.isSafeInteger(e.amountCents) || e.amountCents <= 0 || e.amountCents > 1000000000
    || !Number.isFinite(e.distanceKm) || e.distanceKm <= 0 || e.distanceKm > 50000
    || e.currency !== (e.simulatorKey === "ets2" ? "EUR" : "USD")) throw Error("SCS_EVIDENCE_INVALID");
  return e;
}
export function assertScsTrip(trip: Record<string, any>, uid: string): ScsDelivery {
  const e = validateScsDelivery(trip.scsTelemetry);
  const id = `scs_${uid}_${e.simulatorKey}_${e.eventId}`;
  if (trip.source !== "PRO_WINDOWS_SCS" || trip.simpleAutomation === true || trip.gtoEntryMode
    || trip.simulatorKey !== e.simulatorKey || trip.simulatorCode !== e.simulatorKey.toUpperCase()
    || trip.valorCents !== e.amountCents || trip.valor !== e.amountCents / 100
    || trip.origem !== e.origin || trip.destino !== e.destination || trip.currency !== e.currency
    || trip.distanciaPercorrida !== e.distanceKm || trip.idempotencyKey !== id
    || (trip.canonicalTripId || trip.tripId || trip.deterministicTripId) !== id)
    throw Error("SCS_TRIP_EVIDENCE_MISMATCH");
  return e;
}
