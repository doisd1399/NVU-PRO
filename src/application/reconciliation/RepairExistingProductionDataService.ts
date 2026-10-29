import type { ProjectionRepairReport } from "./ProjectionReconciliationService";

export type ProductionRepairItem = {
  tripId: string;
  companyId?: string;
  missingProjections: string[];
};

export type ProductionRepairSummary = {
  inspected: number;
  repaired: number;
  missing: string[];
  items: ProductionRepairItem[];
};

/**
 * Coordenador seguro para reparação de dados existentes.
 * Primeiro identifica divergências. A aplicação de escrita deve ser injetada
 * por jobs autorizados (Firebase Functions/admin).
 */
export class RepairExistingProductionDataService {
  constructor(
    private readonly inspector: (cursor?: string) => Promise<Array<Record<string, unknown>>> = async () => [],
    private readonly repairer?: (item: ProductionRepairItem) => Promise<ProjectionRepairReport>,
  ) {}

  async inspect(cursor?: string): Promise<ProductionRepairSummary> {
    const trips = await this.inspector(cursor);
    const items = trips
      .filter((trip) => trip.requiresRepair === true)
      .map((trip) => ({
        tripId: String(trip.tripId || trip.id || ""),
        companyId: String(trip.companyId || "") || undefined,
        missingProjections: Array.isArray(trip.missingProjections)
          ? trip.missingProjections.map(String)
          : [],
      }));

    return {
      inspected: trips.length,
      repaired: 0,
      missing: items.map((item) => item.tripId),
      items,
    };
  }

  async repair(items: ProductionRepairItem[]): Promise<ProductionRepairSummary> {
    let repaired = 0;
    for (const item of items) {
      if (!this.repairer) continue;
      await this.repairer(item);
      repaired += 1;
    }
    return {
      inspected: items.length,
      repaired,
      missing: [],
      items,
    };
  }
}

export const repairExistingProductionDataService =
  new RepairExistingProductionDataService();
