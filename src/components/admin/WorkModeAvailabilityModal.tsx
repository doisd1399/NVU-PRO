import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Loader2,
  Power,
  PowerOff,
  Save,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  getWorkModeAvailability,
  updateWorkModeAvailability,
  getSimulatorLabel,
  WORK_MODE_SIMULATORS,
  type WorkModeAvailability,
  type WorkMode,
} from "../../services/workModeAvailabilityService";

const modes: WorkMode[] = ["print", "pro", "max"];
const MODE_LABELS: Record<WorkMode, string> = {
  print: "Print",
  pro: "Pro",
  max: "Max",
};

type PendingModeToggle = {
  mode: WorkMode;
  nextEnabled: boolean;
  affected: string[];
};

const cloneAvailability = (value: WorkModeAvailability): WorkModeAvailability => ({
  ...value,
  print: { ...value.print, simulators: { ...value.print.simulators } },
  pro: { ...value.pro, simulators: { ...value.pro.simulators } },
  max: { ...value.max, simulators: { ...value.max.simulators } },
});

export function WorkModeAvailabilityModal({
  isOpen,
  onClose,
  simulators = [],
}: {
  isOpen: boolean;
  onClose: () => void;
  simulators?: any[];
}) {
  const [value, setValue] = useState<WorkModeAvailability | null>(null);
  const [initialValue, setInitialValue] = useState<WorkModeAvailability | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [pendingModeToggle, setPendingModeToggle] = useState<PendingModeToggle | null>(null);

  const simulatorLabels = useMemo(() => {
    const labels = new Map<string, string>();
    const compact = (input: unknown) =>
      String(input || "")
        .trim()
        .toLocaleLowerCase("pt-BR")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[\s_-]+/g, "");

    for (const simulator of Array.isArray(simulators) ? simulators : []) {
      const candidates = [
        simulator?.id,
        simulator?.key,
        simulator?.code,
        simulator?.name,
        simulator?.simulatorName,
      ];
      const label = String(
        simulator?.name || simulator?.simulatorName || simulator?.label || simulator?.id || "",
      ).trim();
      if (!label) continue;
      for (const candidate of candidates) {
        const normalized = compact(candidate);
        if (normalized) labels.set(normalized, label);
      }
    }
    return labels;
  }, [simulators]);

  const labelForSimulator = (key: string) => {
    const normalized = String(key)
      .trim()
      .toLocaleLowerCase("pt-BR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\s_-]+/g, "");
    return simulatorLabels.get(normalized) || getSimulatorLabel(key);
  };

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setValue(null);
    setInitialValue(null);
    setPendingModeToggle(null);
    setError("");
    setLoading(true);

    void getWorkModeAvailability()
      .then((result) => {
        if (!active) return;
        const next = cloneAvailability(result);
        setValue(next);
        setInitialValue(cloneAvailability(next));
      })
      .catch((reason) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Não foi possível carregar o controle de envio.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, retry]);

  const dirty = useMemo(
    () => Boolean(value && initialValue && JSON.stringify(value) !== JSON.stringify(initialValue)),
    [initialValue, value],
  );

  if (!isOpen || typeof document === "undefined") return null;

  const updateMode = (
    mode: WorkMode,
    updater: (current: WorkModeAvailability[WorkMode]) => WorkModeAvailability[WorkMode],
  ) => {
    setValue((current) =>
      current
        ? {
            ...current,
            [mode]: updater(current[mode]),
          }
        : current,
    );
  };

  const toggleSimulator = (mode: WorkMode, key: string) => {
    updateMode(mode, (current) => {
      const willEnable = current.simulators[key] === false;
      const simulatorsState = { ...current.simulators, [key]: willEnable };
      return {
        enabled: WORK_MODE_SIMULATORS[mode].some(
          (simulatorKey) => simulatorsState[simulatorKey] !== false,
        ),
        simulators: simulatorsState,
      };
    });
  };

  const setAllForMode = (mode: WorkMode, enabled: boolean) => {
    updateMode(mode, (current) => ({
      ...current,
      enabled,
      simulators: Object.fromEntries(
        WORK_MODE_SIMULATORS[mode].map((key) => [key, enabled]),
      ),
    }));
  };

  const requestModeToggle = (mode: WorkMode) => {
    if (!value) return;
    const current = value[mode];
    const currentlyEnabled = current.enabled !== false;
    const nextEnabled = !currentlyEnabled;
    const affected = WORK_MODE_SIMULATORS[mode].filter((key) =>
      nextEnabled ? current.simulators[key] === false : current.simulators[key] !== false,
    );

    if (nextEnabled && affected.length === 0) {
      setAllForMode(mode, true);
      return;
    }

    setPendingModeToggle({ mode, nextEnabled, affected });
  };

  const confirmModeToggle = () => {
    if (!pendingModeToggle) return;
    const { mode, nextEnabled, affected } = pendingModeToggle;
    if (nextEnabled) {
      setAllForMode(mode, true);
    } else {
      updateMode(mode, (current) => {
        const simulatorsState = { ...current.simulators };
        for (const key of affected) simulatorsState[key] = false;
        return {
          enabled: WORK_MODE_SIMULATORS[mode].some(
            (key) => simulatorsState[key] !== false,
          ),
          simulators: simulatorsState,
        };
      });
    }
    setPendingModeToggle(null);
  };

  const save = async () => {
    if (!value || saving || !dirty) return;
    setSaving(true);
    try {
      await updateWorkModeAvailability(value, value.version);
      toast.success("Controle de envio atualizado.");
      onClose();
    } catch (reason) {
      toast.error(
        reason instanceof Error
          ? reason.message
          : "Não foi possível salvar o controle de envio.",
      );
      try {
        const refreshed = await getWorkModeAvailability();
        setValue(cloneAvailability(refreshed));
        setInitialValue(cloneAvailability(refreshed));
      } catch {
        // The original save error is the actionable message. Keep it visible.
      }
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[240] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="work-mode-availability-title"
      >
        <div className="flex max-h-[min(92vh,820px)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-nvu-line dark:bg-nvu-surface">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-white/10">
            <div>
              <h2
                id="work-mode-availability-title"
                className="text-lg font-bold text-slate-900 dark:text-white"
              >
                Controle de envio de viagens
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-nvu-muted">
                Pause novas entradas por modo e simulador. Operações já iniciadas não serão encerradas.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              aria-label="Fechar"
              className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-white/5"
            >
              <X size={18} />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
                <Loader2 size={18} className="animate-spin" />
                Carregando configuração atual...
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
                <p>{error}</p>
                <button
                  type="button"
                  onClick={() => setRetry((current) => current + 1)}
                  className="mt-3 rounded-xl border border-red-200 px-3 py-2 text-xs font-bold dark:border-red-800"
                >
                  Tentar novamente
                </button>
              </div>
            ) : (
              value &&
              modes.map((mode) => {
                const modeValue = value[mode];
                const simulatorKeys = WORK_MODE_SIMULATORS[mode];
                const enabledCount = simulatorKeys.filter(
                  (key) => modeValue.simulators[key] !== false,
                ).length;
                const modeEnabled = modeValue.enabled !== false;

                return (
                  <section
                    key={mode}
                    className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        {modeEnabled ? (
                          <Power size={19} className="text-emerald-600 dark:text-emerald-300" />
                        ) : (
                          <PowerOff size={19} className="text-amber-600 dark:text-amber-300" />
                        )}
                        <div>
                          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-900 dark:text-white">
                            {MODE_LABELS[mode]}
                          </h3>
                          <p className="text-[11px] text-slate-500 dark:text-nvu-muted">
                            {modeEnabled ? "Ativo" : "Pausado"} · {enabledCount}/{simulatorKeys.length} simuladores liberados
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={modeEnabled}
                        onClick={() => requestModeToggle(mode)}
                        disabled={saving}
                        className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full p-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 ${
                          modeEnabled ? "bg-emerald-500" : "bg-slate-300 dark:bg-nvu-strip"
                        }`}
                      >
                        <span
                          className={`block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                            modeEnabled ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-nvu-muted">
                        Simuladores liberados
                      </span>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setAllForMode(mode, true)}
                          disabled={saving}
                          className="rounded-lg px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-400/10"
                        >
                          Selecionar todos
                        </button>
                        <button
                          type="button"
                          onClick={() => setAllForMode(mode, false)}
                          disabled={saving}
                          className="rounded-lg px-2 py-1 text-[10px] font-bold text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-400/10"
                        >
                          Desmarcar todos
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {simulatorKeys.map((key) => {
                        const checked = modeValue.simulators[key] !== false;
                        return (
                          <label
                            key={key}
                            className="flex min-h-12 cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-white/10 dark:bg-nvu-surface"
                          >
                            <span className="font-semibold text-slate-700 dark:text-nvu-text">
                              {labelForSimulator(key)}
                            </span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSimulator(mode, key)}
                              disabled={saving}
                              className="peer sr-only"
                            />
                            <span
                              className={`flex h-6 w-6 items-center justify-center rounded-lg border transition-colors ${
                                checked
                                  ? "border-emerald-500 bg-emerald-500 text-white"
                                  : "border-slate-300 text-transparent dark:border-nvu-line"
                              }`}
                            >
                              <Check size={15} />
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                );
              })
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-4 py-4 sm:flex-row sm:justify-end dark:border-white/10">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-11 rounded-2xl border border-slate-200 px-5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:text-nvu-text dark:hover:bg-white/5"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || loading || !value || !dirty}
              className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {saving ? "Salvando..." : "Salvar controle"}
            </button>
          </div>
        </div>
      </div>

      {pendingModeToggle && (
        <div
          className="fixed inset-0 z-[260] flex items-center justify-center bg-slate-950/45 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="work-mode-toggle-title"
        >
          <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-nvu-line dark:bg-nvu-surface">
            <h3
              id="work-mode-toggle-title"
              className="text-base font-bold text-slate-900 dark:text-white"
            >
              {pendingModeToggle.nextEnabled
                ? `Reativar Modo ${MODE_LABELS[pendingModeToggle.mode]}?`
                : "Colocar modo em manutenção?"}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-nvu-text-soft">
              {pendingModeToggle.nextEnabled
                ? "Os motoristas voltarão a poder iniciar novas viagens nos simuladores selecionados."
                : `Você está pausando o Modo ${MODE_LABELS[pendingModeToggle.mode]} para:`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(pendingModeToggle.affected.length
                ? pendingModeToggle.affected
                : WORK_MODE_SIMULATORS[pendingModeToggle.mode]
              ).map((key) => (
                <span
                  key={key}
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 dark:bg-white/10 dark:text-nvu-text"
                >
                  {labelForSimulator(key)}
                </span>
              ))}
            </div>
            {!pendingModeToggle.nextEnabled && (
              <p className="mt-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                Novos acessos serão bloqueados. Operações já ativas continuam intactas.
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingModeToggle(null)}
                className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 dark:border-white/10 dark:text-nvu-text"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmModeToggle}
                className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white dark:bg-white dark:text-slate-900"
              >
                Confirmar {pendingModeToggle.nextEnabled ? "reativação" : "pausa"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
