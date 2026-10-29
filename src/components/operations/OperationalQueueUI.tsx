import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/Button";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  GripVertical,
  X,
} from "lucide-react";
import type {
  QueueItem,
  QueueVehicle,
} from "../../../functions/src/operationalQueueModel";
export const queuePanel =
  "rounded-2xl border border-slate-200 bg-white text-slate-900 dark:border-nvu-line dark:bg-nvu-surface dark:text-nvu-text";
export const queueInput =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-nvu-line dark:bg-nvu-page dark:text-nvu-text";
export function queueError(error: any): string {
  const message = String(
    error?.message || "Não foi possível confirmar esta ação.",
  );
  if (/SESSION_CHANGED/.test(message))
    return "Seu perfil mudou. Abra a fila novamente.";
  if (/QUEUE_PAGE_|QUEUE_SETTINGS_/.test(message))
    return "A lista não chegou completa. Atualize para tentar novamente.";
  return message;
}
export function OperationalQueueDialog({
  title,
  onClose,
  children,
  busy = false,
  centered = false,
  compact = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  busy?: boolean;
  centered?: boolean;
  compact?: boolean;
}) {
  const panel = useRef<HTMLElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null,
      overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        close.current();
      }
      if (e.key !== "Tab") return;
      const nodes = Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
        ) || [],
      ).filter((n) => n.offsetParent !== null);
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (!first) {
        e.preventDefault();
        return;
      }
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === panel.current)
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keys);
      previous?.focus();
    };
  }, [busy]);
  return createPortal(
    <div
      className={`fixed inset-0 z-[210] flex justify-center bg-black/55 p-3 backdrop-blur-[2px] sm:items-center sm:p-5 ${centered ? "items-center" : "items-end"}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`${queuePanel} flex max-h-[92dvh] w-full ${compact ? "max-w-md" : "max-w-2xl"} flex-col overflow-hidden shadow-2xl outline-none`}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 dark:border-nvu-line">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            aria-label="Fechar"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-nvu-text-soft dark:hover:bg-white/5"
          >
            <X size={18} />
          </button>
        </header>
        <div className="overflow-y-auto overscroll-contain p-4">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
export const stateLabel = {
  done: "Realizada",
  current: "Em andamento",
  pending: "A realizar",
  review: "Conferir histórico",
  unavailable: "Conferir operação",
};
export const QueueOperationRow = React.memo(function QueueOperationRow({
  item,
  next = false,
  onStart,
  startDisabled = false,
  variant = "card",
}: {
  item: QueueItem;
  next?: boolean;
  onStart?: () => void;
  startDisabled?: boolean;
  variant?: "card" | "list";
}) {
  return (
    <details className={variant === "list" ? "group nvu-queue-operation-row" : "group rounded-xl border border-slate-200 bg-white [content-visibility:auto] [contain-intrinsic-size:auto_52px] dark:border-nvu-line dark:bg-nvu-surface"}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <span className="w-5 shrink-0 text-xs tabular-nums text-slate-400">
          {item.position + 1}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">
          {item.name || "Operação"}
        </span>
        <span
          className={`shrink-0 text-[11px] ${item.state === "done" ? "text-emerald-700 dark:text-emerald-400" : item.state === "review" || item.issue ? "text-amber-700 dark:text-amber-300" : next ? "font-medium text-blue-600 dark:text-blue-400" : "text-slate-500 dark:text-nvu-muted"}`}
        >
          {next
            ? "Próxima"
            : item.state === "unavailable" && !item.issue
              ? "Encerrada"
              : stateLabel[item.state]}
        </span>
        <ChevronDown
          size={14}
          className="shrink-0 text-slate-400 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="space-y-2 border-t border-slate-100 px-3 py-3 text-xs leading-relaxed text-slate-600 dark:border-nvu-line dark:text-nvu-text-soft">
        <p>
          {item.totalDeliveries || 0} viagem(ns) · {item.deadlineDays || 0}{" "}
          dia(s) ·{" "}
          {item.mode === "detailed" ? "Roteiro definido" : "Rota livre"}
        </p>
        {item.trailerName && <p>Reboque: {item.trailerName}</p>}
        {item.mode === "detailed" && item.deliveries?.length > 0 && (
          <ol className="max-h-40 space-y-1 overflow-auto">
            {item.deliveries.map((d, i) => (
              <li key={`${d.id || i}`}>
                {i + 1}. {d.origin} → {d.destination}
              </li>
            ))}
          </ol>
        )}
        {item.state === "current" && item.completionSource && (
          <p>
            Esta operação já havia sido realizada. O trabalho atual é um novo
            encaminhamento.
          </p>
        )}
        {item.completionSource === "manager-review" && (
          <p>Realização conferida pela empresa.</p>
        )}
        {item.state === "unavailable" && !item.issue && (
          <p>Esta operação foi encerrada pela empresa para novos inícios.</p>
        )}
        {item.issue && (
          <p className="text-amber-700 dark:text-amber-300">{item.issue}</p>
        )}
        {next && onStart && (
          <Button type="button" size="sm" disabled={startDisabled} onClick={onStart}>
            Escolher veículo e iniciar
          </Button>
        )}
      </div>
    </details>
  );
});
export function CompactVehicleChoices({
  vehicles,
  selected,
  onSelect,
  disabled = false,
}: {
  vehicles: QueueVehicle[];
  selected: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Veículos disponíveis"
      className="space-y-2"
    >
      {vehicles.map((v) => (
        <label
          key={v.id}
          className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm ${selected === v.id ? "border-blue-500 bg-blue-50/60 dark:bg-blue-500/10" : "border-slate-200 dark:border-nvu-line"}`}
        >
          <input
            type="radio"
            name="queue-vehicle"
            value={v.id}
            checked={selected === v.id}
            disabled={disabled}
            onChange={() => onSelect(v.id)}
            className="h-4 w-4 accent-blue-600"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">
              {v.name || "Veículo"}
            </span>
            {v.plate && (
              <span className="mt-0.5 block text-xs text-slate-500 dark:text-nvu-muted">
                {v.plate}
              </span>
            )}
          </span>
          {selected === v.id && (
            <Check size={16} className="text-blue-600 dark:text-blue-400" />
          )}
        </label>
      ))}
    </div>
  );
}
export function QueueOrderEditor({
  ids,
  names,
  onChange,
}: {
  ids: string[];
  names: Map<string, string>;
  onChange: (ids: string[]) => void;
}) {
  const drag = useRef<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= ids.length || from === to) return;
    const next = [...ids];
    next.splice(to, 0, ...next.splice(from, 1));
    onChange(next);
  };
  return (
    <ol
      aria-label="Sequência de trabalhos"
      className="max-h-80 space-y-2 overflow-y-auto"
    >
      {ids.map((id, i) => (
        <li
          key={id}
          draggable
          onDragEnd={() => {
            drag.current = null;
          }}
          onDragStart={(e) => {
            drag.current = i;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", id);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (drag.current !== null) move(drag.current, i);
            drag.current = null;
          }}
          className="flex items-center gap-2 rounded-xl border border-slate-200 p-2.5 text-sm dark:border-nvu-line"
        >
          <GripVertical
            size={15}
            className="shrink-0 text-slate-400"
            aria-hidden="true"
          />
          <span className="w-5 shrink-0 text-xs text-slate-400">{i + 1}</span>
          <span className="min-w-0 flex-1 truncate">
            {names.get(id) || "Operação"}
          </span>
          <button
            type="button"
            disabled={i === 0}
            aria-label={`Subir ${names.get(id) || "item"}`}
            onClick={() => move(i, i - 1)}
            className="rounded-lg p-1.5 hover:bg-slate-100 disabled:opacity-25 dark:hover:bg-white/5"
          >
            <ArrowUp size={15} />
          </button>
          <button
            type="button"
            disabled={i === ids.length - 1}
            aria-label={`Descer ${names.get(id) || "item"}`}
            onClick={() => move(i, i + 1)}
            className="rounded-lg p-1.5 hover:bg-slate-100 disabled:opacity-25 dark:hover:bg-white/5"
          >
            <ArrowDown size={15} />
          </button>
        </li>
      ))}
    </ol>
  );
}
