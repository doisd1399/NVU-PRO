import React, { useContext, useMemo, useRef, useState } from "react";
import { ChevronRight, Check, Container, Search } from "lucide-react";
import { AssignmentOptionPicker, type PickerOption } from "../admin/AssignmentOptionPicker";
import { partnershipService } from "../../services/partnershipService";
import { operationalRequestId } from "../../lib/operationalRequestId";
import { isTrailerlessSimulator } from "../../lib/resolveSimulator";
import type { PartnerCandidates } from "../../lib/partnerCandidates";
import {
  clampDays, clampTrips, computeSettlement, emptyDraft, formatDays, formatMoney, MAX_CONDITIONS, offerHint, parseMoneyToCents, partnershipErrorMessage,
  LATE_PENALTY_PERCENT, type OfferDraft, type Partnership,
} from "../../lib/partnerships";
import { Avatar, BackLink, LogoContext } from "./shared";

export type CatalogState = { loaded: boolean; failed: boolean; retry: () => void };

/** Nova oferta (contratante): formulário curto. O veículo é da executora; a oferta só define reboque, prazo, viagens, valor e condições. */
export function NewOfferScreen({ me, ownCompany, candidates, catalog, initial, rows, trailers, simulators, onBack, onSent }: {
  me: string; ownCompany: any; candidates: PartnerCandidates; catalog: CatalogState; initial: { partnerId?: string; from?: Partnership }; rows: Partnership[];
  trailers: any[]; simulators: any[]; onBack: () => void; onSent: (executorReady: boolean, partnerName: string) => void;
}) {
  const from = initial.from;
  const money = (cents: number | null | undefined) => cents ? String(cents / 100).replace(".", ",") : "";
  const [draft, setDraft] = useState<OfferDraft>(() => ({
    ...emptyDraft(from ? from.executorCompanyId : initial.partnerId || ""),
    // Nada vem preenchido: só "Repetir oferta" copia os dados da oferta anterior (menos o nome).
    totalTrips: from ? String(from.totalTrips) : "", durationDays: from?.durationDays ? String(from.durationDays) : "",
    trailerRequirement: from?.trailerRequirement || "", conditions: from?.conditions || "", goal: money(from?.goalAmountCents), agreed: money(from?.agreedAmountCents),
  }));
  const { viewerId } = useContext(LogoContext);
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [query, setQuery] = useState(""), [searching, setSearching] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const requestId = useRef(operationalRequestId());
  const partner = candidates.list.find(item => item.id === draft.executorCompanyId);
  const trailerless = isTrailerlessSimulator(ownCompany, simulators);
  const set = (patch: Partial<OfferDraft>) => { setDraft(current => ({ ...current, ...patch })); setError(""); };
  const hint = offerHint(draft, Date.now(), trailerless);
  const agreedCents = draft.agreed.trim() ? parseMoneyToCents(draft.agreed) : null;
  const lateCents = agreedCents ? computeSettlement(agreedCents, 1, 2)?.finalCents ?? null : null;
  const trailerNames = useMemo(() => [...new Set(trailers.filter(item => !item.companyId || item.companyId === me).map(item => String(item.name || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })), [trailers, me]);

  const trailerOptions = useMemo<PickerOption[]>(() => {
    const names = draft.trailerRequirement && !trailerNames.some(name => name.toLowerCase() === draft.trailerRequirement.toLowerCase()) ? [draft.trailerRequirement, ...trailerNames] : trailerNames;
    return names.map(name => ({ id: name, title: name, description: "Reboque exigido na oferta", avatar: { icon: <Container size={22} strokeWidth={1.65} /> } }));
  }, [trailerNames, draft.trailerRequirement]);
  const q = query.trim().toLowerCase();
  const results = (q ? candidates.list.filter(item => item.name.toLowerCase().includes(q)) : candidates.list).slice(0, 6);
  const sourceHint = !catalog.loaded ? (catalog.failed ? "Não foi possível carregar as empresas." : "Carregando as empresas ativas…")
    : !candidates.simulatorId ? "Simulador da sua empresa não identificado."
    : `${candidates.list.length} ${candidates.list.length === 1 ? "empresa ativa" : "empresas ativas"} no ${candidates.simulatorLabel}`;

  const submit = async () => {
    const message = hint || (!partner ? "Escolha uma empresa ativa do seu simulador." : "");
    if (message) { setError(message); return; }
    setBusy(true); setError("");
    try {
      const sent = await partnershipService.createOffer({ contractorCompanyId: me, executorCompanyId: draft.executorCompanyId, operationName: draft.operationName.trim(), totalTrips: Number(draft.totalTrips),
        trailerRequirement: trailerless ? null : draft.trailerRequirement.trim() || null, durationDays: Number(draft.durationDays), conditions: draft.conditions.trim(),
        goalAmountCents: draft.goal.trim() ? parseMoneyToCents(draft.goal) : null, agreedAmountCents: agreedCents, requestId: requestId.current });
      onSent(sent.executorReady !== false, partner!.name);
    } catch (reason) { setError(partnershipErrorMessage(reason, "Não foi possível enviar a oferta.")); setBusy(false); }
  };

  return <>
    <BackLink label="Parcerias" onClick={onBack} />
    <section className="nvu-central-section b2p-sec"><div className="b2p-form">
      <h2>Nova oferta</h2>
      <div className="b2p-field"><span className="b2p-label">Empresa parceira</span>
        {partner && !searching ? <div className="b2p-picklist"><div className="b2p-pick" data-on="1"><Avatar name={partner.name} companyId={partner.id} size={34} />
          <span><b>{partner.name}</b><small>{partner.simulatorLabel}</small></span>
          <button type="button" className="b2p-btn" data-v="text" data-size="sm" onClick={() => { setSearching(true); setQuery(""); }}>Trocar</button></div></div>
        : <>
          <label className="b2p-input"><Search size={18} aria-hidden="true" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" aria-label="Buscar empresa parceira" placeholder="Buscar empresa ativa…" /></label>
          {catalog.loaded && results.length ? <div className="b2p-picklist" role="listbox" aria-label="Empresas parceiras">
            {results.map(item => <button type="button" role="option" aria-selected={draft.executorCompanyId === item.id} key={item.id} className="b2p-pick" data-on={draft.executorCompanyId === item.id ? "1" : "0"}
              onClick={() => { set({ executorCompanyId: item.id }); setSearching(false); setQuery(""); }}>
              <Avatar name={item.name} companyId={item.id} size={34} /><span><b>{item.name}</b><small>{item.simulatorLabel}{item.partnered ? " · já parceira" : ""}</small></span>
              <i className="b2p-radio" aria-hidden="true">{draft.executorCompanyId === item.id ? <Check size={12} /> : null}</i></button>)}
          </div> : null}
          {catalog.loaded && !results.length ? <p className="b2p-hint">{candidates.list.length ? "Nenhuma empresa encontrada com esse nome." : "Nenhuma outra empresa ativa neste simulador."}</p> : null}
          {catalog.failed ? <button type="button" className="b2p-btn" data-v="ghost" data-size="sm" onClick={catalog.retry}>Tentar novamente</button> : null}
        </>}
        <span className="b2p-hint">{sourceHint}</span>
      </div>

      <div className="b2p-field"><span className="b2p-label">Operação</span>
        <div className="b2p-input"><input aria-label="Nome da operação" value={draft.operationName} maxLength={60} onChange={event => set({ operationName: event.target.value })} placeholder="Nome da operação" /></div>
        <div className="b2p-grid2">
          <label className="b2p-input"><input inputMode="numeric" aria-label="Viagens" value={draft.totalTrips} placeholder="Viagens" onChange={event => set({ totalTrips: event.target.value.replace(/\D/g, "").slice(0, 3) })}
            onBlur={() => draft.totalTrips && set({ totalTrips: String(clampTrips(Number(draft.totalTrips))) })} /><span className="b2p-pre">viagens</span></label>
          <label className="b2p-input"><input inputMode="numeric" aria-label="Prazo em dias" value={draft.durationDays} placeholder="Prazo" onChange={event => set({ durationDays: event.target.value.replace(/\D/g, "").slice(0, 3) })}
            onBlur={() => draft.durationDays && set({ durationDays: String(clampDays(Number(draft.durationDays))) })} /><span className="b2p-pre">dias</span></label>
        </div>
        <span className="b2p-hint">O prazo{Number(draft.durationDays) > 0 ? ` de ${formatDays(Number(draft.durationDays))}` : ""} só começa a contar quando a parceira aceitar.</span>
      </div>

      {!trailerless ? <div className="b2p-field"><span className="b2p-label">Reboque <i>(opcional)</i></span>
        <button type="button" className="b2p-input" onClick={() => setTrailerOpen(true)} aria-haspopup="dialog">
          <Container size={18} aria-hidden="true" /><span style={{ flex: 1, color: draft.trailerRequirement ? undefined : "var(--central-muted)" }}>{draft.trailerRequirement || "Escolher reboque"}</span><ChevronRight size={18} aria-hidden="true" /></button></div> : null}

      <div className="b2p-field"><label htmlFor="b2p-terms">Condições do acordo <i>(opcional)</i></label>
        <div className="b2p-input" data-area="1"><textarea id="b2p-terms" value={draft.conditions} maxLength={MAX_CONDITIONS} rows={3} onChange={event => set({ conditions: event.target.value })} placeholder="Combinados entre as empresas…" /></div>
        <span className="b2p-hint">{draft.conditions.length}/{MAX_CONDITIONS}</span></div>

      <div className="b2p-field"><label htmlFor="b2p-agreed">Valor do acordo <i>(opcional)</i></label>
        <div className="b2p-input"><span className="b2p-pre">R$</span><input id="b2p-agreed" inputMode="decimal" value={draft.agreed} onChange={event => set({ agreed: event.target.value })} placeholder="Ex.: 25.000" /></div>
        {agreedCents ? <p className="b2p-note-box" data-tone="warn">No prazo: <b>{formatMoney(agreedCents)}</b>. Fora do prazo: <b>{formatMoney(lateCents ?? 0)}</b> (−{LATE_PENALTY_PERCENT}%, calculado pelo app). O pagamento é combinado entre as empresas, fora do NVU; o app só registra e calcula.</p>
          : <span className="b2p-hint">Valor negociado entre as empresas. Sem valor, a parceria é só de acompanhamento.</span>}
      </div>

      <div className="b2p-field"><label htmlFor="b2p-goal">Meta de ganhos <i>(opcional)</i></label>
        <div className="b2p-input"><span className="b2p-pre">R$</span><input id="b2p-goal" inputMode="decimal" value={draft.goal} onChange={event => set({ goal: event.target.value })} placeholder="Para acompanhar o progresso" /></div></div>

      <p className="b2p-hint">O veículo e o motorista são escolhidos pela empresa parceira, entre os da própria frota.</p>
      {error || hint ? <p className={error ? "b2p-alert" : "b2p-hint"} role={error ? "alert" : undefined}>{error || hint}</p> : null}
      <div className="b2p-actions">
        <button type="button" className="b2p-btn" data-v="primary" disabled={busy || Boolean(hint)} onClick={() => void submit()}>{busy ? "Enviando…" : "Enviar oferta"}</button>
        <button type="button" className="b2p-btn" data-v="ghost" onClick={onBack}>Cancelar</button>
      </div>
    </div></section>
    <AssignmentOptionPicker open={trailerOpen} title="Escolher reboque" subtitle="Reboque que a parceira deve usar na operação." icon={<Container size={26} strokeWidth={1.65} />}
      searchPlaceholder="Buscar ou digitar o reboque..." options={trailerOptions} selectedId={draft.trailerRequirement} counter={{ one: "1 reboque selecionado", none: "Nenhum reboque selecionado" }} confirmLabel="Usar reboque"
      emptyText="Sua frota não tem reboques cadastrados. Digite o nome do reboque exigido." noneOption={{ title: "Sem exigência de reboque", description: "A parceira usa qualquer reboque (ou nenhum)." }}
      custom={{ label: text => `Exigir “${text}”` }} viewerId={viewerId} onClose={() => setTrailerOpen(false)} onSelect={choice => set({ trailerRequirement: choice.id })} />
  </>;
}
