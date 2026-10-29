import { ModalSelect } from "../ui/ModalSelect";
import React, { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ListOrdered,
  Plus,
  RefreshCw,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useAutomaticOperations, type QueuePreparationView } from "../../contexts/AutomaticOperationsProvider";
import { OperationalPreparationReview } from "./OperationalPreparationReview";
import { OperationalQueueActions } from "./OperationalQueueActions";
import { OperationalQueueGuide } from "./OperationalQueueGuide";
import {
  orderQueueContracts,
  type DriverQueueView,
  type QueueCatalog,
  type QueueSettings,
} from "../../../functions/src/operationalQueueModel";
import type { QueueMutation } from "../../application/operation/OperationalQueueClient";
import { Button } from "../ui/Button";
import {
  OperationalQueueDialog,
  QueueOperationRow,
  QueueOrderEditor,
  queueError,
  queueInput,
} from "../operations/OperationalQueueUI";

type Tab = "queues" | "vehicles" | "progress";
type Draft = {
  folderId: string;
  folderToken: string;
  audience: "all" | "selected";
  driverIds: string[];
  orderIds: string[];
  state: "active" | "paused";
  revision: number;
  editing: boolean;
};
export function OperationalQueuesManager({
  onClose,
  initialFolderId,
  initialTab = "queues",
  onCreateOperation,
  onCreateFolder,
}: {
  onClose: () => void;
  initialFolderId?: string;
  initialTab?: Tab;
  onCreateOperation?: () => void;
  onCreateFolder?: () => void;
}) {
  const api = useAutomaticOperations(),
    [catalog, setCatalog] = useState<QueueCatalog | null>(null),
    [tab, setTab] = useState<Tab>(initialTab);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [preparation, setPreparation] = useState<QueuePreparationView | null>(null);
  const [enableCommandsConfirmed, setEnableCommandsConfirmed] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null),
    [step, setStep] = useState(1),
    [ordering, setOrdering] = useState<{
      ids: string[];
      revision: number;
    } | null>(null),
    [actions, setActions] = useState<{ queueId: string; revision: number } | null>(null),
    [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const mutationInFlight = useRef(false);
  const scope = useRef(api.scopeKey);
  scope.current = api.scopeKey;
  function makeDraft(
    c: QueueCatalog,
    folderId?: string,
    startStep = 1,
    stateOverride?: Draft["state"],
  ) {
    const folder =
      c.folders.find((f) => f.id === folderId) ||
      c.folders.find(
        (f) =>
          !c.settings.queues.some(
            (q) => q.folderId === f.id && q.state !== "archived",
          ),
      );
    if (!folder) {
      toast.error("Crie uma pasta de operações ou edite uma fila existente.");
      return;
    }
    const old = c.settings.queues.find((q) => q.folderId === folder.id),
      items = c.contracts.filter((i) => i.sequenceId === folder.id);
    setActions(null);
    setConfirmingRemoval(false);
    setDraft({
      folderId: folder.id,
      folderToken: folder.token,
      audience: old?.audience || "all",
      driverIds: (old?.driverIds || []).filter((id) =>
        c.drivers.some((d) => d.id === id),
      ),
      orderIds: orderQueueContracts(items, old?.orderIds).map((c) => c.id),
      state: stateOverride || (old?.state === "paused" ? "paused" : "active"),
      revision: c.settings.revision,
      editing: Boolean(old && old.state !== "archived"),
    });
    setStep(startStep);
    setOrdering(null);
    setPreparation(null);
    setEnableCommandsConfirmed(false);
    setError(null);
  }
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError(null);
    setPreparation(null);
    setEnableCommandsConfirmed(false);
    void api
      .loadCatalog()
      .then((c) => {
        if (!disposed) {
          setCatalog(c);
          if (initialFolderId) makeDraft(c, initialFolderId);
        }
      })
      .catch((e) => {
        if (!disposed) setError(queueError(e));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [api.scopeKey]);
  async function reload() {
    const original = api.scopeKey;
    setLoading(true);
    try {
      const c = await api.loadCatalog();
      if (scope.current === original) {
        setCatalog(c);
        setError(null);
      }
    } catch (e) {
      if (scope.current === original) setError(queueError(e));
    } finally {
      if (scope.current === original) setLoading(false);
    }
  }
  async function perform(
    input: Omit<QueueMutation, "companyId">,
    message: string,
  ) {
    if (mutationInFlight.current || api.offline) return;
    mutationInFlight.current = true;
    const original = api.scopeKey;
    setBusy(true);
    setError(null);
    try {
      const activates = (input.action === "saveQueue" && (input.queue as any)?.state === "active") ||
        (input.action === "setState" && input.state === "active");
      if (activates) {
        const check = await api.loadPreparation();
        if (scope.current !== original) return;
        if (!check.enabled && input.action === "setState") {
          const c = await api.loadCatalog();
          if (scope.current !== original) return;
          const queueToResume = c.settings.queues.find(
            (queue) => queue.id === String(input.queueId || ""),
          );
          if (
            !queueToResume ||
            queueToResume.state === "archived" ||
            !c.folders.some((folder) => folder.id === queueToResume.folderId)
          ) {
            setError("A fila ou sua pasta mudou. Atualize a configuração antes de retomar.");
            return;
          }
          setCatalog(c);
          makeDraft(c, queueToResume.folderId, 3, "active");
          setPreparation(check);
          setEnableCommandsConfirmed(false);
          setError(
            check.ready
              ? null
              : "Confira os trabalhos indicados antes de ativar a fila.",
          );
          return;
        }
        if (!check.enabled && !check.ready) {
          setPreparation(check);
          setEnableCommandsConfirmed(false);
          setError("Confira os trabalhos indicados antes de ativar a fila.");
          return;
        }
        if (!check.enabled) {
          setPreparation(check);
          if (!enableCommandsConfirmed) {
            setError(null);
            return;
          }
          try {
            const enabled = await api.enableOperationalCommands();
            if (
              !enabled.success ||
              enabled.companyId !== check.companyId ||
              enabled.version !== 1 ||
              !enabled.ready ||
              !enabled.enabled
            )
              throw new Error(
                "O servidor não confirmou a habilitação. A fila não foi ativada.",
              );
            const verified = await api.loadPreparation();
            if (scope.current !== original) return;
            if (!verified.enabled || !verified.ready) {
              setPreparation(verified);
              setEnableCommandsConfirmed(false);
              setError(
                "A habilitação ainda não foi confirmada pela conferência do servidor. A fila não foi ativada.",
              );
              return;
            }
            setPreparation(verified);
            setEnableCommandsConfirmed(false);
          } catch (enableError) {
            setEnableCommandsConfirmed(false);
            try {
              const fresh = await api.loadPreparation();
              if (scope.current === original) setPreparation(fresh);
            } catch {
              /* Preserve the enable error and the unchanged queue draft. */
            }
            throw enableError;
          }
        } else {
          setPreparation(null);
          setEnableCommandsConfirmed(false);
        }
      }
      await api.save(input);
      if (scope.current !== original) return;
      setDraft(null);
      setOrdering(null);
      setActions(null);
      setConfirmingRemoval(false);
      setPreparation(null);
      setEnableCommandsConfirmed(false);
      toast.success(message);
      void reload();
    } catch (e: any) {
      if (scope.current !== original) return;
      setError(queueError(e));
      if (e?.details?.reasonCode === "LEGACY_OPERATION_PREPARATION_REQUIRED") {
        try {
          const check = await api.loadPreparation();
          if (scope.current === original) setPreparation(check);
        } catch { /* Keep the original activation error visible. */ }
      }
      if (String(e?.code || "").includes("aborted")) {
        setDraft(null);
        setOrdering(null);
        try {
          const c = await api.loadCatalog();
          if (scope.current === original) setCatalog(c);
        } catch (reloadError) {
          if (scope.current === original) setError(queueError(reloadError));
        }
      }
    } finally {
      mutationInFlight.current = false;
      if (scope.current === original) setBusy(false);
    }
  }
  async function refreshPreparation() {
    const original = api.scopeKey;
    setBusy(true);
    try {
      const check = await api.loadPreparation();
      if (scope.current === original) { setPreparation(check); setError(null); }
    } catch (e) { if (scope.current === original) setError(queueError(e)); }
    finally { if (scope.current === original) setBusy(false); }
  }
  async function repairPreparation(input: Omit<QueueMutation, "companyId">) {
    const original = api.scopeKey;
    setBusy(true);
    setError(null);
    try {
      await api.save(input);
      const c = await api.loadCatalog();
      const check = await api.loadPreparation();
      if (scope.current !== original) return;
      setCatalog(c);
      setPreparation(check);
      setEnableCommandsConfirmed(false);
      // Repairs change settings revision, but never the user's chosen order.
      setDraft((current) => current ? { ...current, revision: c.settings.revision } : null);
      toast.success("Conferência registrada. Confira o resultado antes de ativar.");
    } catch (e: any) {
      if (scope.current !== original) return;
      setError(queueError(e));
      if (String(e?.code || "").includes("aborted")) {
        try {
          const c = await api.loadCatalog(), check = await api.loadPreparation();
          if (scope.current === original) {
            setCatalog(c); setPreparation(check);
            setEnableCommandsConfirmed(false);
            setDraft((current) => current ? { ...current, revision: c.settings.revision } : null);
          }
        } catch { /* Keep the stale confirmation error visible. */ }
      }
    } finally { if (scope.current === original) setBusy(false); }
  }
  const names = new Map(catalog?.contracts.map((c) => [c.id, c.name]) || []),
    folders = new Map(catalog?.folders.map((f) => [f.id, f.name]) || []);
  const queues =
    catalog?.settings.queues.filter((q) => q.state !== "archived") || [];
  const stale = Boolean(
    catalog &&
      api.settings &&
      api.settings.revision > catalog.settings.revision,
  );
  const unusedFolders = catalog?.folders.filter((f) => !queues.some((q) => q.folderId === f.id)) || [];
  const actionQueue = actions && catalog?.settings.queues.find((q) => q.id === actions.queueId && q.state !== "archived");
  function closeActions() {
    setActions(null);
    setConfirmingRemoval(false);
    setError(null);
  }
  if (actions && actionQueue && catalog) {
    const blocked = api.offline
      ? "Você está offline. Conecte-se à internet para alterar esta fila."
      : stale || catalog.settings.revision !== actions.revision
        ? "A configuração mudou. Volte às filas e atualize antes de alterar."
        : null;
    return (
      <OperationalQueueDialog key="queue-actions" title={confirmingRemoval ? "Remover fila" : "Ações da fila"} centered compact busy={busy} onClose={closeActions}>
        <OperationalQueueActions
          queue={actionQueue}
          name={folders.get(actionQueue.folderId) || "Pasta indisponível"}
          operationCount={catalog.contracts.filter((c) => c.sequenceId === actionQueue.folderId).length}
          confirmingRemoval={confirmingRemoval}
          busy={busy}
          blocked={blocked}
          error={error}
          onBack={closeActions}
          onRemove={() => setConfirmingRemoval(true)}
          onCancelRemove={() => setConfirmingRemoval(false)}
          onToggle={() => {
            if (blocked) return;
            void perform({ action: "setState", expectedRevision: actions.revision, queueId: actionQueue.id,
              state: actionQueue.state === "active" ? "paused" : "active" },
              actionQueue.state === "active" ? "Fila pausada" : "Fila retomada");
          }}
          onConfirmRemove={() => {
            if (blocked) return;
            void perform({ action: "setState", expectedRevision: actions.revision, queueId: actionQueue.id, state: "archived" }, "Fila retirada do envio automático");
          }}
        />
      </OperationalQueueDialog>
    );
  }
  return (
    <OperationalQueueDialog
      key="queue-manager"
      title="Filas operacionais"
      onClose={onClose}
      busy={busy}
    >
      <div className="space-y-4">
        <div
          role="tablist"
          aria-label="Gestão automática"
          className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-nvu-page"
        >
          {(
            [
              ["queues", "Filas"],
              ["vehicles", "Veículos"],
              ["progress", "Progresso"],
            ] as [Tab, string][]
          ).map(([value, label]) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === value}
              disabled={busy}
              key={value}
              onClick={() => setTab(value)}
              className={`min-w-0 flex-1 rounded-lg px-2 py-2 text-xs font-medium ${tab === value ? "bg-white shadow-sm dark:bg-nvu-strip" : "text-slate-500 dark:text-nvu-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {error && (
          <div
            role="alert"
            className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
          >
            {error}
          </div>
        )}
        {preparation && !preparation.ready && catalog && <OperationalPreparationReview preparation={preparation}
          catalog={catalog} busy={busy} offline={api.offline}
          onRefresh={refreshPreparation} onRepair={repairPreparation} />}
        {stale && !draft && !ordering && (
          <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
            <span className="flex-1">
              A configuração foi atualizada. Confira os dados atuais.
            </span>
            <Button size="sm" variant="outline" onClick={() => void reload()}>
              Atualizar
            </Button>
          </div>
        )}
        {loading && !catalog ? (
          <p className="py-8 text-center text-sm text-slate-500">
            Carregando operações e veículos…
          </p>
        ) : !catalog ? (
          <Button variant="outline" onClick={() => void reload()}>
            Tentar novamente
          </Button>
        ) : (
          <>
            {tab === "queues" && (
              <>
                {!draft && !ordering && (
                  <>
                    <div>
                      <h3 className="text-sm font-semibold">Envio automático de operações</h3>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-nvu-muted">Defina a sequência uma vez. O NVU libera a próxima operação para cada motorista após a conclusão da atual.</p>
                    </div>
                    <OperationalQueueGuide />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={busy || stale || api.offline || loading || !unusedFolders.length}
                        onClick={() => makeDraft(catalog)}
                      >
                        <Plus size={14} className="mr-1" />
                        Nova fila
                      </Button>
                      {queues.length > 1 && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || stale || api.offline}
                          onClick={() =>
                            setOrdering({
                              ids: queues.map((q) => q.id),
                              revision: catalog.settings.revision,
                            })
                          }
                        >
                          <ListOrdered size={14} className="mr-1" />
                          Organizar filas
                        </Button>
                      )}
                      <button
                        type="button"
                        aria-label="Atualizar configuração"
                        disabled={loading || api.offline}
                        onClick={() => void reload()}
                        className="ml-auto rounded-lg p-2 text-slate-500"
                      >
                        <RefreshCw
                          size={15}
                          className={loading ? "animate-spin" : ""}
                        />
                      </button>
                    </div>
                    {!queues.length && (
                      <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center dark:border-nvu-line">
                        <p className="text-sm font-medium">{catalog.folders.length ? "Crie sua primeira fila" : "Comece pelas operações e pastas"}</p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-nvu-muted">{catalog.folders.length ? "Toque em Nova fila, escolha a pasta e os motoristas e confira a ordem de envio." : "Crie as operações e reúna-as em uma pasta. Depois, volte aqui para ativar o envio automático."}</p>
                        {!catalog.folders.length && (onCreateOperation || onCreateFolder) && <div className="mt-3 flex flex-wrap justify-center gap-2">
                          {onCreateOperation && <Button size="sm" variant="outline" onClick={onCreateOperation}>Criar operação</Button>}
                          {onCreateFolder && <Button size="sm" variant="outline" onClick={onCreateFolder}>Criar pasta</Button>}
                        </div>}
                      </div>
                    )}
                    {Boolean(queues.length) && !unusedFolders.length && <p className="text-xs leading-relaxed text-slate-500 dark:text-nvu-muted">Todas as pastas já têm uma fila. Edite uma fila existente ou crie outra pasta para uma nova sequência.{onCreateFolder && <button type="button" onClick={onCreateFolder} className="ml-1 font-medium text-blue-700 underline underline-offset-2 dark:text-blue-300">Criar pasta</button>}</p>}
                    <div className="space-y-2">
                      {queues.map((q, i) => {
                        const operationCount = catalog.contracts.filter((c) => c.sequenceId === q.folderId).length;
                        return (
                        <div
                          key={q.id}
                          className="rounded-xl border border-slate-200 p-3 dark:border-nvu-line"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs tabular-nums text-slate-400">
                              {i + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <h3 className="truncate text-sm font-semibold">
                                {folders.get(q.folderId) ||
                                  "Pasta indisponível"}
                              </h3>
                              <p className="mt-1 text-xs text-slate-500 dark:text-nvu-muted">
                                {q.audience === "all"
                                  ? "Toda a frota"
                                  : `${q.driverIds.length} ${q.driverIds.length === 1 ? "motorista" : "motoristas"}`}{" "}
                                ·{" "}
                                {operationCount} {operationCount === 1 ? "operação" : "operações"}
                              </p>
                            </div>
                            <span
                              className={`text-[11px] ${q.state === "active" ? "text-emerald-700 dark:text-emerald-400" : "text-slate-500 dark:text-nvu-muted"}`}
                            >
                              {q.state === "active" ? "Ativa" : "Pausada"}
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy || stale || api.offline}
                              onClick={() => makeDraft(catalog, q.folderId, 2)}
                            >
                              Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy || stale || api.offline}
                              onClick={() => makeDraft(catalog, q.folderId, 3)}
                            >
                              Organizar operações
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="ml-auto text-slate-500 dark:text-nvu-text-soft"
                              aria-label={`Ações da fila ${folders.get(q.folderId) || "Pasta indisponível"}`}
                              disabled={busy || loading}
                              onClick={() => {
                                setActions({ queueId: q.id, revision: catalog.settings.revision });
                                setConfirmingRemoval(false);
                                setError(null);
                              }}
                            >
                              Ações <ChevronDown size={13} className="ml-1" aria-hidden="true" />
                            </Button>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </>
                )}
                {ordering && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold">Organizar filas</h3>
                    <p className="text-xs text-slate-500 dark:text-nvu-muted">
                      A primeira fila disponível tem prioridade. Arraste ou use
                      Subir e Descer.
                    </p>
                    <QueueOrderEditor
                      ids={ordering.ids}
                      names={
                        new Map(
                          queues.map((q) => [
                            q.id,
                            folders.get(q.folderId) || "Fila",
                          ]),
                        )
                      }
                      onChange={(ids) => setOrdering({ ...ordering, ids })}
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => setOrdering(null)}
                      >
                        Cancelar
                      </Button>
                      <Button
                        disabled={busy || api.offline}
                        onClick={() =>
                          void perform(
                            {
                              action: "reorderQueues",
                              expectedRevision: ordering.revision,
                              queueIds: ordering.ids,
                            },
                            "Ordem atualizada",
                          )
                        }
                      >
                        Salvar ordem
                      </Button>
                    </div>
                  </div>
                )}
                {draft && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="rounded-full bg-blue-50 px-2 py-1 font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                        Etapa {step} de 3
                      </span>
                      <h3 className="font-medium">
                        {step === 1
                          ? "Escolher pasta"
                          : step === 2
                            ? "Definir participantes"
                            : "Revisar e salvar"}
                      </h3>
                    </div>
                    {step === 1 && (
                      <>
                        <label className="block space-y-2 text-sm">
                          <span>Pasta de operações</span>
                          <ModalSelect title="Pasta de operações"
                            className={queueInput}
                            value={draft.folderId}
                            disabled={draft.editing}
                            onChange={(e) => makeDraft(catalog, e.target.value)}
                          >
                            {catalog.folders
                              .filter(
                                (f) =>
                                  f.id === draft.folderId ||
                                  !queues.some((q) => q.folderId === f.id),
                              )
                              .map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.name} ·{" "}
                                  {
                                    catalog.contracts.filter(
                                      (c) => c.sequenceId === f.id,
                                    ).length
                                  }{" "}
                                  operações
                                </option>
                              ))}
                          </ModalSelect>
                        </label>
                        <p className="text-xs leading-relaxed text-slate-500 dark:text-nvu-muted">
                          As operações desta pasta formam a sequência de envio.
                          Você ajusta a ordem antes de ativar a fila.
                        </p>
                      </>
                    )}
                    {step === 2 && (
                      <>
                        <p className="text-sm font-medium">
                          {folders.get(draft.folderId)}
                        </p>
                        <div className="space-y-2">
                          {(
                            [
                              ["all", "Toda a frota"],
                              ["selected", "Motoristas específicos"],
                            ] as const
                          ).map(([value, label]) => (
                            <label
                              key={value}
                              className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm dark:border-nvu-line"
                            >
                              <input
                                type="radio"
                                name="queue-audience"
                                className="accent-blue-600"
                                checked={draft.audience === value}
                                onChange={() =>
                                  setDraft({ ...draft, audience: value })
                                }
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                        {draft.audience === "all" ? (
                          <p className="text-xs text-slate-500 dark:text-nvu-muted">
                            Novos motoristas ativos também entram na fila.
                          </p>
                        ) : (
                          <div className="max-h-60 space-y-1 overflow-y-auto">
                            {catalog.drivers.map((d) => (
                              <label
                                key={d.id}
                                className="flex items-center gap-2 rounded-lg p-2 text-sm"
                              >
                                <input
                                  type="checkbox"
                                  className="accent-blue-600"
                                  checked={draft.driverIds.includes(d.id)}
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      driverIds: e.target.checked
                                        ? [...draft.driverIds, d.id]
                                        : draft.driverIds.filter(
                                            (id) => id !== d.id,
                                          ),
                                    })
                                  }
                                />
                                {d.name}
                              </label>
                            ))}
                            {!catalog.drivers.length && (
                              <p className="text-xs text-slate-500">
                                Nenhum motorista com vínculo ativo.
                              </p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {step === 3 && (
                      <>
                        <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-nvu-page">
                          <h3 className="font-semibold">
                            {folders.get(draft.folderId)}
                          </h3>
                          <p className="mt-1 text-xs text-slate-500 dark:text-nvu-muted">
                            {draft.audience === "all"
                              ? "Toda a frota"
                              : `${draft.driverIds.length} ${draft.driverIds.length === 1 ? "motorista" : "motoristas"}`}{" "}
                            · {draft.orderIds.length} {draft.orderIds.length === 1 ? "operação" : "operações"}
                          </p>
                        </div>
                        <p className="text-xs leading-relaxed text-slate-500 dark:text-nvu-muted">A operação do topo será enviada primeiro. Arraste ou use Subir e Descer para mudar a ordem.</p>
                        {!draft.orderIds.length && <p role="status" className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">Esta pasta ainda não tem operações. Adicione operações à pasta antes de ativar. Você pode salvar a fila pausada.</p>}
                        <QueueOrderEditor
                          ids={draft.orderIds}
                          names={names}
                          onChange={(orderIds) =>
                            setDraft({ ...draft, orderIds })
                          }
                        />
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="accent-blue-600"
                            checked={draft.state === "active"}
                            onChange={(e) => {
                              setDraft({
                                ...draft,
                                state: e.target.checked ? "active" : "paused",
                              });
                              if (!e.target.checked) setEnableCommandsConfirmed(false);
                            }}
                          />
                          Ativar ao salvar
                        </label>
                        {draft.state === "active" && preparation?.ready && !preparation.enabled && (
                          <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/60 p-3 text-sm dark:border-blue-500/30 dark:bg-blue-500/5">
                            <p className="text-xs leading-relaxed text-slate-700 dark:text-nvu-text-soft">
                              A conferência está concluída. Para usar o envio automático pela primeira vez, autorize a ativação para esta empresa. Os trabalhos atuais serão mantidos.
                            </p>
                            <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed">
                              <input
                                type="checkbox"
                                className="mt-0.5 accent-blue-600"
                                aria-label="Confirmo habilitar os comandos operacionais desta empresa"
                                checked={enableCommandsConfirmed}
                                disabled={busy || api.offline}
                                onChange={(e) => setEnableCommandsConfirmed(e.target.checked)}
                              />
                              Autorizo ativar a gestão automática de operações desta empresa.
                            </label>
                          </div>
                        )}
                        <p className="text-xs leading-relaxed text-slate-500 dark:text-nvu-muted">
                          As alterações valem para os próximos trabalhos.
                          Operações em andamento continuam com os mesmos dados.
                          Cada motorista confirma o início da próxima operação no aplicativo.
                        </p>
                        {!catalog.settings.vehicleIds?.length && (
                          <p className="text-xs text-amber-700 dark:text-amber-300">
                            Defina os veículos disponíveis na aba Veículos para
                            permitir novos inícios.
                          </p>
                        )}
                      </>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setDraft(null);
                          setPreparation(null);
                          setEnableCommandsConfirmed(false);
                        }}
                      >
                        Cancelar
                      </Button>
                      {step > 1 && (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setStep(step - 1)}
                        >
                          Voltar
                        </Button>
                      )}
                      {step < 3 ? (
                        <Button
                          className="ml-auto"
                          disabled={
                            draft.audience === "selected" &&
                            !draft.driverIds.length &&
                            step === 2
                          }
                          onClick={() => setStep(step + 1)}
                        >
                          Continuar
                        </Button>
                      ) : (
                        <Button
                          className="ml-auto"
                          disabled={
                            busy ||
                            api.offline ||
                            (draft.state === "active" && !draft.orderIds.length) ||
                            (draft.state === "active" && preparation !== null && !preparation.enabled && !preparation.ready) ||
                            (draft.state === "active" && preparation?.ready === true && !preparation.enabled && !enableCommandsConfirmed)
                          }
                          onClick={() =>
                            void perform(
                              {
                                action: "saveQueue",
                                expectedRevision: draft.revision,
                                folderToken: draft.folderToken,
                                queue: {
                                  folderId: draft.folderId,
                                  audience: draft.audience,
                                  driverIds: draft.driverIds,
                                  orderIds: draft.orderIds,
                                  state: draft.state,
                                },
                              },
                              "Fila salva",
                            )
                          }
                        >
                          {busy
                            ? "Salvando…"
                            : draft.editing
                              ? "Salvar fila"
                              : draft.state === "active"
                                ? "Ativar fila"
                                : "Salvar pausada"}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
            {tab === "vehicles" && (
              <VehicleAvailabilityEditor
                catalog={catalog}
                disabled={busy || api.offline || stale}
                onSave={(input) =>
                  perform(input, "Veículos disponíveis atualizados")
                }
              />
            )}
            {tab === "progress" && (
              <DriverProgress
                catalog={catalog}
                busy={busy}
                onReview={(input) => perform(input, "Histórico conferido")}
              />
            )}
          </>
        )}
      </div>
    </OperationalQueueDialog>
  );
}

function VehicleAvailabilityEditor({
  catalog,
  disabled,
  onSave,
}: {
  catalog: QueueCatalog;
  disabled: boolean;
  onSave: (input: Omit<QueueMutation, "companyId">) => Promise<void>;
}) {
  const [target, setTarget] = useState(""),
    [useDefault, setUseDefault] = useState(true),
    [chosen, setChosen] = useState<string[]>(catalog.settings.vehicleIds || []),
    [search, setSearch] = useState("");
  function changeTarget(value: string) {
    const override = catalog.settings.driverVehicles.find(
      (d) => d.driverId === value,
    );
    setTarget(value);
    setUseDefault(!override);
    setChosen(
      value
        ? override?.vehicleIds || catalog.settings.vehicleIds || []
        : catalog.settings.vehicleIds || [],
    );
  }
  useEffect(() => {
    const selected =
      target && catalog.drivers.some((d) => d.id === target) ? target : "";
    const override = catalog.settings.driverVehicles.find(
      (d) => d.driverId === selected,
    );
    if (selected !== target) setTarget(selected);
    setUseDefault(!override);
    setChosen(
      selected
        ? override?.vehicleIds || catalog.settings.vehicleIds || []
        : catalog.settings.vehicleIds || [],
    );
  }, [catalog.settings.revision, catalog.drivers, target]);
  const options = catalog.vehicles
    .filter(
      (v) => !target || (catalog.settings.vehicleIds || []).includes(v.id),
    )
    .filter(
      (v) =>
        !search ||
        `${v.name} ${v.plate || ""}`
          .toLocaleLowerCase("pt-BR")
          .includes(search.toLocaleLowerCase("pt-BR")),
    );
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Veículos disponíveis</h3>
      <p className="text-xs leading-relaxed text-slate-500 dark:text-nvu-muted">
        Selecione quais veículos aparecem para novos trabalhos. A seleção não
        muda o veículo de uma operação em andamento.
      </p>
      <label className="block space-y-2 text-xs">
        <span>Aplicar a</span>
        <ModalSelect title="Aplicar disponibilidade"
          aria-label="Aplicar a"
          className={queueInput}
          value={target}
          disabled={disabled}
          onChange={(e) => changeTarget(e.target.value)}
        >
          <option value="">Padrão da frota</option>
          {catalog.drivers.map((d) => (
            <option value={d.id} key={d.id}>
              {d.name}
            </option>
          ))}
        </ModalSelect>
      </label>
      {target && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useDefault}
            disabled={disabled}
            className="accent-blue-600"
            onChange={(e) => {
              setUseDefault(e.target.checked);
              if (e.target.checked)
                setChosen(catalog.settings.vehicleIds || []);
            }}
          />
          Usar padrão da frota
        </label>
      )}
      {target && catalog.settings.vehicleIds === null ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Selecione primeiro o padrão da frota.
        </p>
      ) : (
        <>
          <input
            className={queueInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar veículo…"
            aria-label="Buscar veículo"
          />
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-nvu-muted">
            <span>
              {
                chosen.filter(
                  (id) =>
                    catalog.vehicles.some((v) => v.id === id) &&
                    (!target ||
                      (catalog.settings.vehicleIds || []).includes(id)),
                ).length
              }{" "}
              selecionado(s)
            </span>
            <div className="flex gap-3">
              <button
                disabled={disabled || (Boolean(target) && useDefault)}
                type="button"
                onClick={() => setChosen(options.map((v) => v.id))}
              >
                Selecionar exibidos
              </button>
              <button
                disabled={disabled || (Boolean(target) && useDefault)}
                type="button"
                onClick={() => setChosen([])}
              >
                Limpar
              </button>
            </div>
          </div>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {options.map((v) => (
              <label
                key={v.id}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-nvu-line"
              >
                <input
                  type="checkbox"
                  checked={chosen.includes(v.id)}
                  disabled={disabled || (Boolean(target) && useDefault)}
                  className="h-4 w-4 accent-blue-600"
                  onChange={(e) =>
                    setChosen(
                      e.target.checked
                        ? [...chosen, v.id]
                        : chosen.filter((id) => id !== v.id),
                    )
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {v.name || "Veículo"}
                  </span>
                  {v.plate && (
                    <span className="block text-xs text-slate-500 dark:text-nvu-muted">
                      {v.plate}
                    </span>
                  )}
                </span>
                {v.status === "maintenance" && (
                  <span className="text-[10px] text-amber-700 dark:text-amber-300">
                    Em manutenção
                  </span>
                )}
              </label>
            ))}
            {!options.length && (
              <p className="p-3 text-center text-xs text-slate-500">
                Nenhum veículo nesta seleção.
              </p>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-nvu-muted">
            Salvar uma seleção vazia deixa o motorista sem opções para novos
            trabalhos.
          </p>
          <Button
            disabled={disabled}
            onClick={() =>
              void onSave({
                action: "saveVehicles",
                expectedRevision: catalog.settings.revision,
                driverId: target || undefined,
                useDefault: target ? useDefault : undefined,
                vehicleIds:
                  target && useDefault
                    ? []
                    : chosen.filter(
                        (id) =>
                          catalog.vehicles.some((v) => v.id === id) &&
                          (!target ||
                            (catalog.settings.vehicleIds || []).includes(id)),
                      ),
              })
            }
          >
            Salvar seleção
          </Button>
        </>
      )}
    </div>
  );
}

function DriverProgress({
  catalog,
  busy,
  onReview,
}: {
  catalog: QueueCatalog;
  busy: boolean;
  onReview: (input: Omit<QueueMutation, "companyId">) => Promise<void>;
}) {
  const api = useAutomaticOperations(),
    [driverId, setDriverId] = useState(""),
    [view, setView] = useState<DriverQueueView | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null),
    [reviewing, setReviewing] = useState(false),
    [done, setDone] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    let disposed = false;
    setView(null);
    setReviewing(false);
    setConfirmed(false);
    if (!driverId) return;
    setLoading(true);
    void api
      .loadProgress(driverId)
      .then((v) => {
        if (!disposed) {
          setView(v);
          setError(null);
        }
      })
      .catch((e) => {
        if (!disposed) setError(queueError(e));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [driverId, catalog.settings.revision, api.scopeKey]);
  const pendingReview = view?.items.filter((i) => i.state === "review") || [];
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Acompanhar motorista</h3>
      <ModalSelect title="Motorista da fila"
        aria-label="Motorista para acompanhamento"
        className={queueInput}
        value={driverId}
        disabled={busy}
        onChange={(e) => setDriverId(e.target.value)}
      >
        <option value="">Selecionar motorista</option>
        {catalog.drivers.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </ModalSelect>
      {loading && (
        <p className="text-xs text-slate-500">
          Conferindo os trabalhos no servidor…
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">
          {error}
        </p>
      )}
      {view && !reviewing && (
        <>
          {!view.queues.length && (
            <p className="text-xs text-slate-500">
              Nenhuma fila designada a este motorista.
            </p>
          )}
          {pendingReview.length > 0 && (
            <div className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              <p>
                Há registros antigos que não identificam com segurança o
                trabalho realizado. Confira antes de permitir o próximo início.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={busy || api.offline}
                onClick={() => {
                  setReviewing(true);
                  setDone([]);
                  setConfirmed(false);
                }}
              >
                Conferir histórico
              </Button>
            </div>
          )}
          {view.queues.map((q) => (
            <div key={q.id} className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{q.name}</span>
                <span className="text-slate-500">
                  {q.done}/{q.count} realizadas
                </span>
              </div>
              {view.items
                .filter((i) => i.queueId === q.id)
                .map((i) => (
                  <QueueOperationRow
                    key={i.id}
                    item={i}
                    next={view.next?.contractId === i.id}
                  />
                ))}
            </div>
          ))}
        </>
      )}
      {view && reviewing && (
        <div className="space-y-3">
          <p className="text-sm font-medium">
            Quais destas operações já foram realizadas?
          </p>
          <p className="text-xs leading-relaxed text-slate-500 dark:text-nvu-muted">
            Marque as realizadas. As demais ficarão a realizar. Esta conferência
            ficará registrada em nome da gestão.
          </p>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {pendingReview.map((i) => (
              <label
                key={i.id}
                className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm dark:border-nvu-line"
              >
                <input
                  className="mt-1 accent-blue-600"
                  type="checkbox"
                  checked={done.includes(i.id)}
                  disabled={busy}
                  onChange={(e) =>
                    setDone(
                      e.target.checked
                        ? [...done, i.id]
                        : done.filter((id) => id !== i.id),
                    )
                  }
                />
                <span>
                  <span className="font-medium">{i.name}</span>
                  <span className="mt-1 block text-[11px] text-slate-500 dark:text-nvu-muted">
                    {i.folderName} · posição {i.position + 1} ·{" "}
                    {i.totalDeliveries} viagem(ns)
                  </span>
                </span>
              </label>
            ))}
          </div>
          <label className="flex items-start gap-2 text-xs leading-relaxed">
            <input
              className="mt-0.5 accent-blue-600"
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Confirmo que conferi os trabalhos realizados por este motorista.
          </label>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setReviewing(false)}
            >
              Cancelar
            </Button>
            <Button
              disabled={busy || api.offline || !confirmed}
              onClick={() =>
                void onReview({
                  action: "reviewHistory",
                  expectedRevision: catalog.settings.revision,
                  driverId,
                  historyToken: view.historyToken,
                  reviewedIds: pendingReview.map((i) => i.id),
                  doneIds: done,
                  confirmed: true,
                })
              }
            >
              Salvar conferência
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AvailableVehiclesButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Veículos disponíveis
      </Button>
      {open && (
        <OperationalQueuesManager
          initialTab="vehicles"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
