import React from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useSessionStore } from "../../../context/AppContext";
import { StableImage } from "../../common/StableImage";
import { ManagementDialog } from "./ManagementDialog";
import "./ManagementDashboard.css";
import "./OperationInfoSheet.css";

export type DriverOption = {
  id: string; label: string; icon: LucideIcon; onSelect: () => void;
  /** Destructive actions use the warning color of the management flows. */
  danger?: boolean; disabled?: boolean; busy?: boolean;
};

/**
 * Options of a team member as a bottom sheet (same panel as "Informações da operação") instead of a small popover that the
 * list card used to clip. The sheet closes first, then runs the chosen action.
 */
export function DriverOptionsSheet({ driverId, companyId, name, photo, subtitle, options, onClose }: {
  driverId: string; companyId: string; name: string; photo?: string | null; subtitle: string; options: DriverOption[]; onClose: () => void;
}) {
  const { currentUser } = useSessionStore();
  return <ManagementDialog title="Opções do motorista" variant="sheet" onClose={onClose}>
    <div className="nvu-op-sheet-body" data-testid="driver-options-sheet">
      <div className="nvu-op-sheet-summary">
        <div className="nvu-op-sheet-driver">
          <StableImage src={photo || undefined} persistentViewerId={currentUser?.id} persistentAssetId={`management-avatar:${companyId}:${driverId}`} alt={`Foto de ${name}`}
            wrapperClassName="nvu-op-sheet-photo" className="object-cover" referrerPolicy="no-referrer" fallback={<span>{name.slice(0, 2).toUpperCase()}</span>} />
          <div><strong>{name}</strong><span>{subtitle}</span></div>
        </div>
      </div>
      <div className="nvu-op-sheet-actions">
        {options.map(({ id, label, icon: Icon, onSelect, danger, disabled, busy }) => <button type="button" key={id} className="nvu-op-sheet-action" data-action={id} data-danger={danger || undefined}
          disabled={disabled || busy} onClick={() => { onClose(); onSelect(); }}>
          {busy ? <Loader2 className="nvu-op-sheet-action-icon animate-spin" size={26} aria-hidden="true" /> : <Icon className="nvu-op-sheet-action-icon" size={26} strokeWidth={1.7} aria-hidden="true" />}
          <span>{label}</span>
          <span className="nvu-op-sheet-arrow"><ArrowRight size={22} strokeWidth={1.8} /></span>
        </button>)}
      </div>
    </div>
  </ManagementDialog>;
}
