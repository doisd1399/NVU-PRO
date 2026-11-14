import React from "react";
import { Check, X } from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "../lib/utils";

export type SimulatorSelectionItem = {
  id: string;
  label: string;
};

type Props = {
  open: boolean;
  items: SimulatorSelectionItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  description?: string;
};

/** Shared simulator picker used by the driver Panel and Ranking. */
export function SimulatorSelectionModal({
  open,
  items,
  selectedId,
  onSelect,
  onClose,
  description = "Escolha o ambiente de trabalho do motorista.",
}: Props) {
  if (!open) return null;
  return createPortal(
    <div
      className="nvu-simulator-modal-overlay nvu-simulator-modal-overlay-native fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-[2px]"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="nvu-simulator-modal w-full max-w-[380px] max-h-[min(72vh,520px)] overflow-y-auto rounded-[28px] border border-slate-200 bg-white p-3 shadow-[0_24px_80px_rgba(15,23,42,0.30)] animate-in fade-in zoom-in-95 dark:border-nvu-line dark:bg-nvu-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ranking-simulator-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-1">
          <div>
            <p id="ranking-simulator-modal-title" className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-nvu-muted">Selecione o simulador</p>
            <p className="mt-1 text-[12px] text-slate-400 dark:text-nvu-muted">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-nvu-strip dark:hover:text-white"
            aria-label="Fechar seletor de simulador"
          >
            <X size={18} />
          </button>
        </div>
        <div className="grid gap-1.5 pt-1" role="listbox" aria-label="Simuladores disponíveis">
          {items.map((item) => {
            const isSelected = item.id === selectedId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelect(item.id);
                  onClose();
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-2xl border px-3.5 py-3 text-left transition-colors active:scale-[0.99]",
                  isSelected
                    ? "border-teal-300 bg-teal-50 text-slate-900 dark:border-teal-500/40 dark:bg-teal-500/10 dark:text-white"
                    : "border-transparent text-slate-600 hover:bg-slate-50 dark:text-nvu-text-soft dark:hover:bg-nvu-strip",
                )}
                role="option"
                aria-selected={isSelected}
              >
                <span className="truncate text-[13px] font-semibold">{item.label}</span>
                {isSelected && <Check size={17} className="shrink-0 text-teal-600 dark:text-teal-300" />}
              </button>
            );
          })}
          {items.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-slate-500">Nenhum simulador disponível</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
