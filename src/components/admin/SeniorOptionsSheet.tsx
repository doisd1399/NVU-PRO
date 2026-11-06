import React from "react";
import { ArrowRight, BookOpen, Gamepad2, Megaphone, Navigation, UserX, Wrench } from "lucide-react";
import { ManagementDialog } from "./management/ManagementDialog";
import "./management/ManagementDashboard.css";
import "./management/OperationInfoSheet.css";
import "./management/SeniorSheets.css";

export type SeniorOptionId = "news" | "guides" | "simulators" | "cities" | "work-mode" | "suspended";

type Option = { id: SeniorOptionId; label: string; hint: string; icon: React.ElementType; tone?: "danger" };
const GROUPS: { title: string; options: Option[] }[] = [
  { title: "Conteúdo do app", options: [
    { id: "news", label: "Gerenciar comunicados", hint: "Publique e edite avisos para os usuários.", icon: Megaphone },
    { id: "guides", label: "Gerenciar guias", hint: "Envie ou exclua os guias do Motorista e do Empresário, sem trocar o APK.", icon: BookOpen },
  ] },
  { title: "Plataforma", options: [
    { id: "simulators", label: "Gerenciar simuladores", hint: "Simuladores disponíveis para as empresas.", icon: Gamepad2 },
    { id: "cities", label: "Gerenciar cidades", hint: "Cidades usadas nas operações.", icon: Navigation },
    { id: "work-mode", label: "Controle de envio de viagens", hint: "Libere ou bloqueie os modos de envio por simulador.", icon: Wrench },
  ] },
  { title: "Moderação", options: [
    { id: "suspended", label: "Membros suspensos", hint: "Consulta persistida no servidor.", icon: UserX, tone: "danger" },
  ] },
];

/** Painel Sênior › Opções: painel inferior no mesmo padrão de "Informações da operação". Fecha primeiro e depois abre a escolha. */
export function SeniorOptionsSheet({ onClose, onSelect }: { onClose: () => void; onSelect: (id: SeniorOptionId) => void }) {
  return (
    <ManagementDialog title="Opções" variant="sheet" onClose={onClose}>
      <div className="nvu-senior-sheet" data-testid="senior-options-sheet">
        {GROUPS.map(group => (
          <section className="nvu-senior-group" aria-label={group.title} key={group.title}>
            <h3>{group.title}</h3>
            {group.options.map(({ id, label, hint, icon: Icon, tone }) => (
              <button type="button" key={id} className="nvu-senior-action" data-action={id} data-tone={tone} onClick={() => { onClose(); onSelect(id); }}>
                <Icon size={22} strokeWidth={1.7} aria-hidden="true" />
                <span><strong>{label}</strong><small>{hint}</small></span>
                <span className="nvu-op-sheet-arrow"><ArrowRight size={22} strokeWidth={1.8} /></span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </ManagementDialog>
  );
}
