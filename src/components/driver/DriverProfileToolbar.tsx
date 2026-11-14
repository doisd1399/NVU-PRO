import { Info, Settings } from "lucide-react";
import type { DriverProfileView } from "./DriverProfileSummary";
import "./DriverProfileToolbar.css";

/** Profile views and the existing profile actions share one compact row. */
export function DriverProfileToolbar({ view, onViewChange, infoOpen, onInfo, onEdit, company = false, canEdit = true }: {
  view: DriverProfileView;
  onViewChange: (view: DriverProfileView) => void;
  infoOpen: boolean;
  onInfo: () => void;
  onEdit: () => void;
  company?: boolean;
  canEdit?: boolean;
}) {
  return <header className="nvu-driver-profile-toolbar" aria-label="Opções do perfil">
    <h1 className="sr-only">Meu perfil</h1>
    <div className="nvu-driver-profile-ranking" role="group" aria-label="Visualização do perfil">
      <button type="button" aria-pressed={view === "summary"} onClick={() => onViewChange("summary")}>Resumo</button>
      <button type="button" aria-pressed={view === "statistics"} onClick={() => onViewChange("statistics")}>Estatísticas</button>
    </div>
    <div className="nvu-driver-profile-actions">
      <button type="button" aria-label={company ? "Informações da empresa" : "Informações do perfil"} aria-pressed={infoOpen} onClick={onInfo}><Info size={18} aria-hidden="true"/></button>
      {canEdit && <button type="button" aria-label={company ? "Editar empresa" : "Editar meu perfil"} onClick={onEdit}><Settings size={18} aria-hidden="true"/></button>}
    </div>
  </header>;
}
