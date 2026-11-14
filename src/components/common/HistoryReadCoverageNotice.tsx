import type { TripReadCoverage, TripReadCoverageStatus } from "../../lib/tripReadCoverage";
import { historyReadFailureCode } from "../../lib/historyReadFailure";
import { findSafeNativeAttemptForLocalRow, type NativeProQueueDiagnosticEntry } from "../../lib/localTripSyncDiagnostic";
import { copySafeDiagnosticToClipboard } from "../ProAttemptDiagnosticDetails";
import { toast } from "sonner";

const sourceLabels = {
  waiting: "aguardando resposta", cache: "cache local", pending: "escritas pendentes",
  server: "confirmada pelo servidor", failed: "falha de leitura",
};
const localLabels = { LOCAL_ONLY: "somente local", PENDING_SYNC: "aguardando envio", SYNCING: "envio em andamento", CONFLICT: "envio bloqueado; revisão necessária", UNKNOWN: "estado desconhecido" };
const queueLabels = { PENDING_SYNC: "aguardando envio", SYNCING: "envio em andamento", SERVER_CONFIRMED: "confirmação salva na fila", FAILED: "falha registrada", CONFLICT: "envio bloqueado; revisão necessária", UNKNOWN: "estado desconhecido" };
const operationLabels = { UPSERT: "registro", UPDATE: "edição", DELETE: "exclusão", UNKNOWN: "tipo desconhecido" };
const resultLabels = { SERVER_CONFIRMED: "servidor confirmou", NO_SERVER_CONFIRMATION: "sem confirmação do servidor", PENDING: "tentativa pendente", UNKNOWN: "resultado não determinado" };

export function HistoryReadCoverageNotice({ coverage, hasError = false, error, readCoverage,
  nativeQueueDiagnostics = [], nativeOwnerAuthenticated = false, authenticatedUserId = "", authorizedDriverIds = [],
  showDiagnostics = false, backgroundRefresh = false,
}: {
  coverage: TripReadCoverageStatus;
  hasError?: boolean;
  error?: unknown;
  readCoverage?: TripReadCoverage | null;
  nativeQueueDiagnostics?: NativeProQueueDiagnosticEntry[];
  nativeOwnerAuthenticated?: boolean;
  authenticatedUserId?: string;
  authorizedDriverIds?: string[];
  showDiagnostics?: boolean;
  /** A usable previous snapshot stays visible while a fresh read assembles. */
  backgroundRefresh?: boolean;
}) {
  const scopedHistory = readCoverage?.projectionMode === "scoped-history";
  const queryComplete = coverage === "complete" && !hasError;
  if (queryComplete && !scopedHistory) return null;
  const hasLocalPending = (readCoverage?.pendingLocalRows || 0) > 0;
  const hasUnobservedRows = readCoverage && readCoverage.confirmedSources === readCoverage.expectedSources && readCoverage.unverifiedProjectionRows > 0;
  // The normal app shows only a useful status message. Technical controls stay
  // out of the driver's history/results without hiding a failed or partial read.
  if (!showDiagnostics) {
    const pendingStorageUnavailable = readCoverage?.commandStorageAvailable === false;
    if (queryComplete && !hasLocalPending && !pendingStorageUnavailable) return null;
    if (backgroundRefresh && !hasError && !hasLocalPending && !pendingStorageUnavailable && !hasUnobservedRows && !readCoverage?.failedSources) return null;
    const message = hasError
      ? "Não foi possível atualizar todo o histórico. Os registros disponíveis foram mantidos; os totais podem estar incompletos. Uma nova tentativa será feita automaticamente."
      : hasLocalPending
        ? "Há viagens locais ainda sem confirmação de envio. Os registros disponíveis já podem ser consultados."
        : pendingStorageUnavailable
          ? "Não foi possível consultar as pendências deste aparelho. O histórico recebido foi preservado."
          : hasUnobservedRows
            ? "Há registros locais ainda não confirmados nesta consulta. Os totais podem estar incompletos."
            : "Atualizando o histórico. Os registros disponíveis já podem ser consultados; os totais ainda podem estar incompletos.";
    return <p role="status" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500 dark:border-nvu-line dark:bg-nvu-surface/30 dark:text-nvu-muted">{message}</p>;
  }
  return (
    <details className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs text-slate-600 dark:border-nvu-line dark:text-nvu-text-soft">
      <summary className="cursor-pointer select-none font-medium">Detalhes do histórico</summary>
      <div role="region" aria-label="Diagnóstico de leitura do histórico" className={`mt-2 rounded-xl border px-3.5 py-3 text-xs font-medium ${queryComplete
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200"
      : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200"}`}>
      {queryComplete
        ? `Consulta do histórico concluída no servidor para o escopo selecionado.${hasLocalPending ? ` ${readCoverage!.pendingLocalRows} envio(s) local(is) bloqueado(s) permanecem separados.` : ""}`
        : hasError
        ? "Não foi possível atualizar todo o histórico. Os registros disponíveis foram mantidos; os totais podem estar incompletos. Uma nova tentativa será feita automaticamente."
        : hasLocalPending
          ? "Há registros locais sem confirmação de sincronização. Os registros disponíveis já podem ser consultados; os totais ainda podem mudar."
          : hasUnobservedRows
            ? "Há registros locais ainda não confirmados nesta consulta. Os totais podem estar incompletos."
            : "Atualizando o histórico. Os registros disponíveis já podem ser consultados; os totais ainda podem estar incompletos."}
      {scopedHistory && hasLocalPending && <p className="mt-1">{readCoverage!.pendingLocalRows} registros locais aguardam resolução e são acompanhados separadamente. Um envio com falha não torna a consulta do servidor incompleta.</p>}
      {scopedHistory && readCoverage?.commandStorageAvailable === false && <p className="mt-1">Não foi possível consultar as pendências deste aparelho. O histórico recebido foi preservado.</p>}
      {(hasError || readCoverage) && (
        <details className="mt-2">
          <summary className="cursor-pointer underline underline-offset-2">Ver diagnóstico somente leitura</summary>
          <div className="mt-2 space-y-1 break-words font-normal">
            {hasError && <p>Código: {historyReadFailureCode(error)}</p>}
            {readCoverage && <>
              <p>Fontes confirmadas: {readCoverage.confirmedSources}/{readCoverage.expectedSources} · Registros recebidos: {readCoverage.physicalRows} · Recusados: {readCoverage.rejectedRows}</p>
              <p>Cache local: {readCoverage.fromCache ? "sim" : "não"} · Escritas pendentes no SDK: {readCoverage.hasPendingWrites ? "sim" : "não"}</p>
              <p>Registros sem confirmação na consulta: {readCoverage.unverifiedProjectionRows}{readCoverage.pendingLocalRows !== undefined ? ` · Registros locais não confirmados: ${readCoverage.pendingLocalRows}` : ""}</p>
              {readCoverage.historyAssessment && <>
                <p>Viagens elegíveis no escopo: {readCoverage.historyAssessment.eligibleRows} · Excluídas dos totais: {readCoverage.historyAssessment.excludedRows}</p>
                {readCoverage.historyAssessment.deletedOrCanceledRows > 0 && <p>Canceladas ou excluídas: {readCoverage.historyAssessment.deletedOrCanceledRows}</p>}
                {readCoverage.historyAssessment.missingDateRows > 0 && <p>Sem data válida: {readCoverage.historyAssessment.missingDateRows}</p>}
                {readCoverage.historyAssessment.notCompletedRows > 0 && <p>Sem estado de conclusão compatível: {readCoverage.historyAssessment.notCompletedRows}</p>}
                {readCoverage.historyAssessment.identityConflictRows > 0 && <p>Vínculo de empresa ou motorista incompatível: {readCoverage.historyAssessment.identityConflictRows}</p>}
                {readCoverage.historyAssessment.pendingWriteRows > 0 && <p>Escritas ainda pendentes no SDK: {readCoverage.historyAssessment.pendingWriteRows}</p>}
                {readCoverage.historyAssessment.locallyHiddenRows > 0 && <p>Exclusões locais preservadas: {readCoverage.historyAssessment.locallyHiddenRows}</p>}
              </>}
              {readCoverage.sources.map((source, index) => (
                <p key={`${source.field}-${index}`}>{source.field}: {sourceLabels[source.status]} · {source.rows} registros{source.errorCode ? ` · ${historyReadFailureCode({ code: source.errorCode })}` : ""}</p>
              ))}
              {readCoverage.localSyncDiagnostic && <div className="mt-2 space-y-2 border-t border-amber-500/20 pt-2">
                <p>Diagnóstico local somente leitura · leitura da fila: {readCoverage.localSyncDiagnostic.queueReadState === "read" ? "disponível" : readCoverage.localSyncDiagnostic.queueReadState === "invalid" ? "formato não reconhecido" : "indisponível"}</p>
              {readCoverage.localSyncDiagnostic.rows.map((row) => {
                const safeDiagnostic = findSafeNativeAttemptForLocalRow(
                  row, nativeQueueDiagnostics, authenticatedUserId, nativeOwnerAuthenticated, authorizedDriverIds,
                ) || row.safeDiagnostic;
                return <div key={row.record}>
                  <p>Registro local {row.record}: {localLabels[row.localState]} · Presente na consulta: {row.seenInQuery ? "sim" : "não"}</p>
                  <p>Fila: {row.queueStates.length ? row.queueStates.map((state) => queueLabels[state]).join(", ") : readCoverage.localSyncDiagnostic!.queueReadState === "read" ? "nenhum comando correspondente" : "não verificada"}{row.operations.length ? ` · ${row.operations.map((operation) => operationLabels[operation]).join(", ")}` : ""}</p>
                  {row.actorScope === "other" && <p>Comando vinculado a outra conta.</p>}
                  {row.alternatives > 0 && <p>Comandos alternativos preservados: {row.alternatives}</p>}
                  {row.errorCodes.length > 0 && <p>Código salvo: {row.errorCodes.join(", ")}</p>}
                  {row.recognizedReasons.length > 0 && <p>Motivo reconhecido: {row.recognizedReasons.join(", ")}</p>}
                  {Boolean(row.failureStages?.length) && <p>Etapa da falha: {row.failureStages!.join(", ")}</p>}
                  {safeDiagnostic ? <div className="mt-2 rounded-lg border border-emerald-300/60 bg-white/70 p-2 text-slate-800 dark:border-emerald-500/30 dark:bg-nvu-page/40 dark:text-nvu-text">
                    <dl className="grid gap-1">
                      <div>attemptId parcial: <span className="font-mono">{safeDiagnostic.attemptId}</span></div>
                      <div>jobId parcial: <span className="font-mono">{safeDiagnostic.jobId}</span></div>
                      <div>operationId parcial: <span className="font-mono">{safeDiagnostic.operationId}</span></div>
                      <div>canonicalTripId parcial: <span className="font-mono">{safeDiagnostic.canonicalTripId}</span></div>
                      <div>{safeDiagnostic.timestampLabel}: <span className="font-mono">{safeDiagnostic.timestamp}</span></div>
                      <div>queueStatus: <span className="font-mono">{safeDiagnostic.queueStatus}</span></div>
                      <div>Código bruto: <span className="font-mono">{safeDiagnostic.rawCode}</span></div>
                      <div>reasonCode: <span className="font-mono">{safeDiagnostic.reasonCode}</span></div>
                      <div>stage: <span className="font-mono">{safeDiagnostic.stage}</span></div>
                      <div>callable/fluxo: <span className="font-mono">{safeDiagnostic.callable}</span></div>
                      <div>Tentativas registradas: <span className="font-mono">{safeDiagnostic.attemptCount}</span></div>
                    </dl>
                    <p className="mt-2 break-words">Mensagem sanitizada: <span className="font-mono">{safeDiagnostic.serverMessage}</span></p>
                    <button type="button" onClick={() => void copySafeDiagnosticToClipboard(safeDiagnostic).then(
                      () => toast.success("Diagnóstico seguro copiado."),
                    ).catch(() => toast.error("Não foi possível copiar o diagnóstico."))}
                      className="mt-2 rounded-md border border-slate-300 px-3 py-1.5 font-semibold hover:bg-slate-100 dark:border-nvu-line dark:hover:bg-nvu-surface">
                      Copiar diagnóstico seguro
                    </button>
                  </div> : row.identityLink === "divergent"
                    ? <p className="mt-1">Detalhe local indisponível por incompatibilidade de identidade · authUid ↔ driverId: divergente. Valores completos e mensagem não são exibidos.</p>
                    : row.identityLink === "unverified"
                      ? <p className="mt-1">Detalhe local indisponível: vínculo entre proprietário autenticado e driverId não comprovado. Valores completos e mensagem não são exibidos.</p>
                      : row.safeMessages.length > 0 && <p>Mensagem: {row.safeMessages.join(" · ")}</p>}
                  <p>Resultado da tentativa: {resultLabels[row.result]}</p>
                </div>;
              })}
                {readCoverage.localSyncDiagnostic.hiddenRows > 0 && <p>Outros registros locais não confirmados: {readCoverage.localSyncDiagnostic.hiddenRows}</p>}
                <p>Presença na consulta confirma a leitura do documento; não confirma uma edição ou um envio local.</p>
              </div>}
            </>}
          </div>
        </details>
      )}
      </div>
    </details>
  );
}
