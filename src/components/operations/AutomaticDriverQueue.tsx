import React, { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, RefreshCw, Route, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { useAutomaticOperations } from "../../contexts/AutomaticOperationsProvider";
import { useOperationalStore } from "../../context/AppContext";
import type {
  QueueNext,
  QueueItem,
  QueueVehicle,
} from "../../../functions/src/operationalQueueModel";
import { Button } from "../ui/Button";
import { driverQueuePresentation } from "../../lib/driverQueuePresentation";
import {
  CompactVehicleChoices,
  OperationalQueueDialog,
  QueueOperationRow,
  queueError,
} from "./OperationalQueueUI";
type Confirmation = {
  next: QueueNext;
  item: QueueItem;
  vehicles: QueueVehicle[];
  scopeKey: string;
};
export function AutomaticDriverQueue({ blocked = false, variant = "section", toolsSlot = null }: {
  blocked?: boolean;
  /** "tab" is the always-open body of the horizontal Painel do motorista card. */
  variant?: "section" | "tab";
  toolsSlot?: HTMLElement | null;
}) {
  const api = useAutomaticOperations(),
    { startAutomaticOperation } = useOperationalStore();
  return (
    <DriverQueuePanel
      key={api.scopeKey}
      api={api}
      onStart={startAutomaticOperation}
      blocked={blocked}
      variant={variant}
      toolsSlot={toolsSlot}
    />
  );
}
export function DriverQueuePanel({
  api,
  onStart,
  blocked = false,
  variant = "section",
  toolsSlot = null,
}: {
  api: Pick<
    import("../../contexts/AutomaticOperationsProvider").AutomaticOperationsStore,
    | "view"
    | "loading"
    | "error"
    | "offline"
    | "fresh"
    | "offlineAvailable"
    | "localCommandPending"
    | "refresh"
    | "scopeKey"
  >;
  onStart: (next: QueueNext, vehicleId: string) => Promise<void>;
  blocked?: boolean;
  variant?: "section" | "tab";
  toolsSlot?: HTMLElement | null;
}) {
  const {
    view,
    loading,
    error,
    offline,
    fresh,
    offlineAvailable,
    localCommandPending,
    refresh,
    scopeKey,
  } = api;
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const regionId = useId();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [showAll, setShowAll] = useState(false);
  if (!view?.queues.length) return null;
  const presentation = driverQueuePresentation(view);
  const { next, done, count, percent } = presentation;
  const tab = variant === "tab";
  const isExpanded = tab || (expanded ?? view.reason === "ready");
  const visibleItems = showAll ? presentation.items : presentation.preview;
  const reason =
    view.reason === "running"
      ? "Continue sua operação atual. A próxima ficará disponível após finalizar."
      : view.reason === "manual_pending"
        ? "Você tem um trabalho encaminhado pela empresa. Inicie-o primeiro."
        : view.reason === "review"
          ? "A empresa precisa conferir os trabalhos indicados antes do próximo início."
          : view.reason === "vehicles_unconfigured" ||
              view.reason === "no_vehicles"
            ? "Nenhum veículo disponível neste momento."
            : view.reason === "complete"
              ? "Não há novos trabalhos disponíveis nas filas ativas."
              : null;
  const stale = Boolean(
    confirmation &&
      (confirmation.scopeKey !== scopeKey ||
        confirmation.next.previewToken !== view.next?.previewToken ||
        JSON.stringify(confirmation.vehicles) !==
          JSON.stringify(view.vehicles)),
  );
  const startDisabled = (!fresh && !offlineAvailable) || busy || blocked || Boolean(localCommandPending);
  const chooseNextVehicle = () => {
    if (!next || !view.next || view.reason !== "ready" || startDisabled || submitting.current) return;
    setConfirmation({ next: view.next, item: next, vehicles: view.vehicles, scopeKey });
    setSelected(view.vehicles.some(vehicle => vehicle.id === view.lastVehicleId)
      ? view.lastVehicleId! : view.vehicles.length === 1 ? view.vehicles[0].id : "");
  };
  const feedbackVisible = Boolean(offline || !fresh || error || (!tab && reason) || blocked);
  const refreshControl = <button type="button" aria-label="Atualizar fila" title="Atualizar fila"
    onClick={() => void refresh()} disabled={loading || offline} className="nvu-queue-refresh">
    <RefreshCw size={16} className={loading ? "animate-spin" : ""} aria-hidden="true" />
  </button>;
  return (
    <section className={tab ? "nvu-driver-queue nvu-driver-queue--tab nvu-workspace-theme" : "nvu-driver-queue nvu-workspace-theme"} data-testid="automatic-driver-queue" aria-label="Fila operacional automática">
      {tab ? <header className="nvu-queue-summary">
        <div className="nvu-queue-progress" role="progressbar" aria-label="Progresso da fila operacional"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${done} de ${count} realizadas`}>
          <span style={{ width: `${percent}%` }} />
        </div>
        {reason && <p className="nvu-queue-summary-text">{reason}</p>}
      </header> : <header className="nvu-queue-heading">
        <h2><button type="button" aria-label="Fila operacional" aria-expanded={isExpanded}
          aria-controls={regionId} onClick={() => setExpanded(!isExpanded)}>
          <Route size={20} strokeWidth={1.7} aria-hidden="true" />
          <span className="nvu-queue-heading-title">Fila operacional</span>
          <span className="nvu-queue-heading-count">{done}/{count} realizadas</span>
          <ChevronDown size={18} aria-hidden="true" className={isExpanded ? "rotate-180" : ""} />
        </button></h2>
        <div className="nvu-queue-progress" role="progressbar" aria-label="Progresso da fila operacional"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${done} de ${count} realizadas`}>
          <span style={{ width: `${percent}%` }} />
        </div>
      </header>}
      {feedbackVisible && <div className="nvu-queue-feedback" aria-live="polite">
        {(offline || !fresh) && <p role="status">
          <WifiOff size={14} aria-hidden="true" />
          {offline ? "Sem conexão. O início será salvo no aparelho para sincronizar depois."
            : "Exibindo a última fila recebida. A confirmação será validada ao sincronizar."}
        </p>}
        {error && <p role="status" className="nvu-queue-warning">{queueError({ message: error })}</p>}
        {!tab && reason && <p>{reason}</p>}
        {blocked && <p>O início está indisponível durante a suspensão operacional.</p>}
        {!tab && refreshControl}
      </div>}
      {next && view.reason === "ready" && <div className="nvu-queue-next-action" role="group" aria-label="Próxima operação disponível">
        <div className="nvu-queue-next-information">
          <small>Próxima disponível</small>
          <strong>{next.name || "Operação"}</strong>
          <p className="nvu-queue-next-metadata"><span>{next.totalDeliveries ? `${next.totalDeliveries} ${next.totalDeliveries === 1 ? "viagem" : "viagens"}` : "Viagens a definir"}</span>
            <span>{next.deadlineDays ? `${next.deadlineDays} ${next.deadlineDays === 1 ? "dia" : "dias"}` : "Prazo a definir"}</span>
            <span>{next.mode === "detailed" ? "Roteiro definido" : "Rota livre"}</span></p>
          {next.trailerName && <span className="nvu-queue-next-trailer">{next.trailerName}</span>}
        </div>
        <div className="nvu-queue-next-controls">
          <span>Escolha o veículo para começar.</span>
          <Button type="button" size="sm" className="nvu-driver-start-work" disabled={startDisabled} onClick={chooseNextVehicle}>
            Iniciar trabalho
          </Button>
        </div>
      </div>}
      <div id={regionId} hidden={!isExpanded} className="nvu-queue-entries" role="region" aria-label="Operações da fila">
        {view.queues.map(queue => {
          const items = visibleItems.filter(item => item.queueId === queue.id);
          if (!items.length && queue.count) return null;
          return <div key={queue.id} className="nvu-queue-group">
            {(view.queues.length > 1 || queue.state === "paused") && <h3 className="nvu-queue-group-label">
              {queue.name || "Fila"}{queue.state === "paused" ? " · Pausada" : ""}
            </h3>}
            {items.map(item => <QueueOperationRow key={`${item.queueId}:${item.id}`} item={item}
              next={presentation.isNext(item)} variant="list" />)}
            {!queue.count && <p className="nvu-queue-empty">Esta pasta ainda não tem operações.</p>}
          </div>;
        })}
        {!visibleItems.length && Boolean(count) && <p className="nvu-queue-empty">
          {done === count ? "Todas as operações desta fila foram realizadas." : "Consulte a fila completa para conferir as operações."}
        </p>}
        {!tab && <div className="nvu-queue-tools">
          <button type="button" onClick={() => setShowAll(value => !value)} aria-controls={regionId} aria-pressed={showAll}>
            {showAll ? "Mostrar próximas operações" : "Ver fila completa"}<ChevronRight size={17} aria-hidden="true" />
          </button>
          {!feedbackVisible && refreshControl}
        </div>}
        {offlineAvailable && <p className="nvu-queue-saved-at">Fila salva neste aparelho · {new Date(view.generatedAt).toLocaleString("pt-BR", {
          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        })}</p>}
      </div>
      {tab && toolsSlot && createPortal(
        <div className="nvu-queue-tab-tools">
          <button type="button" className="nvu-queue-tab-all" onClick={() => setShowAll(value => !value)} aria-controls={regionId} aria-pressed={showAll}>
            {showAll ? "Próximas operações" : "Ver fila completa"}
          </button>
          {refreshControl}
        </div>, toolsSlot)}
      {confirmation && (
        <OperationalQueueDialog
          title="Escolher veículo"
          busy={busy}
          onClose={() => setConfirmation(null)}
        >
          <div className="space-y-4">
            <div>
              <p className="mb-1 text-xs text-slate-500 dark:text-nvu-muted">
                Próxima operação
              </p>
              <h3 className="font-semibold">{confirmation.item.name}</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-nvu-muted">
                {confirmation.item.totalDeliveries} viagem(ns) ·{" "}
                {confirmation.item.deadlineDays} dia(s)
              </p>
            </div>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-nvu-text-soft">
              Escolha um dos veículos disponíveis. Ele será utilizado até o fim
              desta operação.
            </p>
            <CompactVehicleChoices
              vehicles={confirmation.vehicles}
              selected={selected}
              onSelect={setSelected}
              disabled={busy || stale}
            />
            {stale && (
              <p
                role="alert"
                className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
              >
                A fila ou os veículos foram atualizados. Volte e confira a
                seleção atual.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={busy}
                onClick={() => setConfirmation(null)}
              >
                Voltar
              </Button>
              <Button
                className="flex-1"
                disabled={
                  startDisabled || stale || !selected
                }
                onClick={async () => {
                  if (submitting.current || startDisabled || stale || !selected) return;
                  submitting.current = true;
                  const nextToStart = confirmation.next;
                  setBusy(true);
                  try {
                    await onStart(nextToStart, selected);
                    setConfirmation(null);
                    toast.message("Operação salva no aparelho. Sincronização pendente.");
                    void refresh();
                  } catch (e) {
                    toast.error(queueError(e));
                    void refresh();
                  } finally {
                    submitting.current = false;
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Confirmando…" : "Confirmar e iniciar"}
              </Button>
            </div>
          </div>
        </OperationalQueueDialog>
      )}
    </section>
  );
}
