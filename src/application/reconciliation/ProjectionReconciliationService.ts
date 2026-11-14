export type ProjectionConsistencyState = {
  history: boolean;
  ranking: boolean;
  senior: boolean;
  operation: boolean;
};

export type ProjectionRepairReport = {
  tripId: string;
  repaired: string[];
  skipped: string[];
};

/**
 * Coordinates projection repair after a canonical trip completion.
 * The concrete writers can be injected by Firebase/server adapters.
 */
export class ProjectionReconciliationService {
  constructor(
    private readonly adapters: {
      history?: (trip: unknown) => Promise<void>;
      ranking?: (trip: unknown) => Promise<void>;
      senior?: (trip: unknown) => Promise<void>;
      operation?: (trip: unknown) => Promise<void>;
    } = {},
  ) {}

  async reconcileCompletedTrip(trip: Record<string, unknown>): Promise<ProjectionRepairReport> {
    const repaired: string[] = [];
    const skipped: string[] = [];

    const steps: Array<[string, ((trip: unknown) => Promise<void>) | undefined]> = [
      ["history", this.adapters.history],
      ["ranking", this.adapters.ranking],
      ["senior", this.adapters.senior],
      ["operation", this.adapters.operation],
    ];

    for (const [name, adapter] of steps) {
      if (!adapter) {
        skipped.push(name);
        continue;
      }
      await adapter(trip);
      repaired.push(name);
    }

    return {
      tripId: String(trip.tripId || trip.id || ""),
      repaired,
      skipped,
    };
  }
}

export const projectionReconciliationService = new ProjectionReconciliationService();
