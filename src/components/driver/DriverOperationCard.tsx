import React from "react";
import { Download, ImagePlus, Info } from "lucide-react";
import "../admin/management/ManagementDashboard.css";
import "./DriverOperationCard.css";
import { CachedImage } from "../common/CachedImage";
import { OperationProgressBar } from "../common/OperationProgressBar";
import { DriverOperationTiming } from "./DriverOperationTiming";
import { DriverStatusRow } from "./DriverStatusRow";

export type DriverOperationCardProps = {
  photo: {
    src?: string | null; busy: boolean; canEdit: boolean; error?: string; pending: boolean;
    inputRef: React.Ref<HTMLInputElement>; onFileSelected: (event: React.ChangeEvent<HTMLInputElement>) => void; onPick: () => void;
  };
  info: { id: string; open: boolean; onOpen: () => void };
  /** Only when every delivery is done and the operation waits for the driver to finish it. */
  finish: null | { heading: string; description?: string; label: string; disabled: boolean; onFinish: () => void };
  notice?: React.ReactNode;
  vehicle: { name: string; trailer?: string; operationName: string; onPaints: () => void };
  progress: { done: number; total: number; remaining: number; percent: number; replayKey: string };
  sync?: React.ReactNode;
  timing: { remaining: string; disabled: boolean; busy: boolean; onStart: () => void };
  status: { online: boolean; suspended: boolean; onChange: (online: boolean) => void };
};

/**
 * The driver's current operation, drawn with the same card as "Trabalhos ativos" of the company panel (same classes and
 * styles) minus the driver row: the driver already is on his own page. Order: vehicle photo, vehicle line, figures and
 * progress, start button, remaining time, availability.
 */
export function DriverOperationCard({ photo, info, finish, notice, vehicle, progress, sync, timing, status }: DriverOperationCardProps) {
  return <section className="order-3 nvu-driver-op-card nvu-central-palette nvu-central-operation mb-3 sm:mb-4 mt-0" aria-label="Operação atual" data-testid="driver-operation-card">
    <input ref={photo.inputRef} type="file" accept="image/*" className="hidden" onChange={photo.onFileSelected} />
    <button type="button" className="nvu-central-vehicle-photo nvu-driver-op-photo nvu-driver-vehicle-photo" disabled={photo.busy || !photo.canEdit}
      aria-label={photo.src ? "Substituir foto do veículo" : "Adicionar foto do veículo"} onClick={photo.onPick}>
      {photo.src ? <CachedImage src={photo.src} alt="Fotografia cadastrada do veículo" className="h-full w-full object-cover" />
        : <span className="nvu-driver-op-photo-empty"><ImagePlus size={20} aria-hidden="true" /> Adicionar foto do veículo</span>}
      {photo.busy && <span className="nvu-driver-op-photo-busy">Salvando…</span>}
    </button>
    {photo.error && <p role="alert" className="nvu-driver-op-photo-note" data-tone="error">{photo.error}</p>}
    {photo.pending && !photo.busy && <p role="status" className="nvu-driver-op-photo-note">Foto salva no aparelho. Sincronização pendente; será tentada quando a conexão voltar.</p>}
    {finish && <div className="nvu-driver-op-finish" data-testid="driver-operation-finish">
      <div><strong>{finish.heading}</strong><span>{finish.description || "Finalize a operação para continuar. O servidor confirmará as entregas."}</span></div>
      <button type="button" onClick={finish.onFinish} disabled={finish.disabled}>{finish.label}</button>
    </div>}
    {notice}
    <div className="nvu-central-vehicle-line nvu-current-operation-vehicle">
      <button type="button" className="nvu-central-paint-button" onClick={vehicle.onPaints} aria-label="Ver pinturas do veículo e reboque" title="Pinturas disponíveis"><Download size={19} strokeWidth={1.7} aria-hidden="true" /></button>
      <div className="nvu-central-vehicle-name"><strong>{vehicle.name}</strong>{vehicle.trailer ? <small>{vehicle.trailer}</small> : null}</div>
      <button type="button" className="nvu-central-operation-info" aria-label="Informações da operação em andamento" aria-haspopup="dialog"
        aria-expanded={info.open} aria-controls={info.id} onClick={info.onOpen}><Info size={18} strokeWidth={1.8} aria-hidden="true" /></button>
      <span className="nvu-central-operation-name" title={vehicle.operationName}>{vehicle.operationName}</span>
    </div>
    <div className="nvu-central-operation-stats">
      <div className="nvu-central-operation-metrics">
        <div><strong>{progress.done}/{progress.total}</strong><span>Entregas</span></div>
        <div><strong>{progress.remaining}</strong><span>Restantes</span></div>
        <div><strong>{progress.percent.toFixed(0)}%</strong><span>Concluído</span></div>
      </div>
      <div className="nvu-driver-op-progress" role="progressbar" aria-label="Progresso da operação" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.percent)}>
        <OperationProgressBar percent={progress.percent} replayKey={progress.replayKey}
          trackClassName="h-[5px] bg-[color-mix(in_srgb,var(--central-text)_12%,transparent)] dark:bg-[color-mix(in_srgb,var(--central-text)_12%,transparent)]"
          fillClassName="bg-[var(--central-accent)] dark:bg-[var(--central-accent)]" />
      </div>
    </div>
    {sync}
    <DriverOperationTiming remaining={timing.remaining} disabled={timing.disabled} busy={timing.busy} onStart={timing.onStart} />
    <DriverStatusRow online={status.online} suspended={status.suspended} onChange={status.onChange} />
  </section>;
}
