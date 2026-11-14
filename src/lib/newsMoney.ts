import { parseTripMoneyRecord, resolveTripCurrency } from "./tripNormalizer";
import { resolveSimulatorCurrency } from "./simulatorCurrencyRegistry";
import { newsSimulatorAliases } from "./newsSimulator";

type RecordLike = Record<string, any>;
const fields = ["simulatorId", "simuladorId", "simulatorCode", "simuladorCodigo", "simulatorKey", "simuladorKey", "simulatorName", "simuladorNome", "simulator", "simulador"];
const hasText = (value: unknown) => value != null && String(value).trim() !== "";

/** Resolve historical News using its own publication identity and the same
 * currency policy as trips. The viewer's selected simulator is never used. */
function moneyEvidence(entry: RecordLike, post: RecordLike, simulators: RecordLike[]) {
  const record: RecordLike = { ...post, ...entry };
  const entryCurrency = hasText(entry.currency) || hasText(entry.moeda);
  record.currency = entryCurrency ? entry.currency : post.currency;
  record.moeda = entryCurrency ? entry.moeda : post.moeda;
  const codes = new Set<string>();
  for (const source of [post, entry]) {
    const resolved = resolveSimulatorCurrency(source);
    if (resolved.status === "conflict") return { record, conflict: true };
    if (resolved.simulator) codes.add(resolved.simulator);
    const aliases = newsSimulatorAliases(...fields.map(field => source[field]));
    for (const simulator of simulators) {
      const catalogAliases = newsSimulatorAliases(simulator.id, simulator.name, ...fields.map(field => simulator[field]));
      if (!aliases.some(alias => catalogAliases.includes(alias))) continue;
      const catalog = resolveSimulatorCurrency({ ...simulator, simulatorName: simulator.name });
      if (catalog.simulator) codes.add(catalog.simulator);
    }
  }
  if (codes.size > 1) return { record, conflict: true };
  if (codes.size === 1) record.simulatorCode = [...codes][0];
  return { record, conflict: false };
}

const currencyFormatter = new Map<string, Intl.NumberFormat>();
function amountLabel(amount: number, currency: string) {
  let formatter = currencyFormatter.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    currencyFormatter.set(currency, formatter);
  }
  return formatter.format(amount);
}

export function formatNewsMoney(entry: RecordLike, post: RecordLike = {}, simulators: RecordLike[] = []): string {
  if (!entry) return "Valor indisponível";
  if (entry.currencyStatus === "conflict" || entry.currencyEvidenceStatus === "conflict") return "Moedas conflitantes";
  if (Number(entry.currencyUnresolvedTrips || 0) > 0 || Number(entry.currencyMissingValueTrips || 0) > 0) return "Valor indisponível";
  // Preserve explicit per-currency totals instead of labelling a mixed sum.
  const breakdown = Array.isArray(entry.currencyBreakdown) ? entry.currencyBreakdown
    : entry.currencyTotals && typeof entry.currencyTotals === "object"
      ? Object.entries(entry.currencyTotals).map(([currency, value]) => ({ currency, value })) : [];
  if (breakdown.length) {
    const labels = breakdown.map((group: RecordLike) => {
      const currency = resolveTripCurrency({ currency: group.currency });
      const money = parseTripMoneyRecord({ value: group.value ?? group.ganhos });
      return currency.currency && money.amountSource && money.amount >= 0 && Number(group.missingValueTrips || 0) === 0
        ? amountLabel(money.amount, currency.currency) : null;
    });
    return labels.every(Boolean) ? labels.join(" · ") : "Valor indisponível";
  }
  const evidence = moneyEvidence(entry, post, simulators);
  if (evidence.conflict) return "Moedas conflitantes";
  const money = parseTripMoneyRecord({ ...evidence.record, valor: entry.ganhos ?? entry.valor,
    value: entry.value, totalValue: entry.totalValue, ganho: entry.ganho,
    valorCents: entry.valorCents, amountCents: entry.amountCents, earningsCents: entry.earningsCents });
  if (money.currencyStatus === "conflict") return "Moedas conflitantes";
  if (!money.currency) return "Moeda não informada";
  if (!money.amountSource || money.amount < 0) return "Valor indisponível";
  return amountLabel(money.amount, money.currency);
}
