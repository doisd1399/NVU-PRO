import React, { useId } from "react";
import { ManagementOperationCard, type ManagementOperation } from "./ManagementOperationCard";
import "./ManagementDashboard.css";

/** Trabalhos ativos: a lista de operações em andamento da empresa (página própria, aberta pela Central de gestão). */
export function ManagementActiveJobs({ operations, active = true, loading, onInfo, onDriver, onResults }: {
  operations: ManagementOperation[]; active?: boolean; loading: boolean;
  onInfo: (value: ManagementOperation) => void; onDriver: (value: ManagementOperation) => void; onResults?: (value: ManagementOperation) => void;
}) {
  const id = useId();
  return <div className="nvu-central-dashboard" data-testid="management-active-jobs">
    <section className="nvu-central-section nvu-central-jobs" aria-labelledby={`${id}-jobs`}>
      <div className="nvu-central-jobs-header">
        <div className="nvu-central-section-toggle" data-static="true">
          <span><span className="nvu-central-title-count"><h2 id={`${id}-jobs`}>Trabalhos ativos</h2><span className="nvu-central-count">{operations.length}</span></span><span className="nvu-central-subtitle">Operações em andamento</span></span>
        </div>
      </div>
      <div className="nvu-central-job-list">
        {operations.length ? operations.map(operation => <ManagementOperationCard key={operation.id} operation={operation} active={active} onInfo={() => onInfo(operation)} onDriver={() => onDriver(operation)} onResults={onResults ? () => onResults(operation) : undefined} />)
          : <p className="nvu-central-empty" role="status">{loading ? "Carregando trabalhos…" : "Nenhum trabalho ativo."}</p>}
      </div>
    </section>
  </div>;
}
