import { readReceiptAmountCents } from "./tripReceiptPolicy";

/** The ADS button is an offer. Only an applied bonus invalidates the receipt. */
export function readGtoReceiptAmountCents(raw: string): number | null {
  const normalized = raw.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/(?:VALOR\s+(?:DOBRADO|DUPLICADO)|ANUNCIO\s+ASSISTIDO|BONUS\s+(?:APLICADO|RECEBIDO))/.test(normalized)) return null;
  const bonus = [...normalized.matchAll(/BONUS\s+(?:VIDEO\s+)?ADS\s*:?\s*(?:R\$\s*)?([0-9][0-9.,]*)/g)];
  if (bonus.some((match) => Number(match[1].replace(/\./g, "").replace(",", ".")) > 0)) return null;
  const matches = [...normalized.matchAll(/VALOR\s+A\s+RECEBER[^0-9]{0,60}([0-9][0-9.,]*)/g)];
  if (!matches.length) return null;
  const amounts = matches.map((match) => {
    const cents = readReceiptAmountCents(match[1]);
    return cents !== null && cents > 0 ? cents : null;
  });
  return amounts.every((value) => value !== null && value === amounts[0]) ? amounts[0] : null;
}
