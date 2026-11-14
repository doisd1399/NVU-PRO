import { ModalSelect } from "../ui/ModalSelect";
import React, { useMemo, useState } from "react";
import { CalendarDays, ChevronRight } from "lucide-react";
import { driverDailyResults, driverDateLabel, driverResultPeriods } from "../../lib/driverWorkspace";
import { formatHistoryMoney } from "../../lib/tripMoneyPresentation";
import type { NormalizedTrip } from "../../lib/tripNormalizer";
import type { ReportPeriod } from "../../lib/tripReportHistory";
import { getMonthlyRange, getWeeklyRange } from "../../lib/metricsEngine";

export function DriverResults({ trips, loading, onTripsReport, onOperationReport }: {
  trips: NormalizedTrip[]; loading: boolean; onTripsReport?: () => void; onOperationReport?: () => void;
}) {
  const [period, setPeriod] = useState<ReportPeriod>("mensal");
  const [selected, setSelected] = useState("");
  const periods = useMemo(() => driverResultPeriods(trips, period), [trips, period]);
  const currentStart = (period === "mensal" ? getMonthlyRange() : getWeeklyRange()).start.getTime();
  const current = periods.find(item => item.id === selected)
    || periods.find(item => item.sortDate.getTime() === currentStart) || periods[0];
  const singleMoney = current.moneyGroups.length === 1 ? current.moneyGroups[0] : null;
  const days = useMemo(() => driverDailyResults(trips, period, current.sortDate), [trips, period, current.sortDate]);
  return <div className="nvu-driver-results">
    <div className="nvu-driver-result-filters">
      <div className="nvu-driver-tabs" aria-label="Período dos resultados">
        {(["semanal", "mensal"] as const).map(value => <button type="button" key={value}
          aria-pressed={period === value} onClick={() => { setPeriod(value); setSelected(""); }}>
          {value === "semanal" ? "Semana" : "Mês"}
        </button>)}
      </div>
      <ModalSelect title="Período dos resultados" description={period === "mensal" ? "Escolha o mês que deseja consultar." : "Escolha a semana que deseja consultar."}
        className="nvu-driver-period-select" icon={<CalendarDays size={16} aria-hidden="true" />}
        value={current.id} onChange={event => setSelected(event.target.value)}>
          {periods.map(item => <option value={item.id} key={item.id}>{item.subTitle}</option>)}
      </ModalSelect>
    </div>
    <section className="nvu-driver-results-summary nvu-driver-paper" aria-label="Ganhos no período" aria-busy={loading}>
      <p className="nvu-driver-muted">Ganhos no período</p>
      {loading && !trips.length ? <p role="status">Carregando seus resultados…</p> : !current.moneyGroups.length ?
        <p className="nvu-driver-empty">Nenhuma viagem concluída neste período.</p> :
        current.moneyGroups.map((money, index) => <div className="nvu-driver-currency-result" key={`${money.currencyStatus}-${money.currency}-${index}`}>
          <strong className={money.currencyStatus === "known" ? "nvu-driver-result-total" : "nvu-driver-unresolved-money"}>
            {formatHistoryMoney(money.value, money.currency, money.currencyStatus)}
          </strong>
          <p className="nvu-driver-muted">{money.currency || "Sem moeda confirmada"} · {money.tripCount} {money.tripCount === 1 ? "viagem" : "viagens"}</p>
          {current.moneyGroups.length > 1 && <div className="nvu-driver-result-stat"><span>Média por viagem</span><strong>
            {formatHistoryMoney(money.value !== null && !money.missingValueTrips ? money.value / money.tripCount : null, money.currency, money.currencyStatus)}
          </strong></div>}
          {money.missingValueTrips > 0 && <p className="nvu-driver-muted">{money.missingValueTrips} viagem(ns) com valor indisponível.</p>}
        </div>)}
      <div className="nvu-driver-result-stats">
        <div className="nvu-driver-result-count"><strong>{current.tripCount}</strong><span>Viagens concluídas</span></div>
        {current.moneyGroups.length <= 1 && <div className="nvu-driver-result-count"><strong>
          {singleMoney ? formatHistoryMoney(singleMoney.value !== null && !singleMoney.missingValueTrips ? singleMoney.value / singleMoney.tripCount : null,
            singleMoney.currency, singleMoney.currencyStatus) : "—"}
        </strong><span>Média por viagem</span></div>}
      </div>
    </section>
    <section className="nvu-driver-paper nvu-driver-daily-results" aria-labelledby="nvu-driver-daily-title">
      <div className="nvu-driver-paper-heading"><h2 id="nvu-driver-daily-title">Por dia</h2><span>Ganhos</span></div>
      <div className="nvu-driver-daily-list">
        {!days.length ? <p className="nvu-driver-empty">Os resultados diários aparecerão aqui.</p> : days.map(day =>
          <div className="nvu-driver-daily-row" key={day.id}>
            <div><strong>{driverDateLabel(day.date, { day: "numeric", month: "short" })}</strong>
              <span>{day.trips.length} {day.trips.length === 1 ? "viagem" : "viagens"}</span></div>
            <div>{day.moneyGroups.map((money, index) => <strong key={index}>
              {formatHistoryMoney(money.value, money.currency, money.currencyStatus)}
            </strong>)}</div>
          </div>)}
      </div>
    </section>
    {onTripsReport && onOperationReport && <section className="nvu-driver-paper nvu-driver-report-links" aria-labelledby="nvu-driver-reports-title">
      <h2 id="nvu-driver-reports-title">Relatórios</h2>
      <button type="button" onClick={onTripsReport}><span><strong>Relatório de viagens</strong><small>Detalhamento dos registros</small></span><ChevronRight size={18} /></button>
      <button type="button" onClick={onOperationReport}><span><strong>Resumo por operação</strong><small>Resultados agrupados</small></span><ChevronRight size={18} /></button>
    </section>}
  </div>;
}
