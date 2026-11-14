/**
 * A meta financeira de cada simulador vale na moeda em que a empresa de fato recebe naquele período: ATS paga em US$, ETS2 em €
 * (a moeda interna do jogo, sem conversão) e lançamentos por comprovante podem vir em R$. O documento da meta guarda só o número
 * (o rótulo "BRL" que as regras publicadas exigem é legado), então a moeda é inferida das viagens do período, nunca somada entre moedas.
 */
export type GoalCurrency = "BRL" | "USD" | "EUR";
export type GoalMoneyGroup = { currency?: string | null; currencyStatus?: string; value: number; tripCount: number };

const GOAL_CURRENCIES: readonly GoalCurrency[] = ["BRL", "USD", "EUR"];
const isGoalCurrency = (value: unknown): value is GoalCurrency => GOAL_CURRENCIES.includes(value as GoalCurrency);

/** Moeda interna do jogo; simuladores sem moeda própria conhecida continuam em reais. */
export function nativeGoalCurrency(simulatorId: string | null | undefined): GoalCurrency {
  const key = String(simulatorId || "").trim().toLowerCase();
  if (/(^|[^a-z0-9])ets-?2([^a-z0-9]|$)|euro/.test(key)) return "EUR";
  if (/(^|[^a-z0-9])ats([^a-z0-9]|$)|american/.test(key)) return "USD";
  return "BRL";
}

/** Moeda da meta: a única moeda conhecida do período; com mais de uma, a de mais viagens (empate: a do jogo); sem viagens, a do jogo. */
export function resolveGoalCurrency(simulatorId: string | null | undefined, groups: readonly GoalMoneyGroup[]): GoalCurrency {
  const native = nativeGoalCurrency(simulatorId);
  const known = groups.filter(group => group.currencyStatus === "known" && isGoalCurrency(group.currency) && group.tripCount > 0);
  if (!known.length) return native;
  const best = [...known].sort((a, b) => b.tripCount - a.tripCount || Number(b.currency === native) - Number(a.currency === native))[0];
  return best.currency as GoalCurrency;
}

/** Receita do período na moeda da meta; outras moedas nunca entram no progresso. */
export function goalRevenueIn(groups: readonly GoalMoneyGroup[], currency: GoalCurrency): number {
  return groups.find(group => group.currency === currency && group.currencyStatus === "known")?.value || 0;
}

export const goalCurrencySymbol = (currency: GoalCurrency): string => currency === "USD" ? "US$" : currency === "EUR" ? "€" : "R$";
