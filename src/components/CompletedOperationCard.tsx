import { ChevronRight } from "lucide-react";
import type { OperationResultData } from "./OperationResultModal";
import { HistoryMoneySummary } from "./common/HistoryMoneySummary";

export function CompletedOperationCard({ result, onReview }: {
  result: OperationResultData; onReview: () => void;
}) {
  return <section data-testid="completed-operation-card" className="nvu-completed-operation" aria-label="Última operação finalizada">
    <div className="nvu-completed-operation-heading">
      <h2>Última operação</h2><span>Finalizada</span>
    </div>
    <strong className="nvu-completed-operation-name">{result.contractName}</strong>
    <div className="nvu-completed-operation-footer">
      <div className="nvu-completed-operation-metrics">
        <span title={result.tempoExecucao}>{result.totalViagens} {result.totalViagens === 1 ? "viagem" : "viagens"}</span>
        {Boolean(result.moneyGroups?.length) && <div className="nvu-completed-money"><HistoryMoneySummary groups={result.moneyGroups!} /></div>}
      </div>
      <button type="button" onClick={onReview} aria-label="Ver resultado da operação finalizada">
        Ver resultado <ChevronRight size={17} aria-hidden="true" />
      </button>
    </div>
    {(result.moneyGroups || []).reduce((sum, value) => sum + value.tripCount, 0) < result.totalViagens &&
      <p className="nvu-completed-operation-pending">Ganhos das viagens disponíveis. O restante será exibido ao sincronizar o histórico.</p>}
  </section>;
}
