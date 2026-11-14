import { CanonicalTrip } from "../../../domain/trip/CanonicalTrip";

/**
 * Contrato único para persistência de viagens.
 * A implementação concreta pode usar Firebase, banco local ou sincronização.
 */
export interface CanonicalTripPersistenceGateway {
  save(trip: CanonicalTrip): Promise<CanonicalTrip>;
  update(trip: CanonicalTrip): Promise<CanonicalTrip>;
  remove(tripId: string, actorUserId?: string): Promise<void>;
}
