import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, CalendarDays, ChevronDown, ClipboardPaste, Headset, List, MapPinned, Pencil, UsersRound, Warehouse } from "lucide-react";
import { ManagementOperationCard, type ManagementOperation } from "./ManagementOperationCard";
import "./ManagementDashboard.css";

export type ManagementAction = "operations" | "assign" | "teams" | "hr" | "fleet" | "trips";
const actions = [
  { id: "operations", label: "Operações", icon: List },
  { id: "assign", label: "Designar Trabalhos", icon: ClipboardPaste },
  { id: "teams", label: "Equipes", icon: UsersRound },
  { id: "hr", label: "Recursos Humanos", icon: Headset },
  { id: "fleet", label: "Frota", icon: Warehouse },
  { id: "trips", label: "Viagens", icon: MapPinned },
] as const;

/** Keep a full currency amount on one line, also with large real totals. */
function FittedAmount({ children }: { children: string }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const fit = () => {
      node.style.fontSize = "";
      const range = document.createRange(); range.selectNodeContents(node);
      const width = range.getBoundingClientRect().width;
      const available = node.clientWidth;
      if (width > available && available > 0) node.style.fontSize = `${parseFloat(getComputedStyle(node).fontSize) * available / width}px`;
    };
    fit();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    observer?.observe(node.parentElement!);
    let disposed = false;
    document.fonts?.ready.then(() => { if (!disposed) fit(); });
    return () => { disposed = true; observer?.disconnect(); };
  }, [children]);
  return <strong ref={ref}>{children}</strong>;
}

export function ManagementDashboard({ periodLabel, periodDescription, onPeriod, earnings, tripCount,
  goal, onGoal, operations, totalOperations, onAction, onInfo, onDriver, loading, refreshing, active = true,
}: {
  periodLabel: string; periodDescription: string; onPeriod: () => void;
  earnings: string[]; tripCount: number;
  goal: { amount: string; progress: number | null; loading: boolean; error: string; canEdit: boolean; onRetry?: () => void };
  onGoal: () => void; operations: ManagementOperation[]; totalOperations: number;
  onAction: (value: ManagementAction) => void; onInfo: (value: ManagementOperation) => void;
  onDriver: (value: ManagementOperation) => void; loading: boolean; refreshing: boolean; active?: boolean;
}) {
  const id = useId();
  const [jobsOpen, setJobsOpen] = useState(true);
  const disclosure = (open: boolean) => <span className="nvu-central-disclosure-icon" data-expanded={open}><ChevronDown size={19} strokeWidth={2.2} aria-hidden="true" /></span>;
  return <div className="nvu-central-dashboard" data-testid="management-dashboard">
    <section className="nvu-central-section nvu-central-summary" aria-labelledby={`${id}-summary`}>
      <div className="nvu-central-section-heading nvu-central-summary-heading">
        <h2 id={`${id}-summary`}>Resumo operacional</h2>
        <button type="button" className="nvu-central-period" onClick={onPeriod} aria-label={`Escolher período: ${periodLabel}`} title={periodDescription}>
          <CalendarDays size={17} strokeWidth={1.8} /><span>{periodLabel}</span><ChevronDown size={16} />
        </button>
      </div>
      <div id={`${id}-summary-body`} className="nvu-central-summary-body">
        <div className="nvu-central-financial-metrics">
          <div><span>Ganhos do período</span><div className="nvu-central-earnings">{earnings.map((amount, i) => <FittedAmount key={i}>{amount}</FittedAmount>)}</div></div>
          <div><span>Viagens</span><strong className="nvu-central-trip-count">{tripCount}</strong></div>
        </div>
        <div className="nvu-central-goal" aria-busy={goal.loading}>
          <div className="nvu-central-goal-top"><span>Meta do período</span>{goal.canEdit && <button type="button" onClick={onGoal} disabled={goal.loading} aria-label="Ajustar meta financeira"><Pencil size={16} strokeWidth={1.7} />Ajustar</button>}</div>
          <div className="nvu-central-goal-values"><FittedAmount>{goal.loading ? "Carregando…" : goal.amount}</FittedAmount>{goal.progress !== null && <span>{goal.progress.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% atingido</span>}</div>
          <div className="nvu-central-progress" role="progressbar" aria-label="Meta financeira do período" aria-valuemin={0} aria-valuemax={100} aria-valuenow={goal.progress === null ? undefined : Math.min(100, goal.progress)} aria-valuetext={goal.progress === null ? goal.amount : undefined}>
            <span style={{ width: `${goal.progress === null ? 0 : Math.min(100, Math.max(0, goal.progress))}%` }} />
          </div>
          {goal.error && <div className="nvu-central-goal-feedback"><p className="nvu-central-goal-error" role="status">{goal.error}</p>{goal.onRetry && <button type="button" onClick={goal.onRetry} disabled={goal.loading}>Atualizar meta</button>}</div>}
        </div>
      </div>
    </section>
    <section className="nvu-central-section nvu-central-actions" aria-labelledby={`${id}-actions`}>
      <div className="nvu-central-section-heading"><h2 id={`${id}-actions`}>Gerenciar empresa</h2></div>
      <div id={`${id}-actions-body`} className="nvu-central-action-list">
        {actions.map(({ id: actionId, label, icon: Icon }) => <button type="button" key={actionId} className="nvu-central-action" onClick={() => onAction(actionId)}>
          <Icon className="nvu-central-action-icon" size={24} strokeWidth={1.7} aria-hidden="true" /><span>{label}</span><span className="nvu-central-action-arrow"><ArrowRight size={20} strokeWidth={1.8} /></span>
        </button>)}
      </div>
    </section>
    <section className="nvu-central-section nvu-central-jobs" aria-labelledby={`${id}-jobs`}>
      <div className="nvu-central-jobs-header">
        <button type="button" className="nvu-central-section-toggle" aria-expanded={jobsOpen} aria-controls={`${id}-jobs-body`} onClick={() => setJobsOpen(!jobsOpen)}>
          <span><span className="nvu-central-title-count"><h2 id={`${id}-jobs`}>Trabalhos ativos</h2><span className="nvu-central-count">{totalOperations}</span></span><span className="nvu-central-subtitle">Operações em andamento</span></span>{disclosure(jobsOpen)}
        </button>

      </div>
      {jobsOpen && <div id={`${id}-jobs-body`} className="nvu-central-job-list">
        {operations.length ? operations.map(operation => <ManagementOperationCard key={operation.id} operation={operation} active={active} onInfo={() => onInfo(operation)} onDriver={() => onDriver(operation)} />)
          : <p className="nvu-central-empty" role="status">{loading ? "Carregando trabalhos…" : "Nenhum trabalho ativo."}</p>}
      </div>}
    </section>
    {(loading || refreshing) && <p role="status" className="nvu-central-sync-status">Atualizando dados da empresa…</p>}
  </div>;
}
