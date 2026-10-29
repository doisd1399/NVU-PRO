import React, { useEffect, useRef, useState } from "react";
import type { QueuePreparationView } from "../../contexts/AutomaticOperationsProvider";
import type { QueueMutation } from "../../application/operation/OperationalQueueClient";
import type { QueueCatalog } from "../../../functions/src/operationalQueueModel";
import { Button } from "../ui/Button";

export function OperationalPreparationReview({ preparation, catalog, busy, offline, onRefresh, onRepair }: {
  preparation: QueuePreparationView;
  catalog: QueueCatalog;
  busy: boolean;
  offline: boolean;
  onRefresh: () => Promise<void>;
  onRepair: (input: Omit<QueueMutation, "companyId">) => Promise<void>;
}) {
  const panel = useRef<HTMLElement>(null);
  const [normalizeConfirmed, setNormalizeConfirmed] = useState(false),
    [keep, setKeep] = useState<Record<string, string>>({}),
    [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView?.({ block: "start" });
  }, []);
  useEffect(() => {
    setNormalizeConfirmed(false);
    setKeep({});
    setConfirmed({});
  }, [preparation.token]);
  const drivers = new Map(catalog.drivers.map((row) => [row.id, row.name]));
  const jobName = (jobId: string) => {
    const job = preparation.jobs.find((row) => row.jobId === jobId);
    return catalog.contracts.find((row) => row.id === job?.contractId)?.name || job?.name || jobId;
  };
  const repairable = preparation.jobs.filter((job) => job.canNormalize).slice(0, 30);
  const invalid = preparation.jobs.filter((job) => job.issues.length);
  return (
    <section ref={panel} tabIndex={-1} aria-label="Conferência de trabalhos" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-sm outline-none dark:border-amber-500/30 dark:bg-amber-500/5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Conferência de trabalhos</h3>
        <Button size="sm" variant="outline" disabled={busy || offline} onClick={() => void onRefresh()}>
          Atualizar conferência
        </Button>
      </div>
      {preparation.ready ? (
        <p className="text-xs text-emerald-800 dark:text-emerald-300">
          Os trabalhos estão prontos. Você pode ativar a fila abaixo.
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
          A ativação aguarda a revisão destes trabalhos da empresa. A ordem da fila foi preservada.
        </p>
      )}
      {invalid.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold">Cadastros a conferir ({invalid.length})</h4>
          <div className="max-h-56 space-y-2 overflow-y-auto">
            {invalid.map((job) => (
              <div key={job.jobId} className="rounded-lg bg-white p-2 dark:bg-nvu-surface">
                <p className="text-xs font-medium">{jobName(job.jobId)}</p>
                <p className="break-all text-[11px] text-slate-500 dark:text-nvu-muted">
                  {drivers.get(job.driverId) || "Motorista a conferir"} · {job.jobId}
                </p>
                <p className="mt-1 text-xs">{job.issues.join("; ")}</p>
                {!job.canNormalize && <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                  Confira o vínculo e os dados na gestão de trabalhos. Não foi possível determinar uma correção segura.
                </p>}
              </div>
            ))}
          </div>
          {repairable.length > 0 && <>
            <label className="flex items-start gap-2 text-xs leading-relaxed">
              <input type="checkbox" className="mt-0.5 accent-blue-600" checked={normalizeConfirmed}
                disabled={busy} onChange={(e) => setNormalizeConfirmed(e.target.checked)} />
              Confirmo a atualização dos campos antigos compatíveis, preservando viagens, progresso e prazos.
            </label>
            <Button size="sm" disabled={busy || offline || !normalizeConfirmed} onClick={() => void onRepair({
              action: "normalizeLegacyJobs", expectedRevision: catalog.settings.revision,
              preparationToken: preparation.token, jobIds: repairable.map((job) => job.jobId), confirmed: true,
            })}>Corrigir {repairable.length} cadastro(s) compatível(is)</Button>
          </>}
        </div>
      )}
      {preparation.conflicts.map((conflict) => {
        const needsFields = conflict.jobIds.some((jobId) => preparation.invalidScopes.includes(jobId));
        return <div key={conflict.driverId} className="space-y-2 rounded-lg border border-amber-200 p-3 dark:border-amber-500/20">
          <h4 className="text-xs font-semibold">{drivers.get(conflict.driverId) || "Motorista a conferir"}: {conflict.jobIds.length} trabalhos em andamento</h4>
          <p className="text-xs leading-relaxed">Selecione qual trabalho deve continuar. Os demais serão cancelados e as viagens registradas serão preservadas.</p>
          {needsFields && <p className="text-xs text-amber-800 dark:text-amber-300">Corrija primeiro os cadastros indicados acima.</p>}
          {conflict.jobIds.map((jobId) => <label key={jobId} className="flex items-start gap-2 rounded-lg bg-white p-2 text-xs dark:bg-nvu-surface">
            <input type="radio" className="mt-0.5 accent-blue-600" name={`keep-${conflict.driverId}`}
              disabled={busy || needsFields} checked={keep[conflict.driverId] === jobId}
              onChange={() => { setKeep({ ...keep, [conflict.driverId]: jobId }); setConfirmed({ ...confirmed, [conflict.driverId]: false }); }} />
            <span><span className="font-medium">Manter {jobName(jobId)}</span><span className="mt-1 block break-all text-[11px] text-slate-500 dark:text-nvu-muted">{jobId}</span></span>
          </label>)}
          <label className="flex items-start gap-2 text-xs leading-relaxed">
            <input type="checkbox" className="mt-0.5 accent-blue-600" disabled={busy || needsFields || !keep[conflict.driverId]}
              checked={Boolean(confirmed[conflict.driverId])}
              onChange={(e) => setConfirmed({ ...confirmed, [conflict.driverId]: e.target.checked })} />
            Confirmo o cancelamento dos {conflict.jobIds.length - 1} trabalho(s) não selecionado(s).
          </label>
          <Button size="sm" variant="outline" disabled={busy || offline || needsFields || !keep[conflict.driverId] || !confirmed[conflict.driverId]}
            onClick={() => void onRepair({ action: "resolveLegacyConflict", expectedRevision: catalog.settings.revision,
              preparationToken: preparation.token, driverId: conflict.driverId, keepJobId: keep[conflict.driverId], confirmed: true })}>
            Manter selecionado e cancelar os demais
          </Button>
        </div>;
      })}
    </section>
  );
}
