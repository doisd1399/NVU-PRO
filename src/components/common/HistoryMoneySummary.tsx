import { formatHistoryMoney } from "../../lib/tripMoneyPresentation";
import type { TripCurrencyStatus } from "../../lib/tripNormalizer";

type MoneyGroup = {
  currency?: string;
  currencyStatus: TripCurrencyStatus;
  value: number | null;
  tripCount: number;
  missingValueTrips?: number;
};

/** Compact presentation only; currency buckets and eligibility stay unchanged. */
export function HistoryMoneySummary({
  groups,
  totalEligibleTrips,
}: {
  groups: MoneyGroup[];
  totalEligibleTrips?: number;
}) {
  const known = groups.filter((group) => group.currencyStatus === "known");
  const unresolved = groups.filter((group) => group.currencyStatus !== "known");
  const totalTrips = totalEligibleTrips ?? groups.reduce((sum, group) => sum + group.tripCount, 0);
  const hasMissingValues = known.some((group) => (group.missingValueTrips || 0) > 0);

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 break-words">
      {known.length > 0 ? (
        known.map((group) => (
          <span
            key={group.currency}
            className="font-bold leading-tight text-emerald-600 dark:text-emerald-400"
          >
            {formatHistoryMoney(group.value, group.currency, group.currencyStatus)}
          </span>
        ))
      ) : (
        <span
          className="font-semibold text-slate-600 dark:text-nvu-text-soft"
          aria-label={totalTrips > 0 ? "Ganhos sem moeda determinada" : "Sem ganhos no período"}
        >
          —
        </span>
      )}

      {(unresolved.length > 0 || hasMissingValues) && (
        <details className="text-xs font-normal text-slate-500 dark:text-nvu-muted">
          <summary className="cursor-pointer select-none">Detalhes</summary>
          <ul className="mt-1 space-y-0.5 pl-4 list-disc">
            {unresolved.map((group, index) => {
              const label = group.currencyStatus === "conflict"
                ? "Moedas divergentes"
                : group.currencyStatus === "missing"
                  ? "Moeda não identificada"
                  : "Moeda não confirmada";
              return (
                <li key={`${group.currencyStatus}-${index}`}>
                  {label}: {group.tripCount} {group.tripCount === 1 ? "viagem" : "viagens"}
                </li>
              );
            })}
            {known.filter((group) => (group.missingValueTrips || 0) > 0).map((group) => (
              <li key={`missing-${group.currency}`}>
                {group.missingValueTrips} {group.missingValueTrips === 1 ? "viagem" : "viagens"} sem valor de {group.currency}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
