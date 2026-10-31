import React, { useState } from "react";
import { ClipboardClock, Loader2 } from "lucide-react";
import { StableImage } from "../common/StableImage";
import { toApplicationDate } from "../../lib/companyCatalog";

export type MyApplicationRow = {
  id: string;
  /** "recruitment" is a full application read by HR; "request" is the simple work request. */
  kind: "recruitment" | "request";
  companyId: string;
  companyName: string;
  companyLogo?: string;
  simulatorName?: string;
  createdAt?: unknown;
};

const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

/**
 * "Minhas inscrições": the driver's own pending applications. The simple work request is withdrawn by deleting it;
 * a full application is withdrawn through the server, offered only when `onWithdrawApplication` is given (the server
 * has to know the command). Either way the row stays until the data confirms it is gone.
 */
export function MyCompanyApplications({ rows, loading, failed, onCancelRequest, onWithdrawApplication }: {
  rows: MyApplicationRow[]; loading: boolean; failed: boolean; onCancelRequest: (id: string) => Promise<void>;
  onWithdrawApplication?: (row: MyApplicationRow) => Promise<void>;
}) {
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; message: string } | null>(null);
  const cancel = async (row: MyApplicationRow) => {
    if (cancelling) return;
    setCancelling(row.id); setProblem(null);
    try {
      if (row.kind === "recruitment") await onWithdrawApplication!(row); else await onCancelRequest(row.id);
      setConfirming(null);
    } catch (error) {
      // The simple request's failure is reported by the context; the server command's is worded by its caller.
      if (row.kind === "recruitment") setProblem({ id: row.id, message: (error as Error)?.message || "Não foi possível retirar a inscrição agora." });
    } finally { setCancelling(null); }
  };
  return <section className="nvu-my-applications" aria-labelledby="nvu-my-applications-title" aria-busy={loading} data-testid="my-applications">
    <h2 id="nvu-my-applications-title" className="flex items-center gap-2 text-[15px] font-bold text-gray-900 dark:text-nvu-text">
      <ClipboardClock size={18} aria-hidden="true" /> Minhas inscrições
    </h2>
    {rows.length === 0 ? <p role="status" className="mt-2 rounded-2xl border border-dashed border-gray-200 dark:border-nvu-line bg-gray-50 dark:bg-nvu-surface px-4 py-4 text-sm text-gray-500 dark:text-nvu-muted">
      {loading ? "Carregando suas inscrições…" : failed ? "Não foi possível carregar suas inscrições agora." : "Você não tem inscrições aguardando resposta."}
    </p> : <ul className="mt-3 space-y-2">
      {rows.map(row => {
        const date = toApplicationDate(row.createdAt);
        const busy = cancelling === row.id;
        return <li key={`${row.kind}:${row.id}`} data-kind={row.kind} className="rounded-2xl border border-gray-100 dark:border-nvu-line bg-white dark:bg-nvu-surface p-3">
          <div className="flex items-center gap-3">
            <StableImage src={row.companyLogo} alt="" loading="lazy" wrapperClassName="h-10 w-10 shrink-0 rounded-full border border-gray-100 dark:border-nvu-line" className="object-cover" referrerPolicy="no-referrer"
              fallback={<span className="flex h-full w-full items-center justify-center bg-blue-50 dark:bg-blue-500/10 text-sm font-bold text-blue-700 dark:text-blue-300">{(row.companyName || "?").slice(0, 2).toUpperCase()}</span>} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-bold text-gray-900 dark:text-nvu-text">{row.companyName || "Empresa"}</p>
              <p className="truncate text-xs text-gray-500 dark:text-nvu-muted">{[row.simulatorName, date ? `Enviada em ${dateFormat.format(date)}` : "Data indisponível"].filter(Boolean).join(" · ")}</p>
            </div>
            <span className="shrink-0 rounded-full border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:text-amber-300">Aguardando avaliação</span>
          </div>
          {(row.kind === "request" || onWithdrawApplication) && (() => {
            const label = row.kind === "request" ? "Retirar solicitação" : "Retirar inscrição";
            return confirming === row.id
              ? <div className="mt-3 space-y-2">
                  {row.kind === "recruitment" && <p className="text-xs text-gray-500 dark:text-nvu-muted">A empresa deixará de ver esta inscrição. Você poderá se inscrever de novo depois.</p>}
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" disabled={busy} onClick={() => setConfirming(null)} className="rounded-xl border border-gray-200 dark:border-nvu-line px-3 py-2 text-xs font-semibold text-gray-700 dark:text-nvu-text-soft">Manter</button>
                    <button type="button" disabled={busy} aria-busy={busy} onClick={() => void cancel(row)} className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">
                      {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}{label}</button>
                  </div>
                </div>
              : <div className="mt-3 flex justify-end"><button type="button" onClick={() => { setProblem(null); setConfirming(row.id); }} className="text-xs font-semibold text-gray-500 dark:text-nvu-muted underline underline-offset-2">{label}</button></div>;
          })()}
          {problem?.id === row.id && <p role="alert" className="mt-2 text-xs font-semibold text-red-600 dark:text-red-300">{problem.message}</p>}
        </li>;
      })}
    </ul>}
  </section>;
}

