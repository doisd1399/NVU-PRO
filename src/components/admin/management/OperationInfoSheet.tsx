import React from "react";
import { ArrowLeftRight, MapPinned, Trash2, User } from "lucide-react";
import { useSessionStore } from "../../../context/AppContext";
import { StableImage } from "../../common/StableImage";
import { describeOperationInfo } from "../../../lib/operationInfo";
import { ManagementDialog } from "./ManagementDialog";
import type { ManagementOperation } from "./ManagementOperationCard";
import "./OperationInfoSheet.css";

export type OperationInfoAction = "profile" | "trips" | "vehicle" | "cancel";

/**
 * "Informações da operação": bottom sheet with the driver, the operation, the time left, the progress and the four
 * management flows. Every figure comes from the operation record; the sheet only presents it.
 */
export function OperationInfoSheet({ operation, now, canManage, onAction, onClose }: {
  operation: ManagementOperation;
  now: number;
  /** Changing the vehicle and cancelling are company-manager actions. */
  canManage: boolean;
  onAction: (action: OperationInfoAction) => void;
  onClose: () => void;
}) {
  const { currentUser } = useSessionStore();
  const view = describeOperationInfo(operation, now);
  const actions: { id: OperationInfoAction; label: string; icon: typeof User; enabled: boolean; hint?: string }[] = [
    { id: "profile", label: "Visualizar perfil", icon: User, enabled: true },
    { id: "trips", label: "Viagens da operação", icon: MapPinned, enabled: true },
    { id: "vehicle", label: "Trocar veículo", icon: ArrowLeftRight, enabled: canManage && view.editable, hint: !canManage ? "Somente administradores da empresa" : !view.editable ? "Trabalho encerrado" : undefined },
    { id: "cancel", label: "Cancelar trabalho", icon: Trash2, enabled: canManage && view.editable, hint: !canManage ? "Somente administradores da empresa" : !view.editable ? "Trabalho encerrado" : undefined },
  ];
  return <ManagementDialog title="Informações da operação" variant="sheet" onClose={onClose}>
    <div className="nvu-op-sheet-body" data-testid="operation-info-sheet">
      <div className="nvu-op-sheet-driver">
        <StableImage src={operation.driverPhoto} persistentViewerId={currentUser?.id} persistentAssetId={`management-avatar:${operation.companyId}:${operation.driverId}`} alt={`Foto de ${operation.driverName}`}
          wrapperClassName="nvu-op-sheet-photo" className="object-cover" referrerPolicy="no-referrer" fallback={<span>{operation.driverName.slice(0, 2).toUpperCase()}</span>} />
        <div><strong>{operation.driverName}</strong><span>{operation.companyName} · {operation.simulatorLabel}</span></div>
      </div>
      <div className="nvu-op-sheet-operation">
        <strong>{operation.name}</strong>
        <span className="nvu-op-sheet-status" data-tone={view.tone}><i aria-hidden="true" />{view.statusLabel}</span>
      </div>
      <dl className="nvu-op-sheet-list">
        <div><dt>Veículo</dt><dd>{operation.vehicleName}</dd></div>
        {operation.showTrailer ? <div><dt>Reboque</dt><dd className="nvu-op-sheet-trailer">{operation.trailerName || "Nenhum"}</dd></div> : null}
        <div><dt>Entregas</dt><dd>{view.required ? `${view.completed} de ${view.required} entregas` : `${view.completed} ${view.completed === 1 ? "entrega" : "entregas"}`}
          <small>{view.required ? `${view.remaining} ${view.remaining === 1 ? "restante" : "restantes"} · ` : ""}{view.percent}%</small></dd></div>
        <div><dt>Prazo</dt><dd>{operation.deadline || "Não definido"}</dd></div>
        <div><dt>{view.tone === "cancelled" || view.tone === "done" ? "Situação" : "Restante"}</dt><dd data-warning={view.timeWarning || undefined}>{view.timeText}</dd></div>
      </dl>
      <div className="nvu-central-progress nvu-op-sheet-bar" role="progressbar" aria-label="Progresso da operação" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percent}><span style={{ width: `${view.percent}%` }} /></div>
      {operation.driverOutsideCompany && <p className="nvu-op-sheet-note" role="note" data-testid="operation-orphan-note">
        Este motorista não faz mais parte da empresa, mas o trabalho ficou aberto e mantém o veículo em uso. Cancele-o para encerrar. As viagens já registradas são preservadas.</p>}
      <div className="nvu-op-sheet-actions">
        {actions.map(({ id, label, icon: Icon, enabled, hint }) => <button type="button" key={id} className="nvu-op-sheet-action" data-action={id} data-danger={id === "cancel" || undefined}
          disabled={!enabled} title={hint} onClick={() => onAction(id)}>
          <Icon className="nvu-op-sheet-action-icon" size={20} strokeWidth={1.7} aria-hidden="true" /><span>{label}</span>
        </button>)}
      </div>
    </div>
  </ManagementDialog>;
}
