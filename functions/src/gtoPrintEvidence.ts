import { readReceiptAmountCents } from "./receiptAmount";

export type GtoPrintEvidence = {
  version: 1;
  crops: Array<{ cropId: string; text: string }>;
  resultText: string;
};
export type GtoPrintReading = {
  amountCents: number | null;
  currency?: "BRL" | "EUR" | "USD";
  currencyConflict?: boolean;
  reason: "CONTEXT" | "CROP_CONSENSUS" | "LEGACY_CONSENSUS" | "INSUFFICIENT" | "CONFLICT" | "BONUS" | "INVALID_PROTOCOL";
};
const normalize = (raw: string) => raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const cropIds = new Set(["portrait-screen", "portrait-preview", "landscape-nested", "landscape-modal", "landscape-amount"]);
function amounts(raw: string): number[] {
  const tokens = raw.match(/(?<![\w.,])(?:\d{1,3}(?:[., ]\d{3})+|\d+)[.,]\d{2}(?!\d)/g) || [];
  return tokens.map(value => readReceiptAmountCents(value.replace(/\s/g, ""))).filter((v): v is number => v !== null && v > 0 && v <= 1_000_000_000);
}
export function hasAppliedGtoBonus(raw: string): boolean {
  const t = normalize(raw);
  if (/\b(?:valor|ganhos?) (?:foi |foram |ja )?(?:dobrad[oa]s?|duplicad[oa]s?)\b/.test(t)) return true;
  if (/\b(?:anuncio|video)\s+(?:(?:foi|ja foi|esta|ja)\s+)?(?:assistid|concluid|finalizad)[oa]s?\b/.test(t) ||
      /\b(?:assistid|concluid|finalizad)[oa]s?\s+(?:o |ao )?(?:anuncio|video)\b/.test(t) ||
      /\b(?:bonus|recompensa)\b.{0,45}\b(?:recebid|aplicad|concedid|creditad)[oa]s?\b/.test(t) ||
      /\b(?:recebid|aplicad|concedid|creditad)[oa]s?\b.{0,45}\b(?:bonus|recompensa)\b/.test(t)) return true;
  return [...t.matchAll(/bonus\s+(?:video\s+)?ads\s*:?\s*(?:r\$\s*)?([0-9][0-9.,]*)/g)]
    .some(match => (readReceiptAmountCents(match[1]) || 0) > 0);
}

/** One pure contract used by OCR and the server. No amount is taken from a
 * caller-provided numeric field. The normal ADS offer is not an applied bonus. */
export function readGtoPrintEvidence(raw: unknown, evidence?: unknown): GtoPrintReading {
  const fail = (reason: GtoPrintReading["reason"]): GtoPrintReading => ({ amountCents: null, reason });
  if (typeof raw !== "string" || raw.length > 20_000) return fail("INVALID_PROTOCOL");
  let crops: GtoPrintEvidence["crops"] = [], resultText = "";
  if (evidence !== undefined && evidence !== null) {
    const e = evidence as GtoPrintEvidence;
    if (!e || e.version !== 1 || !Array.isArray(e.crops) || e.crops.length > 10 ||
        typeof e.resultText !== "string" || e.resultText.length > 5000 ||
        e.crops.some(c => !c || !cropIds.has(c.cropId) || typeof c.text !== "string" || c.text.length > 1500)) return fail("INVALID_PROTOCOL");
    crops = e.crops; resultText = e.resultText;
  }
  const texts = [...new Set([raw, ...crops.map(c => c.text), resultText])];
  if (texts.some(hasAppliedGtoBonus)) return fail("BONUS");
  const accept = (amountCents: number, reason: GtoPrintReading["reason"]): GtoPrintReading => {
    const currencies = new Set<"BRL" | "EUR" | "USD">();
    for (const text of texts) {
      for (const match of text.toUpperCase().matchAll(/(R\s*\$|BRL|US\s*\$|USD|EUR|€)\s*((?:\d{1,3}(?:[., ]\d{3})+|\d+)[.,]\d{2})(?!\d)/g)) {
        if (readReceiptAmountCents(match[2].replace(/\s/g, "")) !== amountCents) continue;
        currencies.add(/^(R\s*\$|BRL)$/.test(match[1]) ? "BRL" : /^(EUR|€)$/.test(match[1]) ? "EUR" : "USD");
      }
    }
    return { amountCents, reason, ...(currencies.size === 1 ? { currency: [...currencies][0] } : currencies.size > 1 ? { currencyConflict: true } : {}) };
  };
  const contextual = new Set<number>();
  for (const text of texts) {
    const t = normalize(text);
    for (const match of t.matchAll(/valor\s*(?:a\s*)?receber\s*[:=\-]?\s*(?:r\s*[$s5]?\s*)?([^a-z]{0,60})/g)) {
      const found = amounts(match[1]);
      found.forEach(amount => contextual.add(amount));
    }
  }
  if (contextual.size > 1) return fail("CONFLICT");
  if (contextual.size === 1) return accept([...contextual][0], "CONTEXT");
  const result = normalize(resultText || raw);
  if (!/\b(?:concluid[oa]|finalizad[oa])\b/.test(result) || !/\breceber\b/.test(result)) return fail("INSUFFICIENT");
  if (evidence !== undefined && evidence !== null) {
    const votes = new Map<number, Set<string>>();
    for (const crop of crops) {
      const candidates = [...new Set(amounts(crop.text))];
      if (candidates.length !== 1) continue;
      const set = votes.get(candidates[0]) || new Set<string>(); set.add(crop.cropId); votes.set(candidates[0], set);
    }
    const winners = [...votes].filter(([, ids]) => ids.size >= 2);
    if (winners.length !== 1 || [...votes.keys()].some(cents => cents !== winners[0][0])) return fail(winners.length ? "CONFLICT" : "INSUFFICIENT");
    return accept(winners[0][0], "CROP_CONSENSUS");
  }
  // Older clients stored the concatenated crop transcripts. Recover only a
  // repeated, unambiguous monetary reading plus explicit result-screen copy.
  const legacy = amounts(raw), unique = [...new Set(legacy)];
  if (legacy.length >= 2 && unique.length === 1) return accept(unique[0], "LEGACY_CONSENSUS");
  return fail(unique.length > 1 ? "CONFLICT" : "INSUFFICIENT");
}
