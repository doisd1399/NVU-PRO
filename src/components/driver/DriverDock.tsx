import React from "react";
import { Navigation, FileText, ChartNoAxesColumnIncreasing, Newspaper, Trophy, UserRound, LayoutGrid, Building2 } from "lucide-react";

const destinations = [
  { id: "dashboard", label: "Trabalho", icon: Navigation },
  { id: "activity", label: "Atividade", icon: FileText },
  { id: "results", label: "Resultados", icon: ChartNoAxesColumnIncreasing },
  { id: "news", label: "NVU News", icon: Newspaper },
  { id: "ranking", label: "Ranking", icon: Trophy },
  { id: "profile", label: "Perfil", icon: UserRound },
] as const;

export function DriverDock({ active, onSelect, onIntent, variant = "driver" }: { active: string; onSelect: (id: string) => void; onIntent?: (id: string) => void; variant?: "driver" | "company" }) {
  const items = variant === "company" ? destinations.map(item => item.id === "dashboard"
    ? { ...item, label: "Gestão", icon: LayoutGrid }
    : item.id === "profile" ? { ...item, label: "Empresa", icon: Building2 } : item) : destinations;
  return (
    <nav className="nvu-driver-dock nvu-workspace-theme" aria-label={variant === "company" ? "Navegação da empresa" : "Navegação do motorista"}>
      {items.map(({ id, label, icon: Icon }) => {
        const selected = active === id || (id === "activity" && active === "operations");
        return <button key={id} type="button" aria-current={selected ? "page" : undefined}
          onPointerDown={() => onIntent?.(id)} onMouseEnter={() => onIntent?.(id)} onFocus={() => onIntent?.(id)}
          onClick={() => onSelect(id)} className="nvu-driver-dock-item" aria-label={label} title={label}>
          <Icon size={23} strokeWidth={1.65} aria-hidden="true" />
        </button>;
      })}
    </nav>
  );
}
