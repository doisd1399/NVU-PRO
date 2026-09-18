import { Camera, CircleDot, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type GtoWorkMode = "print" | "simple" | "max";

type WorkModeDialogVariant = "gto" | "simple";

interface GtoWorkModeDialogProps {
  open: boolean;
  variant: WorkModeDialogVariant;
  simulatorLabel?: string;
  busy?: boolean;
  onClose: () => void;
  onSelect: (mode: GtoWorkMode) => void | Promise<void>;
}

export function GtoWorkModeDialog({
  open,
  variant,
  simulatorLabel,
  busy = false,
  onClose,
  onSelect,
}: GtoWorkModeDialogProps) {
  const [maxStep, setMaxStep] = useState(false);
  const isGto = variant === "gto";
  const title = isGto
    ? "Iniciar trabalho GTO"
    : `Iniciar trabalho ${simulatorLabel || "do simulador"}`;

  useEffect(() => {
    if (!open) setMaxStep(false);
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-[2px] p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="work-mode-title"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#15171c] shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-100 dark:border-white/5">
          <div>
            <h2
              id="work-mode-title"
              className="text-[16px] font-bold text-slate-900 dark:text-white"
            >
              {title}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
              {maxStep
                ? "O modo automático Max usa detecção inteligente de tela e a bolha NVU."
                : isGto
                  ? "Escolha como deseja registrar esta operação no GTO."
                  : "Escolha como deseja registrar esta operação no Modo pro."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
          >
            <X size={17} />
          </button>
        </div>

        <div className="p-3 space-y-2.5">
          {!maxStep ? (
            <>
              <button
                type="button"
                onClick={() => void onSelect("print")}
                disabled={busy}
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#1d2027] hover:bg-slate-100 dark:hover:bg-[#242832] disabled:opacity-60 active:scale-[0.995] transition-all p-3.5 text-left"
              >
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <Camera size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-[14px] text-slate-900 dark:text-white">
                      Modo print
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                      Abre o lançamento manual de viagem para informar origem, destino e enviar a captura do recebimento.
                    </p>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => void onSelect("simple")}
                disabled={busy}
                className="w-full rounded-xl border border-cyan-200/80 dark:border-cyan-400/20 bg-cyan-50/70 dark:bg-cyan-400/5 hover:bg-cyan-50 dark:hover:bg-cyan-400/10 disabled:opacity-60 active:scale-[0.995] transition-all p-3.5 text-left"
              >
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-xl bg-cyan-600 text-white flex items-center justify-center shrink-0">
                    <Sparkles size={19} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-[14px] text-slate-900 dark:text-white">
                      Modo pro
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                      {isGto
                        ? "Bolha NVU sem projeção: inicie a viagem, selecione origem e destino e finalize na tela de conclusão."
                        : "Bolha NVU sem projeção: selecione origem e destino e finalize na tela de conclusão."}
                    </p>
                  </div>
                </div>
              </button>

              {isGto && (
                <button
                  type="button"
                  onClick={() => setMaxStep(true)}
                  disabled={busy}
                  className="w-full rounded-xl border border-violet-200/80 dark:border-violet-400/20 bg-violet-50/70 dark:bg-violet-400/5 hover:bg-violet-50 dark:hover:bg-violet-400/10 disabled:opacity-60 active:scale-[0.995] transition-all p-3.5 text-left"
                >
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0">
                      <CircleDot size={19} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-[14px] text-slate-900 dark:text-white">
                        Modo automático Max
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                        Detecção inteligente de tela, fretes e conclusão com a bolha NVU exclusiva do GTO.
                      </p>
                    </div>
                  </div>
                </button>
              )}
            </>
          ) : (
            <>
              <div className="rounded-xl border border-violet-200/80 dark:border-violet-400/20 bg-violet-50/70 dark:bg-violet-400/5 p-3.5">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0">
                    <CircleDot size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-[14px] text-slate-900 dark:text-white">
                      Preparar modo automático Max
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                      A NVU vai solicitar as permissões necessárias, ativar a bolha e abrir o GTO com detecção inteligente.
                    </p>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onSelect("max")}
                disabled={busy}
                className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 active:scale-[0.995] transition-all px-4 py-3.5 text-white text-[14px] font-bold flex items-center justify-center gap-2"
              >
                <CircleDot size={18} />
                Ativar modo automático Max
              </button>
              <button
                type="button"
                onClick={() => setMaxStep(false)}
                disabled={busy}
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-4 py-3 text-[13px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5"
              >
                Voltar
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
