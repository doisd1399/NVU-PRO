export interface EarningsExtractionResult {
  earnings: number;
  confidence: number;
  source: string;
  rawValue?: string;
}
