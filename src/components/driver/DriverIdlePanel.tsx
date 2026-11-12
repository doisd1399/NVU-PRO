import React, { useState } from "react";
import { Building2, Check, CheckCircle2, ChevronDown, ChevronRight, History, Info, Route, Wallet } from "lucide-react";
import { useSessionStore } from "../../context/AppContext";
import { useDriverRewards } from "../../hooks/useRewards";
import { formatMoney } from "../../lib/partnerships";
import { StableImage } from "../common/StableImage";
import { DiscreetDisclosure } from "../common/DiscreetDisclosure";
import { DriverStatusRow } from "./DriverStatusRow";
import type { CompanyProfile, Contract, Job } from "../../context/AppContext";
import { resolveOperationContract } from "../../lib/operationResultSummary";
import { deriveCurrentOperationProgress } from "../../lib/currentOperation";

export function DriverIdlePanel({ company, viewerId, online, suspended, onAvailabilityChange, children }: {
  company: CompanyProfile | null;
  viewerId: string;
  online: boolean;
  suspended: boolean;
  onAvailabilityChange: (online: boolean) => void;
  children: React.ReactNode;
}) {
  const name = company?.companyName || company?.name || company?.fleetName || "Empresa vinculada";
  const logo = company?.logoUrl || company?.logoURL || company?.companyLogoURL;
  return <section className="nvu-driver-idle-workspace nvu-workspace-theme" data-testid="driver-idle-panel">
    <header className="nvu-idle-heading">
      <h1>Painel do motorista</h1>
      <p>Suas operações, no seu ritmo.</p>
    </header>
    {company ? <section className="nvu-idle-company" aria-label="Empresa vinculada">
      <StableImage src={logo} alt={`Logo de ${name}`} wrapperClassName="nvu-idle-company-logo"
        persistentViewerId={viewerId} persistentAssetId={`company-logo:${company.id}`}
        className="h-full w-full object-cover" fallback={<Building2 size={24} aria-hidden="true" />} />
      <div className="nvu-idle-company-identity"><span>Empresa vinculada</span><strong>{name}</strong></div>
      <span className="nvu-idle-company-linked"><Check size={14} aria-hidden="true" /><span>Vinculado</span></span>
    </section> : <p className="nvu-idle-company-unavailable" role="status">Os dados da empresa vinculada ainda não estão disponíveis neste aparelho.</p>}
    <DriverStatusRow online={online} suspended={suspended} onChange={onAvailabilityChange} />
    {children}
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
function PreviousWorkRows({ jobs, contracts, trips, driverId, historyReady, onReview }: React.ComponentProps<typeof DriverPreviousWork>) {
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

/** Fila de encaminhamentos (visual): cartões compactos; o trabalho com pagamento (oferta) ganha selo, destaque e as condições em blocos. */
export function AssignedQueueView({ jobs, contracts, suspended, startingJobId, onStart, rewardOf, defaultOpenId }: {
  jobs: Job[]; contracts: Contract[]; suspended: boolean; startingJobId: string | null; onStart: (job: Job) => void;
  rewardOf: (job: Job) => { perTripCents: number; deadlineMs: number; maxTripsPerDriver: number; status: string } | undefined; defaultOpenId?: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const id = React.useId();
  return <section className="nvu-idle-assigned-queue" aria-label="Trabalhos encaminhados pela empresa">
    <h2><button className="nvu-idle-assigned-heading" type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
      <Route size={20} aria-hidden="true" /><span>Encaminhamentos da empresa</span><small>{jobs.length}</small><ChevronDown size={17} className={expanded ? "rotate-180" : ""} aria-hidden="true" />
    </button></h2>
    <div hidden={!expanded} id={id} className="nvu-queue-list">
      {jobs.map((job, index) => {
        const contract = resolveOperationContract(job, contracts), reward = rewardOf(job), deliveries = contract?.totalDeliveries || 0, days = contract?.deadlineDays || 0;
        const facts = [deliveries ? `${deliveries} entregas` : "Entregas a definir", days ? `${days} ${days === 1 ? "dia" : "dias"}` : ""].filter(Boolean).join(" · ");
        return <details key={job.id} className="nvu-queue-card nvu-idle-assigned-row" data-reward={reward ? "1" : undefined} open={defaultOpenId === job.id || undefined}>
          <summary>
            <span className="nvu-queue-index">{index + 1}</span>
            <span className="nvu-queue-title">
              {reward ? <em className="nvu-queue-chip"><Wallet size={11} aria-hidden="true" /> Oferta de trabalho</em> : job.partnershipId ? <em className="nvu-queue-chip">Parceria</em> : null}
              <strong>{contract?.name || "Operação atribuída"}</strong>
              <small>{reward ? `${formatMoney(reward.perTripCents)}/viagem${reward.deadlineMs ? ` · até ${deadlineParts(reward.deadlineMs).day}` : ""}` : facts}</small>
            </span>
            <ChevronDown size={16} aria-hidden="true" className="nvu-queue-chevron" />
          </summary>
          <div className="nvu-queue-body">
            <dl className="nvu-queue-facts">
              {reward ? <>
                <div data-k="money"><dt>Por viagem</dt><dd>{formatMoney(reward.perTripCents)}</dd></div>
                <div><dt>Viagens</dt><dd>{reward.maxTripsPerDriver || deliveries || "—"}</dd></div>
                <div><dt>Prazo</dt><dd>{reward.deadlineMs ? <>{deadlineParts(reward.deadlineMs).day} <small>{deadlineParts(reward.deadlineMs).time}</small></> : days ? `${days} d` : "—"}</dd></div>
              </> : <>
                <div><dt>Entregas</dt><dd>{deliveries || "—"}</dd></div>
                <div><dt>Prazo</dt><dd>{days ? `${days} ${days === 1 ? "dia" : "dias"}` : "—"}</dd></div>
              </>}
            </dl>
            {reward ? <p className="nvu-queue-note"><Info size={14} aria-hidden="true" />Fora do prazo você finaliza, mas não recebe pelo serviço.</p> : null}
            <button type="button" className="nvu-queue-start nvu-idle-assigned-start" onClick={() => onStart(job)} disabled={suspended || Boolean(startingJobId)}>
              {startingJobId === job.id ? "Iniciando operação…" : reward?.status === "pending" ? "Ver condições e iniciar" : "Iniciar operação"}
            </button>
          </div>
        </details>;
      })}
    </div>
  </section>;
}

/** Existing manual assignments use their original startJob handler; a trabalho com pagamento é identificado pela oferta do motorista (escuta compartilhada). */
export function DriverAssignedQueue(props: { jobs: Job[]; contracts: Contract[]; suspended: boolean; startingJobId: string | null; onStart: (job: Job) => void }) {
  const { currentUser } = useSessionStore();
  const { offers } = useDriverRewards(currentUser?.id);
  const rewardOf = (job: Job) => offers.find(offer => offer.jobId === job.id && (offer.status === "pending" || offer.status === "accepted"));
  return <AssignedQueueView {...props} rewardOf={rewardOf} />;
}
