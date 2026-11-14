import { parseTripMoneyRecord, resolveTripCurrency, type TripCurrencyStatus } from "./tripNormalizer";

export function formatHistoryMoney(value: number | null, currency?: string, status?: TripCurrencyStatus): string {
  const resolved = resolveTripCurrency({ currency });
  const effectiveStatus = status || resolved.currencyStatus;
  if (effectiveStatus === "conflict") return "Moedas conflitantes · valor não comparado";
  if (effectiveStatus === "missing") return "Moeda ausente · valor não comparado";
  if (effectiveStatus === "unknown" || resolved.currencyStatus !== "known") return "Moeda desconhecida · valor não comparado";
  if (value === null || !Number.isFinite(value)) return "Valor indisponível";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: resolved.currency! }).format(value);
}

/** Read presentation only; backend financial policy is deliberately unchanged. */
export function formatTripHistoryMoney(trip: Record<string, unknown>, proposedValue?: number): string {
  const money = parseTripMoneyRecord(trip);
  const amount = proposedValue ?? (money.amountSource ? money.amount : null);
  if (money.currencyStatus !== "known" && amount !== null && Number.isFinite(amount)) {
    const nominal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
    const label = money.currencyStatus === "conflict" ? "Moedas conflitantes"
      : money.currencyStatus === "unknown" ? "Moeda desconhecida" : "Moeda ausente";
    return `${nominal} · ${label} · fora do total de ganhos`;
  }
  return formatHistoryMoney(amount, money.currency, money.currencyStatus);
}
