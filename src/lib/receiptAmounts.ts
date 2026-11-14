/**
 * Valor de um comprovante de pagamento (Pix) a partir do texto lido na imagem.
 * Aceita "R$ 1.234,56", "RS 250,00" (o OCR troca $ por S) e números soltos com vírgula e dois decimais.
 * Datas, horários, CPF/CNPJ e códigos não têm vírgula + 2 casas, então não entram.
 */
const AMOUNT = /(?:R\s?[$S5]\s*)?(\d{1,3}(?:[.\s]\d{3})+|\d+),(\d{2})(?!\d)/gi;

export type ReceiptReading = { candidates: number[]; best: number | null };

/** Todos os valores em centavos que aparecem no texto (sem repetir), e o mais provável (o primeiro depois de "Valor"; senão o primeiro). */
export function readReceiptAmounts(text: string): ReceiptReading {
  const clean = String(text || "").replace(/ /g, " ");
  const all: { cents: number; index: number }[] = [];
  for (const match of clean.matchAll(AMOUNT)) {
    const whole = match[1].replace(/[.\s]/g, ""), cents = Number(whole) * 100 + Number(match[2]);
    if (Number.isSafeInteger(cents) && cents > 0 && cents <= 100_000_000_000) all.push({ cents, index: match.index ?? 0 });
  }
  const candidates = [...new Set(all.map(item => item.cents))];
  if (!candidates.length) return { candidates, best: null };
  const keyword = clean.search(/\bvalor\b/i), afterKeyword = keyword >= 0 ? all.find(item => item.index >= keyword) : undefined;
  return { candidates, best: (afterKeyword || all[0]).cents };
}

/** Confere a leitura com o valor esperado: "verified" (algum valor lido é o esperado), "different" (leu valores, nenhum é o esperado) ou "unread". */
export function checkReceiptAmount(reading: ReceiptReading, expectedCents: number): { check: "verified" | "different" | "unread"; readCents: number | null } {
  if (reading.candidates.includes(expectedCents)) return { check: "verified", readCents: expectedCents };
  return reading.best === null ? { check: "unread", readCents: null } : { check: "different", readCents: reading.best };
}
