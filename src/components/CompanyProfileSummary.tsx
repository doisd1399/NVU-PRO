import React, { useEffect, useState } from "react";
import { Building2, Check, Pencil, X } from "lucide-react";
import { StableImage } from "./common/StableImage";
import { useProfileCover } from "../hooks/useProfileCover";
import { resolveProfileCover } from "../lib/profileCover";
import { COMPANY_DESCRIPTION_LIMIT } from "../lib/companyProfileDescription";
import { useCompanyDescription } from "../hooks/useCompanyDescription";
import { ProfileSummaryFigures, type CompanyProfilePresentation } from "./driver/DriverProfileSummary";
import type { NormalizedTrip } from "../lib/tripNormalizer";

export function CompanyProfileSummary({ presentation, periodControl, trips, loading, start, end }: {
  presentation: CompanyProfilePresentation; periodControl: React.ReactNode; trips: NormalizedTrip[];
  loading: boolean; start: Date; end: Date;
}) {
  const { company, viewerId, canEdit } = presentation;
  const cover = useProfileCover(viewerId, { scope: "company", profileId: company.id }, resolveProfileCover(company));
  const description = useCompanyDescription(viewerId, company.id, canEdit, company);
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(""), [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setEditing(false); setError(""); setDraft(""); }, [company.id, viewerId, canEdit]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try { await description.save(draft); setEditing(false); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a descrição."); }
    finally { setSaving(false); }
  };
  return <section className="nvu-profile-summary-card nvu-company-profile-summary" aria-label="Resumo do período da empresa" data-nvu-profile-summary data-nvu-company-summary aria-busy={loading}>
    <header className="nvu-profile-performance-heading nvu-profile-summary-heading"><h3>Resumo do período</h3>{periodControl}</header>
    <StableImage src={cover.src} alt={`Capa de ${company.companyName}`} wrapperClassName="nvu-profile-summary-photo" className="object-cover"
      fallback={<span className="nvu-profile-summary-photo-empty"><Building2 size={28} aria-hidden="true"/><span>Capa da empresa</span></span>}/>
    <div className="nvu-company-summary-description">
      {editing && canEdit ? <form onSubmit={submit}>
        <label htmlFor={`company-description-${company.id}`}>Descrição da empresa</label>
        <textarea id={`company-description-${company.id}`} value={draft} maxLength={COMPANY_DESCRIPTION_LIMIT} rows={2} disabled={saving}
          onChange={event => setDraft(event.target.value)} aria-describedby={`company-description-count-${company.id}`}/>
        <div><small id={`company-description-count-${company.id}`}>{draft.length}/{COMPANY_DESCRIPTION_LIMIT}</small>
          <button type="button" disabled={saving} aria-label="Cancelar edição da descrição" onClick={() => { setEditing(false); setError(""); }}><X size={16}/></button>
          <button type="submit" disabled={saving} aria-label="Salvar descrição da empresa"><Check size={16}/></button></div>
      </form> : <><p>{description.text || (canEdit ? "Adicione uma breve descrição da empresa." : "")}</p>
        {canEdit && <button type="button" aria-label={description.text ? "Editar descrição da empresa" : "Adicionar descrição da empresa"}
          onClick={() => { setDraft(description.text); setError(""); setEditing(true); }}><Pencil size={15} aria-hidden="true"/></button>}</>}
    </div>
    {error && <p role="alert" className="nvu-company-description-feedback">{error}</p>}
    {description.pending && <p role="status" className="nvu-company-description-feedback">
      {description.failed ? "Descrição salva no aparelho. Sincronização pendente." : "Descrição salva no aparelho. Aguardando sincronização."}
      {description.failed && <button type="button" onClick={description.retry}>Tentar novamente</button>}</p>}
    <ProfileSummaryFigures trips={trips} loading={loading} start={start} end={end}/>
  </section>;
}
