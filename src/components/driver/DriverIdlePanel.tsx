import React, { useState } from "react";
import { Building2, Check, CheckCircle2, ChevronDown, ChevronRight, History, Route } from "lucide-react";
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

/** Existing manual assignments use their original startJob handler. */
export function DriverAssignedQueue({ jobs, contracts, suspended, startingJobId, onStart }: {
  jobs: Job[];
  contracts: Contract[];
  suspended: boolean;
  startingJobId: string | null;
  onStart: (job: Job) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const id = React.useId();
  return <section className="nvu-idle-assigned-queue" aria-label="Trabalhos encaminhados pela empresa">
    <h2><button className="nvu-idle-assigned-heading" type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
      <Route size={20} aria-hidden="true" /><span>Encaminhamentos da empresa</span><small>{jobs.length}</small><ChevronDown size={17} className={expanded ? "rotate-180" : ""} aria-hidden="true" />
    </button></h2>
    <div hidden={!expanded} id={id}>
      {jobs.map((job, index) => {
        const contract = resolveOperationContract(job, contracts);
        return <details key={job.id} className="nvu-idle-assigned-row">
          <summary><span>{index + 1}</span><strong>{contract?.name || "Operação atribuída"}</strong><small>A realizar</small><ChevronDown size={15} aria-hidden="true" /></summary>
          <div><p>{contract?.totalDeliveries ? `${contract.totalDeliveries} entregas` : "Entregas a definir"}{contract?.deadlineDays ? ` · ${contract.deadlineDays} dias` : ""}</p>
            <button type="button" className="nvu-idle-assigned-start" onClick={() => onStart(job)} disabled={suspended || Boolean(startingJobId)}>
              {startingJobId === job.id ? "Iniciando operação…" : "Iniciar operação"}
            </button></div>
        </details>;
      })}
    </div>
  </section>;
}
