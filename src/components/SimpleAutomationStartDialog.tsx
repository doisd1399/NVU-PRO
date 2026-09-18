import { useEffect } from "react";
import { createPortal } from "react-dom";
import { BusFront, CheckCircle2, Truck, X } from "lucide-react";
import type { SimpleAutomationSimulator } from "../lib/simpleAutomation";

interface SimpleAutomationStartDialogProps {
  open: boolean;
  simulator: SimpleAutomationSimulator | undefined;
  busy?: boolean;
  onClose: () => void;
  onStart: () => void | Promise<void>;
}

export function SimpleAutomationStartDialog({
  open,
  simulator,
  busy = false,
  onClose,
  onStart,
}: SimpleAutomationStartDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, open]);

  if (!open || !simulator || typeof document === "undefined") return null;
  const isBus = simulator.key === "wbds";

  return createPortal(
    <div
      className="fixed inset-0 z-[145] flex items-end justify-center bg-black/55 p-3 backdrop-blur-[2px] sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pro-automation-title"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-cyan-200/70 bg-white shadow-2xl dark:border-cyan-400/20 dark:bg-[#15171c]">
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 pb-3 pt-4 dark:border-white/5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-600 text-white">
              {isBus ? <BusFront size={20} /> : <Truck size={20} />}
            </div>
            <div>
              <h2 id="pro-automation-title" className="text-[16px] font-bold text-slate-900 dark:text-white">
                Modo pro
              </h2>
              <p className="mt-1 text-[12px] text-cyan-700 dark:text-cyan-300">{simulator.label}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Fechar"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-white/5"
          >
            <X size={17} />
          </button>
        </header>

        <div className="space-y-3 p-4">
          <div className="rounded-xl bg-cyan-50/80 p-3 text-[12px] leading-relaxed text-cyan-900 dark:bg-cyan-400/5 dark:text-cyan-100">
            Este modo usa a bolha NVU para escolher origem, destino, finalizar ou cancelar a viagem. Ele não usa projeção, observador, lista de fretes ou fluxo GTO Max.
          </div>
          <div className="space-y-2 text-[12px] text-slate-600 dark:text-slate-300">
            <div className="flex items-center gap-2"><CheckCircle2 size={15} className="text-emerald-500" /> Cidades configuradas por simulador.</div>
            <div className="flex items-center gap-2"><CheckCircle2 size={15} className="text-emerald-500" /> Origem e destino escolhidos manualmente.</div>
            <div className="flex items-center gap-2"><CheckCircle2 size={15} className="text-emerald-500" /> Finalização protegida contra ADS e bônus.</div>
          </div>
          <button
            type="button"
            onClick={() => void onStart()}
            disabled={busy}
            className="w-full rounded-xl bg-cyan-600 px-4 py-3.5 text-[14px] font-bold text-white transition-colors hover:bg-cyan-700 disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? "Preparando bolha…" : "Ativar Pro e abrir simulador"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
