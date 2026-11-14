import React from "react";
import { shortName } from "../../../lib/partnerships";
import { buildOperationResults } from "../../../lib/operationResults";
import { formatHistoryMoney } from "../../../lib/tripMoneyPresentation";
import { fmtDateTime } from "../../partnerships/shared";
import type { ManagementOperation } from "./ManagementOperationCard";

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => <div><span>{label}</span><b>{value}</b></div>;

/**
 * Resultados de uma operação da empresa (ícone ao lado da situação do card): o mesmo desenho dos resultados da parceria, adaptado —
 * operação comum não tem meta de ganhos, então a porcentagem é a execução das viagens (feitas ÷ previstas).
 */
export function OperationResultsPage({ operation, trips }: { operation: ManagementOperation; trips: Record<string, unknown>[] }) {
  const required = operation.required || 0, r = buildOperationResults(trips, required), r1 = 2 * Math.PI * 38;
  const money = (cents: number) => formatHistoryMoney(cents / 100, r.currency, r.currencyStatus);
  const percent = required ? r.percent : 0;
  return <section className="nvu-central-section b2p-sec" data-testid="operation-results"><div className="b2p-form">
    <p className="b2p-hint">{operation.name} · {shortName(operation.driverName)}</p>
    <div className="b2p-gauge">
      <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={`Execução ${percent}%`}><circle className="b2p-g-bg" cx="48" cy="48" r="38" />
        <circle className="b2p-g-fg" cx="48" cy="48" r="38" strokeDasharray={r1} strokeDashoffset={r1 * (1 - percent / 100)} transform="rotate(-90 48 48)" />
        <text x="48" y="55" textAnchor="middle">{percent}%</text></svg>
      <div><b>{r.currency ? money(r.earningsCents) : "—"}</b><span className="b2p-hint">{required ? `${r.trips}/${required} viagens` : `${r.trips} ${r.trips === 1 ? "viagem" : "viagens"}`}</span></div>
    </div>
    <div className="b2p-settle">
      <Row label="Viagens" value={required ? `${r.trips} de ${required}` : r.trips} />
      <Row label="Ganho em viagens" value={r.currency ? money(r.earningsCents) : "—"} />
      <Row label="Média por viagem" value={r.entries.length ? money(r.averageCents) : "—"} />
      <Row label="Melhor viagem" value={r.bestCents ? `${money(r.bestCents)}${r.bestN ? ` (nº ${r.bestN})` : ""}` : "—"} />
    </div>
    {r.bars.length ? <div className="b2p-bars" aria-label="Ganho por viagem">{r.bars.map(bar => <i key={bar.n} data-best={bar.cents === r.bestCents ? "1" : "0"} style={{ height: `${bar.height}%` }} title={`Viagem ${bar.n}: ${money(bar.cents)}`} />)}</div> : null}
    {r.entries.length ? <div className="b2p-ledger">{r.entries.map(entry => <div key={entry.n}><i>{entry.n}</i><span>{fmtDateTime(entry.at)}</span><em>{money(entry.cents)}</em></div>)}</div> : <p className="b2p-empty">Nenhuma viagem com valor registrada ainda.</p>}
    {r.outsideTotals ? <p className="b2p-hint">{r.outsideTotals} {r.outsideTotals === 1 ? "viagem sem valor ou em outra moeda ficou" : "viagens sem valor ou em outra moeda ficaram"} fora dos ganhos.</p> : null}
  </div></section>;
}
