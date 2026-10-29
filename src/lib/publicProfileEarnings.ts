export type PublicEarningsCoverage = "unknown" | "complete" | "partial";
export type PublicEarningsCurrencyStatus = "known" | "unknown" | "missing" | "conflict";

export interface PublicEarningsTrip {
  eligible: boolean;
  value: number;
  currency?: string;
  currencyStatus?: PublicEarningsCurrencyStatus;
}

export function formatPublicEarnings(trips: PublicEarningsTrip[], coverage: PublicEarningsCoverage): string {
  const eligible = trips.filter((trip) => trip.eligible);
  const currencies = new Set(eligible
    .filter((trip) => trip.currencyStatus === "known" && trip.currency)
    .map((trip) => trip.currency as string));
  const missingCurrency = eligible.some((trip) => trip.currencyStatus === "missing");
  const conflictingCurrency = eligible.some((trip) => trip.currencyStatus === "conflict");
  const unknownCurrency = eligible.some((trip) => trip.currencyStatus === "unknown");
  const coverageLabel = coverage === "complete"
    ? "cobertura completa"
    : coverage === "partial" ? "cobertura parcial" : "cobertura não verificada";
  const evidence = `${eligible.length} viagens; ${coverageLabel}`;

  if (currencies.size > 1) return `Moedas distintas (${Array.from(currencies).sort().join("/")}); sem soma · ${evidence}`;
  if (conflictingCurrency) return `Moedas conflitantes; valores não comparados · ${evidence}`;
  if (missingCurrency && unknownCurrency) return `Moedas ausentes/desconhecidas; valores não somados · ${evidence}`;
  if (missingCurrency) return `Moeda ausente; valor não comparado · ${evidence}`;
  if (unknownCurrency) return `Moeda desconhecida; valor não comparado · ${evidence}`;
  if (currencies.size !== 1) return `Sem moeda conhecida para somar · ${evidence}`;

  const currency = Array.from(currencies)[0]!;
  const total = eligible.reduce((sum, trip) => sum + trip.value, 0);
  try {
    return `${total.toLocaleString("pt-BR", { style: "currency", currency })} (${currency}; ${evidence})`;
  } catch {
    return `Moeda desconhecida · ${evidence}`;
  }
}
