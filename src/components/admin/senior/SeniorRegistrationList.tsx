import { CachedImage } from "../../common/CachedImage";
import React, { useEffect, useState } from "react";
import { Building2, CalendarDays, ChevronRight, CheckCircle2, Gamepad2, ListFilter, Trash2 } from "lucide-react";
import { registrationSubmissionLabel } from "../../../lib/registrationSubmission";

export function SeniorRegistrationList({ registrations, listKey, simulatorLabel, onOpen, onDelete }: {
  registrations: any[]; listKey: string; simulatorLabel: (registration: any) => string;
  onOpen: (id: string) => void; onDelete: (id: string) => void;
}) {
  const [visible, setVisible] = useState(20);
  useEffect(() => setVisible(20), [listKey]);
  return <section className="nvu-senior-requests" aria-labelledby="senior-requests-title">
    <div className="nvu-senior-list-heading">
      <h2 id="senior-requests-title">Cadastros recebidos <span>{registrations.length}</span></h2>
      <span><ListFilter size={15} /> Mais recentes</span>
    </div>
    {registrations.length === 0 ? <div className="nvu-senior-empty"><CheckCircle2 size={28} /><h3>Nenhum cadastro encontrado</h3><p>Os novos formulários enviados aparecerão aqui.</p></div> :
      <div className="nvu-senior-registration-list">{registrations.slice(0, visible).map(reg => <article key={reg.id} className="nvu-senior-registration-row">
        <button type="button" className="nvu-senior-registration-open" onClick={() => onOpen(reg.id)} aria-label={`Analisar cadastro de ${reg.companyName}`}>
          <span className="nvu-senior-company-logo">{reg.companyLogoURL ? <CachedImage src={reg.companyLogoURL} alt="" referrerPolicy="no-referrer" /> : <Building2 size={22} />}</span>
          <span className="nvu-senior-registration-info"><strong>{reg.companyName || "Empresa sem nome"}</strong><span className="nvu-senior-registration-owner"><span>{reg.ownerName || "Responsável não informado"}</span><span><Gamepad2 size={13} />{simulatorLabel(reg)}</span></span><span className="nvu-senior-registration-cnpj">{reg.cnpj || "CNPJ não informado"}</span></span>
          <ChevronRight size={19} className="nvu-senior-registration-chevron" />
        </button>
        <div className="nvu-senior-registration-footer"><span className="nvu-senior-submission"><CalendarDays size={13} />{registrationSubmissionLabel(reg)}</span><span className={`nvu-senior-registration-status ${reg.status === "pending" ? "is-pending" : ""}`}><i />{reg.status === "pending" ? "Em análise" : "Recusada"}</span>{reg.status === "rejected" && <button type="button" className="nvu-senior-delete-registration" onClick={() => onDelete(reg.id)} aria-label={`Excluir cadastro recusado de ${reg.companyName}`}><Trash2 size={15} /></button>}</div>
      </article>)}</div>}
    {registrations.length > 0 && <div className="nvu-senior-list-footer"><span>Exibindo {Math.min(visible, registrations.length)} de {registrations.length} cadastros</span>{visible < registrations.length && <button type="button" onClick={() => setVisible(value => value + 20)}>Ver mais cadastros <ChevronRight size={15} /></button>}</div>}
  </section>;
}
