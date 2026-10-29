import { EarningsExtractionResult } from '../../domain/earnings/EarningsExtractionResult';

export class EarningsExtractor {
  extract(raw: string, source = 'OCR'): EarningsExtractionResult {
    const normalized = raw
      .replace(/R\$/gi, '')
      .replace(/\s/g, '')
      .replace(/\.(?=\d{3}(\D|$))/g, '')
      .replace(',', '.');

    const value = Number.parseFloat(normalized);

    return {
      earnings: Number.isFinite(value) ? value : 0,
      confidence: Number.isFinite(value) ? 1 : 0,
      source,
      rawValue: raw,
    };
  }
}
