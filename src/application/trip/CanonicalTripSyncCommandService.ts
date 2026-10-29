import { syncEngine } from "../../services/sync/SyncEngine";

/**
 * Porta única para comandos de sincronização.
 */
export class CanonicalTripSyncCommandService {
  async synchronize() {
    return syncEngine.synchronize();
  }

  pending() {
    return syncEngine.getPending();
  }
}

export const canonicalTripSyncCommandService =
  new CanonicalTripSyncCommandService();
