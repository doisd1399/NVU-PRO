import React, { useState } from "react";
import { ArrowLeft, ArrowRight, Briefcase, CheckCircle2, ChevronDown, ChevronRight, Clock, History, Route, Trophy, UserRound, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useSessionStore } from "../../context/AppContext";
import { useDriverRewards } from "../../hooks/useRewards";
import { formatMoney } from "../../lib/partnerships";
import { DiscreetDisclosure } from "../common/DiscreetDisclosure";
import { DriverStatusRow } from "./DriverStatusRow";
import type { CompanyProfile, Contract, Job } from "../../context/AppContext";
import { resolveOperationContract } from "../../lib/operationResultSummary";
import { deriveCurrentOperationProgress } from "../../lib/currentOperation";

export type IdleView = "menu" | "works" | "history";
type IdleMenuItem = { id: string; label: string; icon: LucideIcon; hint?: string; badge?: string | number; soon?: boolean; disabled?: boolean; onSelect?: () => void };

/**
 * Painel do motorista sem operação: status no topo e uma lista de opções (mesmo desenho da Central de gestão).
 * "Ver Trabalhos" e "Histórico de operações" abrem a própria tela dentro do painel, com botão de voltar.
 */
export function DriverIdlePanel({ online, suspended, onAvailabilityChange, onProfile, onWallet, workJobIds = [], works, history, defaultView = "menu", children }: {
  online: boolean;
  suspended: boolean;
  onAvailabilityChange: (online: boolean) => void;
  onProfile: () => void;
  /** Abre a página Carteira (ofertas, recebimentos e histórico de ganhos). */
  onWallet: () => void;
  /** Trabalhos recebidos (ids) — conta quantos têm oferta de pagamento nova. */
  workJobIds?: string[];
  works: React.ReactNode;
  history: React.ReactNode;
  defaultView?: IdleView;
  /** Janelas e avisos que ficam sempre montados (resultado da operação, suspensão, condições do trabalho). */
  children?: React.ReactNode;
}) {
  const [view, setView] = useState<IdleView>(defaultView);
  const { currentUser } = useSessionStore();
  const { offers } = useDriverRewards(currentUser?.id);
  const worksCount = workJobIds.length, worksNew = offers.filter(offer => offer.status === "pending" && offer.jobId && workJobIds.includes(offer.jobId)).length;
  const id = React.useId();
  const items: IdleMenuItem[] = [
    { id: "works", label: "Ver Trabalhos", icon: Briefcase, badge: worksNew > 0 ? `${worksNew} ${worksNew === 1 ? "nova" : "novas"}` : worksCount || undefined, onSelect: () => setView("works") },
    { id: "history", label: "Histórico de operações", icon: History, onSelect: () => setView("history") },
    { id: "wallet", label: "Carteira", icon: Wallet, onSelect: onWallet },
    { id: "profile", label: "Perfil", icon: UserRound, onSelect: onProfile },
    { id: "achievements", label: "Conquistas", icon: Trophy, soon: true, disabled: true },
  ];
  const title = view === "works" ? "Trabalhos" : "Histórico de operações";
  return <section className="nvu-driver-idle-workspace nvu-workspace-theme" data-testid="driver-idle-panel" data-view={view}>
    <header className="nvu-idle-heading">
      <h1>Painel do motorista</h1>
      <p>Suas operações, no seu ritmo.</p>
    </header>
    <DriverStatusRow online={online} suspended={suspended} onChange={onAvailabilityChange} />
    {children}
    {view === "menu" ? <section className="nvu-idle-menu" aria-labelledby={`${id}-menu`}>
      <h2 id={`${id}-menu`} className="nvu-idle-menu-heading">Painel operacional</h2>
      <div className="nvu-idle-menu-list">
        {items.map(({ id: itemId, label, icon: Icon, hint, badge, soon, disabled, onSelect }) => <button type="button" key={itemId} className="nvu-idle-menu-item" data-item={itemId} disabled={disabled} onClick={onSelect}>
          <Icon className="nvu-idle-menu-icon" size={24} strokeWidth={1.7} aria-hidden="true" />
          <span className="nvu-idle-menu-label">{label}{hint ? <small>{hint}</small> : null}</span>
          {soon ? <em className="nvu-idle-menu-soon">Em breve</em> : badge !== undefined ? <em className="nvu-idle-menu-badge">{badge}</em> : null}
          <span className="nvu-idle-menu-arrow" aria-hidden="true"><ArrowRight size={17} strokeWidth={2} /></span>
        </button>)}
      </div>
    </section> : <>
      <div className="nvu-idle-subhead">
        <button type="button" className="nvu-idle-back" onClick={() => setView("menu")} aria-label="Voltar ao painel do motorista"><ArrowLeft size={18} aria-hidden="true" /></button>
        <h2>{title}</h2>
      </div>
      {view === "works" ? works : history}
    </>}
  </section>;
}

export function DriverPreviousWork({ jobs, contracts, trips, driverId, historyReady, onReview }: {
  jobs: Job[];
  contracts: Contract[];
  trips: any[];
  driverId: string;
  historyReady: boolean;
  onReview: (job: Job) => void;
}) {
  return <DiscreetDisclosure title="Trabalhos anteriores" icon={History}
    summary={<span className="nvu-idle-history-count">{jobs.length}</span>}
    className="nvu-idle-history" testId="driver-previous-work">
    <PreviousWorkRows jobs={jobs} contracts={contracts} trips={trips} driverId={driverId}
      historyReady={historyReady} onReview={onReview} />
  </DiscreetDisclosure>;
}

// Mounted only after opening the disclosure; navigation never renders a long
// operation history or starts another trip query just to show its count.
export function PreviousWorkRows({ jobs, contracts, trips, driverId, historyReady, onReview }: React.ComponentProps<typeof DriverPreviousWork>) {
  const [limit, setLimit] = useState(10);
  if (!jobs.length) return <p className="nvu-idle-empty">Nenhum trabalho concluído nesta empresa.</p>;
  return <>
    <ul className="nvu-idle-history-list">
      {jobs.slice(0, limit).map(job => {
        const contract = resolveOperationContract(job, contracts);
        const progress = historyReady ? deriveCurrentOperationProgress(job, trips, driverId) : null;
        return <li key={job.id}><button type="button" onClick={() => onReview(job)} aria-label={`Ver trabalho ${contract?.name || "concluído"}`}>
          <CheckCircle2 size={19} className="nvu-idle-history-check" aria-hidden="true" />
          <span className="nvu-idle-history-identity"><strong>{contract?.name || "Operação concluída"}</strong>
            <small>{progress === null ? "Trabalho concluído" : contract?.totalDeliveries ? `${progress} de ${contract.totalDeliveries} entregas` : `${progress} entregas registradas`}</small></span>
          <span className="nvu-idle-history-state">Concluído</span><ChevronRight size={16} aria-hidden="true" />
        </button></li>;
      })}
    </ul>
    {jobs.length > limit && <button type="button" className="nvu-idle-history-more" onClick={() => setLimit(value => value + 10)}>Mostrar mais trabalhos</button>}
  </>;
}

const brt = (ms: number) => new Date(ms - 3 * 3_600_000).toISOString();
/** Data ("16/11") e hora ("14:19") em horário de Brasília, curtas para caber nos cartões. */
const deadlineParts = (ms: number) => { const iso = brt(ms); return { day: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`, time: iso.slice(11, 16) }; };

/** "3d 23h", "5h 10min" ou "menos de 1 min" — tempo que falta até o prazo da oferta. */
export function remainingLabel(deadlineMs: number, nowMs: number): string {
  const left = deadlineMs - nowMs;
  if (left <= 0) return "";
  const min = Math.floor(left / 60_000), d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}min`;
  return m > 0 ? `${m} min` : "menos de 1 min";
}

/** Fila de encaminhamentos (visual): cartões compactos; o trabalho com pagamento (oferta) ganha selo, destaque e as condições em blocos. */
export function AssignedQueueView({ jobs, contracts, suspended, startingJobId, onStart, rewardOf, defaultOpenId, companyName, nowMs }: {
  jobs: Job[]; contracts: Contract[]; suspended: boolean; startingJobId: string | null; onStart: (job: Job) => void;
  rewardOf: (job: Job) => { perTripCents: number; deadlineMs: number; maxTripsPerDriver: number; status: string } | undefined; defaultOpenId?: string; companyName?: string; nowMs?: number;
}) {
  const now = nowMs ?? Date.now();
  const [expanded, setExpanded] = useState(true);
  const id = React.useId();
  return <section className="nvu-idle-assigned-queue" aria-label="Trabalhos recebidos">
    <h2><button className="nvu-idle-assigned-heading" type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
      <Route size={20} aria-hidden="true" /><span>Trabalhos recebidos</span><small>{jobs.length}</small><ChevronDown size={17} className={expanded ? "rotate-180" : ""} aria-hidden="true" />
    </button></h2>
    <div hidden={!expanded} id={id} className="nvu-queue-list">
      {jobs.map((job, index) => {
        const contract = resolveOperationContract(job, contracts), reward = rewardOf(job), deliveries = contract?.totalDeliveries || 0, days = contract?.deadlineDays || 0;
        const facts = [deliveries ? `${deliveries} entregas` : "Entregas a definir", days ? `${days} ${days === 1 ? "dia" : "dias"}` : ""].filter(Boolean).join(" · ");
        if (reward) {
          const trips = reward.maxTripsPerDriver || deliveries || 0, cap = trips ? reward.perTripCents * trips : 0, left = reward.deadlineMs ? remainingLabel(reward.deadlineMs, now) : "";
          const late = Boolean(reward.deadlineMs) && !left, subtitle = [companyName, contract?.simulator].filter(Boolean).join(" · ");
          return <article key={job.id} className="nvu-offer-card nvu-idle-assigned-row" data-state={reward.status} data-late={late ? "1" : undefined}>
            <header className="nvu-offer-top">
              <span className="nvu-offer-badge"><i><Wallet size={13} aria-hidden="true" /></i>Oferta de trabalho</span>
              <em className="nvu-offer-tag">{reward.status === "pending" ? "Nova" : "Aceita"}</em>
            </header>
            <div className="nvu-offer-head">
              <div><strong>{contract?.name || "Operação atribuída"}</strong>{subtitle ? <small>{subtitle}</small> : null}</div>
              <div className="nvu-offer-price"><b>{formatMoney(reward.perTripCents)}</b><small>por viagem</small></div>
            </div>
            <dl className="nvu-offer-facts">
              <div><dt>Viagens</dt><dd>{trips || "—"}</dd></div>
              <div><dt>Teto</dt><dd>{cap ? formatMoney(cap) : "—"}</dd></div>
              <div data-k="deadline"><dt>Prazo</dt><dd>{reward.deadlineMs ? <>{deadlineParts(reward.deadlineMs).day} <small>{deadlineParts(reward.deadlineMs).time}</small></> : days ? `${days} d` : "—"}</dd></div>
            </dl>
            <p className="nvu-offer-note"><Clock size={14} aria-hidden="true" /><span>{late ? <strong>Prazo encerrado.</strong> : left ? <strong>Restam {left}.</strong> : null} Fora do prazo você finaliza, mas não recebe.</span></p>
            <button type="button" className="nvu-queue-start nvu-offer-start nvu-idle-assigned-start" onClick={() => onStart(job)} disabled={suspended || Boolean(startingJobId)}>
              <span>{startingJobId === job.id ? "Iniciando operação…" : reward.status === "pending" ? "Ver condições e iniciar" : "Iniciar operação"}</span><i><ArrowRight size={16} aria-hidden="true" /></i>
            </button>
          </article>;
        }
        return <details key={job.id} className="nvu-queue-card nvu-idle-assigned-row" open={defaultOpenId === job.id || undefined}>
          <summary>
            <span className="nvu-queue-index">{index + 1}</span>
            <span className="nvu-queue-title">
              {job.partnershipId ? <em className="nvu-queue-chip">Parceria</em> : null}
              <strong>{contract?.name || "Operação atribuída"}</strong>
              <small>{facts}</small>
            </span>
            <ChevronDown size={16} aria-hidden="true" className="nvu-queue-chevron" />
          </summary>
          <div className="nvu-queue-body">
            <dl className="nvu-queue-facts">
                <div><dt>Entregas</dt><dd>{deliveries || "—"}</dd></div>
                <div><dt>Prazo</dt><dd>{days ? `${days} ${days === 1 ? "dia" : "dias"}` : "—"}</dd></div>
            </dl>
            <button type="button" className="nvu-queue-start nvu-idle-assigned-start" onClick={() => onStart(job)} disabled={suspended || Boolean(startingJobId)}>
              {startingJobId === job.id ? "Iniciando operação…" : "Iniciar operação"}
            </button>
          </div>
        </details>;
      })}
    </div>
  </section>;
}

/** Existing manual assignments use their original startJob handler; a trabalho com pagamento é identificado pela oferta do motorista (escuta compartilhada). */
export function DriverAssignedQueue(props: { jobs: Job[]; contracts: Contract[]; suspended: boolean; startingJobId: string | null; onStart: (job: Job) => void; companyName?: string }) {
  const { currentUser } = useSessionStore();
  const { offers } = useDriverRewards(currentUser?.id);
  const rewardOf = (job: Job) => offers.find(offer => offer.jobId === job.id && (offer.status === "pending" || offer.status === "accepted"));
  return <AssignedQueueView {...props} rewardOf={rewardOf} />;
}
