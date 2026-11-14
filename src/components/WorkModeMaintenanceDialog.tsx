import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { getSimulatorLabel, type WorkMode } from "../lib/workModeAvailability";

export function WorkModeMaintenanceDialog({
  mode,
  simulator,
  onClose,
}: {
  mode: WorkMode;
  simulator: unknown;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/60 px-5" role="presentation">
      <section role="alertdialog" aria-modal="true" aria-labelledby="work-maintenance-title" aria-describedby="work-maintenance-description" className="w-full max-w-md overflow-hidden rounded-[26px] bg-white text-slate-800 shadow-2xl dark:bg-nvu-surface dark:text-white">
        <div className="flex items-center gap-4 border-b border-slate-100 px-5 py-6 dark:border-nvu-line">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"><AlertTriangle size={29} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="work-maintenance-title" className="text-lg font-bold">Sistema em manutenção</h2>
            <p className="mt-1 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-nvu-muted">Modo {mode === "max" ? "automático" : mode} · {getSimulatorLabel(simulator)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar aviso" className="self-start rounded-lg p-1 text-slate-500"><X size={21} /></button>
        </div>
        <div id="work-maintenance-description" className="space-y-5 px-5 py-6 text-[15px] leading-7">
          <p className="font-semibold">O envio de viagens neste modo está temporariamente pausado.</p>
          <p className="text-slate-600 dark:text-nvu-text-soft">Nossa equipe está realizando manutenção no sistema. O acesso será liberado novamente quando o modo for ativado.</p>
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <CheckCircle2 size={19} className="mt-0.5 shrink-0" />
            <span>Novas operações não podem ser iniciadas enquanto esta manutenção estiver ativa.</span>
          </div>
        </div>
        <div className="border-t border-slate-100 px-5 py-5 dark:border-nvu-line">
          <button type="button" onClick={onClose} autoFocus className="h-12 w-full rounded-2xl bg-slate-900 font-bold text-white dark:bg-white dark:text-slate-900">Entendi</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
