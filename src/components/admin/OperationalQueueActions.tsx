import React from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import { Button } from "../ui/Button";
import type { OperationalQueue } from "../../../functions/src/operationalQueueModel";

export function OperationalQueueActions({
  queue, name, operationCount, confirmingRemoval, busy, blocked, error,
  onToggle, onRemove, onConfirmRemove, onBack, onCancelRemove,
}: {
  queue: OperationalQueue;
  name: string;
  operationCount: number;
  confirmingRemoval: boolean;
  busy: boolean;
  blocked: string | null;
  error: string | null;
  onToggle: () => void;
  onRemove: () => void;
  onConfirmRemove: () => void;
  onBack: () => void;
  onCancelRemove: () => void;
}) {
  const active = queue.state === "active";
  const disabled = busy || Boolean(blocked);
  return (
    <div className="space-y-4">
      <div className="min-w-0">
        <p className="break-words text-[15px] font-semibold leading-snug">{name}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-nvu-muted">
          <span className={`rounded-md px-2 py-1 font-medium ${active ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-nvu-text-soft"}`}>{active ? "Ativa" : "Pausada"}</span>
          <span>{queue.audience === "all" ? "Toda a frota" : `${queue.driverIds.length} ${queue.driverIds.length === 1 ? "motorista" : "motoristas"}`} · {operationCount} {operationCount === 1 ? "operação" : "operações"}</span>
        </div>
      </div>
      {(blocked || error) && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{blocked || error}</p>}
      {confirmingRemoval ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-red-200 bg-red-50/40 p-4 dark:border-red-500/30 dark:bg-red-500/5">
            <h3 className="text-sm font-semibold text-red-700 dark:text-red-300">Remover esta fila do envio automático?</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-600 dark:text-nvu-text-soft">A fila deixará de liberar novas operações. A pasta, as operações cadastradas, os trabalhos em andamento e o histórico serão mantidos.</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={onCancelRemove}>Voltar</Button>
            <Button variant="danger" disabled={disabled} onClick={onConfirmRemove}>{busy ? "Removendo…" : "Confirmar remoção"}</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-3">
            <button type="button" disabled={disabled} onClick={onToggle} className={`rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${active ? "border-amber-200 hover:bg-amber-50/60 dark:border-amber-500/30 dark:hover:bg-amber-500/5" : "border-emerald-200 hover:bg-emerald-50/60 dark:border-emerald-500/30 dark:hover:bg-emerald-500/5"}`}>
              <span className={`flex items-center gap-2 text-[15px] font-semibold ${active ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>
                {active ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}{active ? "Pausar fila" : "Retomar fila"}
              </span>
              <span className="mt-2 block text-[13px] leading-relaxed text-slate-500 dark:text-nvu-muted">{active ? "Interrompe novos envios desta fila. Quem já iniciou uma operação pode continuar. Retome quando quiser." : "Volta a liberar as próximas operações. Cada motorista continua do ponto em que parou."}</span>
            </button>
            <button type="button" disabled={disabled} onClick={onRemove} className="rounded-xl border border-red-200 p-4 text-left transition-colors hover:bg-red-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/30 dark:hover:bg-red-500/5">
              <span className="flex items-center gap-2 text-[15px] font-semibold text-red-700 dark:text-red-300"><Trash2 size={17} aria-hidden="true" />Remover fila</span>
              <span className="mt-2 block text-[13px] leading-relaxed text-slate-500 dark:text-nvu-muted">Retira a fila do envio automático e preserva a pasta, as operações e o histórico. Você confirma na próxima etapa.</span>
            </button>
          </div>
          <Button variant="outline" className="w-full" disabled={busy} onClick={onBack}>Voltar às filas</Button>
        </>
      )}
      {busy && <p role="status" className="text-center text-xs text-slate-500 dark:text-nvu-muted">Aguarde a confirmação da alteração…</p>}
    </div>
  );
}
