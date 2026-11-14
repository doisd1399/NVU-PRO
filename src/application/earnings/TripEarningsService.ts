import { EarningsExtractionResult } from '../../domain/earnings/EarningsExtractionResult';

export interface TripEarningsSummary {
  gross: number;
  cacheValue: number;
  commission: number;
}

export class TripEarningsService {
  calculate(result: EarningsExtractionResult, commission = 0): TripEarningsSummary {
    const gross = Number(result.earnings || 0);
    return {
      gross,
      cacheValue: Math.max(0, gross - commission),
      commission,
    };
  }
}
