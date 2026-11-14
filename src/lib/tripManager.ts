/**
 * Single entry point for Print/Pro trip persistence.
 *
 * The UI must not decide if a trip belongs to Firestore, offline queue or
 * history. This coordinator creates one durable local state first and leaves
 * synchronization to the repository layer.
 */
export type ManagedTripState =
  | "CREATED_LOCAL"
  | "SYNC_PENDING"
  | "SYNCED"
  | "PENDING_VALIDATION"
  | "DELETED";

export type ManagedTripResult = {
  state: ManagedTripState;
  payload: Record<string, any>;
};

const normalizeTripEarnings = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return Number(value.toFixed(2));
  if (typeof value !== "string") return value;
  const normalized = value.replace(/[^0-9,.-]/g, "").replace(/,/g, ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : value;
};

const hasTripIdentity = (payload: Record<string, any>) =>
  Boolean(payload.tripId || payload.idempotencyKey || payload.clientRequestId);

export class TripManager {
  static prepare(payload: Record<string, any>): ManagedTripResult {
    const now = new Date().toISOString();
    const sourcePayload = { ...payload };
    if (!hasTripIdentity(sourcePayload)) {
      sourcePayload.clientRequestId = `trip-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    const idempotencyKey = String(
      sourcePayload.idempotencyKey || sourcePayload.clientRequestId || `trip-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    const earnings = sourcePayload.earnings ?? sourcePayload.ganhos ?? sourcePayload.valor ?? sourcePayload.cache;

    return {
      state: "CREATED_LOCAL",
      payload: {
        ...sourcePayload,
        ...(earnings !== undefined ? { earnings: normalizeTripEarnings(earnings) } : {}),
        idempotencyKey,
        clientRequestId: idempotencyKey,
        tripId: String(payload.tripId || idempotencyKey),
        tripState: "CREATED_LOCAL",
        // A new trip starts locally. The sync layer is responsible for moving
        // it to SERVER_CONFIRMED/VALIDATED only after backend ACK.
        syncStatus: "PENDING_SYNC",
        validationStatus: "PENDING_VALIDATION",
        deleted: false,
        createdAtLocal: payload.createdAtLocal || now,
        completedAtLocal: payload.completedAtLocal || now,
      },
    };
  }
}
