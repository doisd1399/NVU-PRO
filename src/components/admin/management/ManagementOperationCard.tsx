import { useSessionStore } from "../../../context/AppContext";
import React, { useEffect, useId, useState } from "react";
import { ChevronDown, Clock3, Copy, Download, ExternalLink, Info, Truck } from "lucide-react";
import { StableImage } from "../../common/StableImage";
import { useVehiclePhoto } from "../../../hooks/useVehiclePhoto";
import { ManagementDialog } from "./ManagementDialog";

export type ManagementOperation = {
  id: string; companyId: string; companyName: string;
  driverId: string; driverName: string; driverPhoto?: string;
  name: string; vehicleId: string; vehicleName: string; trailerName?: string;
  vehiclePaint?: string; trailerPaint?: string; showTrailer: boolean;
  simulatorId: string; simulatorLabel: string; contractId: string;
  completed: number; required: number; progress: number; remaining: number;
  deadline: string; deadlineTimestamp?: number; timeRemaining: string; nearDeadline: boolean;
  state: "active" | "pending" | "overdue" | "ready";
  /** Raw job status; lets the information card tell a finished or cancelled job from an open one. */
  jobStatus?: string;
};
const statusLabels = { active: "Em andamento", pending: "Não iniciado", overdue: "Atrasado", ready: "Aguardando conclusão" };

function PaintsDialog({ operation, onClose }: { operation: ManagementOperation; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState("");
  const copy = async (value: string) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const field = document.createElement("textarea");
        field.value = value; field.style.position = "fixed"; field.style.opacity = "0";
        document.body.appendChild(field); field.select();
        const ok = document.execCommand("copy"); field.remove();
        if (!ok) throw new Error("copy-failed");
      }
      setCopied(value); setError("");
    } catch { setError("Não foi possível copiar. Selecione o código abaixo."); }
  };
  const items = [{ label: "Veículo", name: operation.vehicleName, value: operation.vehiclePaint },
    ...(operation.showTrailer ? [{ label: "Reboque", name: operation.trailerName || "Reboque", value: operation.trailerPaint }] : [])];
  return <ManagementDialog title="Pinturas disponíveis" onClose={onClose}>
    <div className="nvu-central-dialog-body">
      {items.map(item => <div className="nvu-central-paint" key={item.label}>
        <small>{item.label}</small><h3>{item.name}</h3>
        {item.value ? <>
          <p className="nvu-central-paint-code">{item.value}</p>
          <div className="nvu-central-dialog-actions">
            {/^(https?:)\/\//i.test(item.value) && <a href={item.value} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />Abrir pintura</a>}
            <button type="button" onClick={() => void copy(item.value!)}><Copy size={15} />{copied === item.value ? "Copiado" : "Copiar código"}</button>
          </div>
        </> : <p>Nenhuma pintura disponibilizada.</p>}
      </div>)}
      {error && <p role="alert">{error}</p>}
      {copied && <p className="sr-only" role="status">Código copiado.</p>}
    </div>
  </ManagementDialog>;
}

/**
 * New management card. The expanded and the minimized operation render the same driver row, vehicle line, figures card
 * and time line from the same markup and the same styles; the only differences are the vehicle photo block (not rendered
 * at all when minimized) and the direction of the arrow. Each card keeps its own state.
 */
export function ManagementOperationCard({ operation, onInfo, onDriver, active = true }: {
  operation: ManagementOperation; onInfo: () => void; onDriver: () => void; active?: boolean;
}) {
  const [paintsOpen, setPaintsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const photoId = useId();
  const { currentUser } = useSessionStore();
  useEffect(() => { if (!active) setPaintsOpen(false); }, [active]);
  const photo = useVehiclePhoto(expanded && operation.driverId && operation.simulatorId && operation.vehicleId
    ? { userId: operation.driverId, simulatorId: operation.simulatorId, vehicleId: operation.vehicleId, vehicleName: operation.vehicleName }
    : null, operation.companyId);
  return <article className="nvu-central-operation" data-operation-id={operation.id} data-expanded={expanded}>
    <div className="nvu-central-driver-row">
      <button type="button" className="nvu-central-driver" onClick={onDriver} aria-label={`Ver perfil de ${operation.driverName}`}>
        <StableImage src={operation.driverPhoto} persistentViewerId={currentUser?.id} persistentAssetId={`management-avatar:${operation.companyId}:${operation.driverId}`} alt="" wrapperClassName="nvu-central-avatar" className="object-cover" loading="lazy"
          referrerPolicy="no-referrer" fallback={<span>{operation.driverName.slice(0, 2).toUpperCase()}</span>} />
        <strong>{operation.driverName}</strong>
      </button>
      <span className="nvu-central-job-status" data-state={operation.state}><i aria-hidden="true" />{statusLabels[operation.state]}</span>
      <button type="button" className="nvu-central-operation-toggle" aria-expanded={expanded} aria-controls={photoId} onClick={() => setExpanded(value => !value)}
        aria-label={`${expanded ? "Minimizar" : "Expandir"} operação de ${operation.driverName}`}><ChevronDown size={20} strokeWidth={2.2} aria-hidden="true" /></button>
    </div>
    {expanded && <div id={photoId} className="nvu-central-vehicle-photo">
      <StableImage src={photo.src} onLoad={photo.onImageLoad} onError={photo.onImageError} alt={`Foto de ${operation.vehicleName}`} wrapperClassName="nvu-central-photo-frame" className="object-cover"
        loading="lazy" fallback={<div className="nvu-central-photo-empty"><Truck size={30} /><span>{photo.remoteStatus === "loading" && !photo.src ? "Carregando foto do veículo…" : "Foto do veículo indisponível"}</span></div>} />
    </div>}
    <div className="nvu-central-vehicle-line">
      <button type="button" className="nvu-central-paint-button" onClick={() => setPaintsOpen(true)} aria-label={`Ver pinturas de ${operation.vehicleName}`}><Download size={19} strokeWidth={1.7} /></button>
      <div className="nvu-central-vehicle-name"><strong>{operation.vehicleName}</strong>{operation.showTrailer && <small>{operation.trailerName || "Sem reboque"}</small>}</div>
      <button type="button" onClick={onInfo} className="nvu-central-operation-info" aria-label={`Ver informações de ${operation.vehicleName}`}><Info size={18} strokeWidth={1.8} /></button>
      <span className="nvu-central-operation-name" title={operation.name}>{operation.name}</span>
    </div>
    <div className="nvu-central-operation-stats">
      <div className="nvu-central-operation-metrics">
        <div><strong>{operation.completed}/{operation.required || "—"}</strong><span>Entregas</span></div>
        <div><strong>{operation.required ? operation.remaining : "—"}</strong><span>Restantes</span></div>
        <div><strong>{operation.progress}%</strong><span>Concluído</span></div>
      </div>
      <div className="nvu-central-progress" role="progressbar" aria-label={`Progresso de ${operation.driverName}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={operation.progress}>
        <span style={{ width: `${operation.progress}%` }} />
      </div>
    </div>
    <p className="nvu-central-operation-timing"><Clock3 size={16} strokeWidth={1.8} aria-hidden="true" /><span>Tempo restante:</span><strong data-warning={operation.timeRemaining !== "Não definido" || undefined}>{operation.timeRemaining}</strong></p>
    {paintsOpen && <PaintsDialog operation={operation} onClose={() => setPaintsOpen(false)} />}
  </article>;
}
