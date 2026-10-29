import { TripManager } from "../lib/tripManager";

export type TripRegistrationResult<T> = {
  payload: Record<string, unknown>;
  reference: T;
};

/**
 * Single entry point for Print/Pro trip registration.
 * UI flows should not create trip payloads directly anymore.
 */
export async function registerTripThroughManager<T>(input: {
  tripData: Record<string, unknown>;
  idempotencyKey: string;
  addTrip: (payload: Record<string, unknown>) => Promise<T>;
}): Promise<TripRegistrationResult<T>> {
  const managed = TripManager.prepare({
    ...input.tripData,
    idempotencyKey: input.idempotencyKey,
    tripState: input.tripData.tripState || "REGISTERED_LOCAL",
  });

  const reference = await input.addTrip(managed.payload);

  return {
    payload: managed.payload,
    reference,
  };
}
