export type RankingRepairResult = {
  companyId: string;
  rebuilt: boolean;
  reason?: string;
};

export class RankingProjectionRepairService {
  async inspectCompanyAggregate(companyId: string, aggregateExists: boolean): Promise<RankingRepairResult> {
    if (aggregateExists) {
      return { companyId, rebuilt: false };
    }

    return {
      companyId,
      rebuilt: true,
      reason: "ranking aggregate missing; rebuild required from canonical history",
    };
  }
}

export const rankingProjectionRepairService = new RankingProjectionRepairService();
