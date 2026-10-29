import { ChevronDown } from "lucide-react";

export function WorkspacePageHeader({ title, description, companyName, simulator, onSimulator }: {
  title: string; description: string; companyName: string; simulator: string; onSimulator: () => void;
}) {
  return <header className="nvu-central-intro nvu-workspace-page-heading">
    <div className="nvu-workspace-page-title"><h1>{title}</h1><p>{description}</p></div>
    <div className="nvu-central-company-row">
      <div className="nvu-central-company-name"><h2 title={companyName}>{companyName}</h2></div>
      <button type="button" onClick={onSimulator} aria-label="Selecionar simulador da empresa" aria-haspopup="dialog" className="nvu-central-simulator"><span>{simulator || "Simulador"}</span><ChevronDown size={17} /></button>
    </div>
  </header>;
}
