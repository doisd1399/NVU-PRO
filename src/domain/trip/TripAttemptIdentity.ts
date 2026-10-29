import { resolveTripCurrency } from "../../../functions/src/tripCurrencyResolver";
const text = (v: unknown) => String(v ?? "").trim();
type TripLike = Record<string, unknown>;
/** Capture identity excludes upload pointers and server-enriched projections. */
export function tripAttemptConflictFields(existing: TripLike, input: TripLike): string[] {
  const fields = ["driverId", "companyId", "jobId", "contractId", "idempotencyKey", "imageHash", "simpleReceiptHash", "origem", "destino",
    "simpleReceiptCapturedAt", "simpleReceiptCaptureAttemptId", "simpleReceiptCaptureContextEpoch"];
  const conflicts = fields.filter(key => text(existing[key]) !== text(input[key]));
  const cents = (trip: TripLike) => Number(trip.valorCents ?? Math.round(Number(trip.valor ?? trip.earnings) * 100));
  if (!Number.isSafeInteger(cents(input)) || cents(existing) !== cents(input)) conflicts.push("valorCents");
  if (input.valor != null && (!Number.isFinite(Number(input.valor)) || Math.round(Number(input.valor) * 100) !== cents(input))) conflicts.push("valor");
  const a = resolveTripCurrency(existing), b = resolveTripCurrency(input);
  if ((a.currencyStatus === "known" && b.currencyStatus === "known" && a.currency !== b.currency) ||
      (b.currencyStatus === "conflict") ||
      (["currency", "moeda", "moneyCurrency", "receiptCurrency", "simpleReceiptCurrency"].some(k => text(input[k])) && b.currencyStatus !== "known")) conflicts.push("currency");
  // Without a content hash, a receipt reference remains part of the identity.
  if (!text(input.imageHash) && text(existing.offlineReceiptKey) !== text(input.offlineReceiptKey)) conflicts.push("offlineReceiptKey");
  return conflicts;
}
export function assertSameTripAttempt(existing: TripLike, input: TripLike): void {
  const fields = tripAttemptConflictFields(existing, input);
  if (fields.length) throw Object.assign(new Error("CANONICAL_TRIP_ATTEMPT_CONFLICT"), {
    code: "CANONICAL_TRIP_ATTEMPT_CONFLICT", tripSyncStage: "LOCAL_COMMIT",
    tripId: text(existing.physicalDocumentId || existing.canonicalTripId || existing.tripId),
    locallySaved: true, conflictFields: fields,
  });
}
