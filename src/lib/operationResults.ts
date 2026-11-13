import { parseTripMoneyRecord, type TripCurrencyStatus } from "./tripNormalizer";

export type OperationResultEntry = { n: number; at: number; cents: number };
export type OperationResults = {
  /** Moeda dos ganhos exibidos (a mais comum entre as viagens com moeda conhecida). */
  currency?: string; currencyStatus: TripCurrencyStatus;
  trips: number; required: number;
  /** Execução da operação: viagens feitas ÷ viagens previstas (uma operação comum não tem meta de ganhos). */
  percent: number;
  earningsCents: number; averageCents: number; bestCents: number; bestN: number;
  entries: OperationResultEntry[]; bars: { n: number; cents: number; height: number }[];
  /** Viagens sem valor ou de outra moeda: contam como viagem feita, mas ficam fora dos ganhos. */
  outsideTotals: number;
};

const toMs = (value: unknown): number => {
  const v = value as { toMillis?: () => number; seconds?: number } | null;
  if (v && typeof v.toMillis === "function") return v.toMillis();
  if (v && typeof v.seconds === "number") return v.seconds * 1000;
  if (typeof value === "number") return value;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const tripAtMs = (trip: Record<string, unknown>) => toMs(trip.completedAt) || toMs(trip.dataLancamento) || toMs(trip.createdAt) || toMs(trip.data) || toMs(trip.dataISO);

/** Resultados de uma operação comum: ganho por viagem, média, melhor viagem e % de execução (viagens feitas ÷ previstas). */
export function buildOperationResults(trips: Record<string, unknown>[], required: number): OperationResults {
  const ordered = trips.map(trip => ({ money: parseTripMoneyRecord(trip), at: tripAtMs(trip) })).sort((a, b) => a.at - b.at);
  const counts = new Map<string, number>();
  for (const row of ordered) if (row.money.currencyStatus === "known" && row.money.currency && row.money.amountCents !== null) counts.set(row.money.currency, (counts.get(row.money.currency) || 0) + 1);
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const entries: OperationResultEntry[] = [];
  ordered.forEach((row, index) => { if (currency && row.money.currencyStatus === "known" && row.money.currency === currency && row.money.amountCents !== null) entries.push({ n: index + 1, at: row.at, cents: row.money.amountCents }); });
  const earningsCents = entries.reduce((sum, entry) => sum + entry.cents, 0);
  const best = entries.reduce((top, entry) => entry.cents > top.cents ? entry : top, { n: 0, at: 0, cents: 0 });
  const max = Math.max(1, ...entries.map(entry => entry.cents));
  const req = Math.max(0, Math.floor(Number(required) || 0));
  return {
    currency, currencyStatus: currency ? "known" : (ordered[0]?.money.currencyStatus ?? "missing"), trips: ordered.length, required: req,
    percent: req > 0 ? Math.min(100, Math.round(ordered.length / req * 100)) : 0,
    earningsCents, averageCents: entries.length ? Math.round(earningsCents / entries.length) : 0, bestCents: best.cents, bestN: best.n,
    entries, bars: entries.map(entry => ({ n: entry.n, cents: entry.cents, height: Math.max(8, Math.round(entry.cents / max * 100)) })),
    outsideTotals: ordered.length - entries.length,
  };
}
