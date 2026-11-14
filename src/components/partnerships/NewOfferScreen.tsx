import React, { useContext, useMemo, useRef, useState } from "react";
import { ChevronRight, Container, Handshake } from "lucide-react";
import { AssignmentOptionPicker, type PickerOption } from "../admin/AssignmentOptionPicker";
import { partnershipService } from "../../services/partnershipService";
import { operationalRequestId } from "../../lib/operationalRequestId";
import { isTrailerlessSimulator } from "../../lib/resolveSimulator";
import type { PartnerCandidates } from "../../lib/partnerCandidates";
import {
  centsToMasked, clampDays, clampTrips, computeSettlement, emptyDraft, formatMoney, initialsOf, LATE_PENALTY_PERCENT, MAX_CONDITIONS, maskMoney, offerHint,
  parseMoneyToCents, partnershipErrorMessage, shortName, type OfferDraft, type Partnership,
} from "../../lib/partnerships";
import { Avatar, BackLink, LogoContext } from "./shared";

export type CatalogState = { loaded: boolean; failed: boolean; retry: () => void };
type ValueMode = "total" | "trip";

/** Nova oferta (contratante): formulário curto, sem rótulos repetidos. O veículo é da executora; a oferta só define reboque, prazo, viagens, valor e condições. */
export function NewOfferScreen({ me, ownCompany, candidates, catalog, initial, trailers, simulators, onBack, onSent }: {
  me: string; ownCompany: any; candidates: PartnerCandidates; catalog: CatalogState; initial: { partnerId?: string; from?: Partnership }; rows: Partnership[];
  trailers: any[]; simulators: any[]; onBack: () => void; onSent: (executorReady: boolean, partnerName: string) => void;
}) {
  const { viewerId } = useContext(LogoContext);
  const from = initial.from;
  // Nada vem preenchido: só "Repetir oferta" copia os dados da oferta anterior (menos o nome).
  const [draft, setDraft] = useState<OfferDraft>(() => ({
    ...emptyDraft(from ? from.executorCompanyId : initial.partnerId || ""),
    totalTrips: from ? String(from.totalTrips) : "", durationDays: from?.durationDays ? String(from.durationDays) : "",
    trailerRequirement: from?.trailerRequirement || "", conditions: from?.conditions || "", goal: centsToMasked(from?.goalAmountCents), agreed: centsToMasked(from?.agreedAmountCents),
  }));
  const [mode, setMode] = useState<ValueMode>("total");
  const [partnerOpen, setPartnerOpen] = useState(false), [trailerOpen, setTrailerOpen] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const requestId = useRef(operationalRequestId());
  const partner = candidates.list.find(item => item.id === draft.executorCompanyId);
  const trailerless = isTrailerlessSimulator(ownCompany, simulators);
  const set = (patch: Partial<OfferDraft>) => { setDraft(current => ({ ...current, ...patch })); setError(""); };
  const hint = offerHint(draft, Date.now(), trailerless);

  // Valor: total ou por viagem (o app calcula o total da operação = valor por viagem × viagens). O servidor guarda sempre o total.
  const trips = Number(draft.totalTrips) || 0;
  const typedCents = draft.agreed.trim() ? parseMoneyToCents(draft.agreed) : null;
  const agreedCents = typedCents && mode === "trip" ? (trips > 0 ? typedCents * trips : null) : typedCents;
  const perTripCents = typedCents && mode === "trip" ? typedCents : agreedCents && trips > 0 ? Math.round(agreedCents / trips) : null;
  const lateCents = agreedCents ? computeSettlement(agreedCents, 1, 2)?.finalCents ?? null : null;
  const valueBlocked = mode === "trip" && Boolean(typedCents) && trips < 1;

  const trailerNames = useMemo(() => [...new Set(trailers.filter(item => !item.companyId || item.companyId === me).map(item => String(item.name || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })), [trailers, me]);
  const trailerOptions = useMemo<PickerOption[]>(() => {
    const names = draft.trailerRequirement && !trailerNames.some(name => name.toLowerCase() === draft.trailerRequirement.toLowerCase()) ? [draft.trailerRequirement, ...trailerNames] : trailerNames;
    return names.map(name => ({ id: name, title: name, description: "Da sua frota", avatar: { icon: <Container size={22} strokeWidth={1.65} /> } }));
  }, [trailerNames, draft.trailerRequirement]);
  const partnerOptions = useMemo<PickerOption[]>(() => candidates.list.map(item => ({
    id: item.id, title: shortName(item.name), keywords: item.name, description: item.partnered ? "Já parceira" : undefined,
    avatar: { src: item.logo, assetId: `company-logo:${item.id}`, initials: initialsOf(item.name) },
  })), [candidates.list]);

  const submit = async () => {
    const message = hint || (!partner ? "Escolha uma empresa ativa do seu simulador." : valueBlocked ? "Informe as viagens para calcular o total." : "");
    if (message) { setError(message); return; }
    setBusy(true); setError("");
    try {
      const sent = await partnershipService.createOffer({ contractorCompanyId: me, executorCompanyId: draft.executorCompanyId, operationName: draft.operationName.trim(), totalTrips: Number(draft.totalTrips),
        trailerRequirement: trailerless ? null : draft.trailerRequirement.trim() || null, durationDays: Number(draft.durationDays), conditions: draft.conditions.trim(),
        goalAmountCents: draft.goal.trim() ? parseMoneyToCents(draft.goal) : null, agreedAmountCents: agreedCents, requestId: requestId.current });
      onSent(sent.executorReady !== false, shortName(partner!.name));
    } catch (reason) { setError(partnershipErrorMessage(reason, "Não foi possível enviar a oferta.")); setBusy(false); }
  };

  const partnerProblem = !catalog.loaded ? (catalog.failed ? "Não foi possível carregar as empresas." : "Carregando as empresas ativas…") : !candidates.simulatorId ? "Simulador da sua empresa não identificado." : "";
  const pending = hint || (valueBlocked ? "Informe as viagens para calcular o total." : "");

  return <>
    <BackLink label="Parcerias" onClick={onBack} />
    <section className="nvu-central-section b2p-sec"><div className="b2p-form">
      <button type="button" className="b2p-input" onClick={() => catalog.failed ? catalog.retry() : setPartnerOpen(true)} disabled={!catalog.loaded && !catalog.failed} aria-haspopup="dialog" aria-label="Escolher empresa parceira">
        {partner ? <><Avatar name={partner.name} companyId={partner.id} size={28} /><span style={{ flex: 1 }}>{shortName(partner.name)}</span></>
          : <><Handshake size={18} aria-hidden="true" /><span style={{ flex: 1, color: "var(--central-muted)" }}>{catalog.failed ? "Tentar carregar as empresas" : "Escolher empresa parceira"}</span></>}
        <ChevronRight size={18} aria-hidden="true" /></button>
      {partnerProblem ? <span className="b2p-hint">{partnerProblem}</span> : null}

      <div className="b2p-input"><input aria-label="Nome da operação" value={draft.operationName} maxLength={60} onChange={event => set({ operationName: event.target.value })} placeholder="Nome da operação" /></div>
      <div className="b2p-grid2">
        <div className="b2p-input"><input inputMode="numeric" aria-label="Quantidade de viagens" value={draft.totalTrips} placeholder="Viagens" onChange={event => set({ totalTrips: event.target.value.replace(/\D/g, "").slice(0, 3) })}
          onBlur={() => draft.totalTrips && set({ totalTrips: String(clampTrips(Number(draft.totalTrips))) })} />{draft.totalTrips ? <span className="b2p-pre">{Number(draft.totalTrips) === 1 ? "viagem" : "viagens"}</span> : null}</div>
        <div className="b2p-input"><input inputMode="numeric" aria-label="Prazo em dias" value={draft.durationDays} placeholder="Prazo (dias)" onChange={event => set({ durationDays: event.target.value.replace(/\D/g, "").slice(0, 3) })}
          onBlur={() => draft.durationDays && set({ durationDays: String(clampDays(Number(draft.durationDays))) })} />{draft.durationDays ? <span className="b2p-pre">{Number(draft.durationDays) === 1 ? "dia" : "dias"}</span> : null}</div>
      </div>
      <span className="b2p-hint">O prazo só começa a contar quando a parceira aceitar.</span>

      {!trailerless ? <button type="button" className="b2p-input" onClick={() => setTrailerOpen(true)} aria-haspopup="dialog" aria-label="Escolher reboque">
        <Container size={18} aria-hidden="true" /><span style={{ flex: 1, color: draft.trailerRequirement ? undefined : "var(--central-muted)" }}>{draft.trailerRequirement || "Reboque da operação (opcional)"}</span><ChevronRight size={18} aria-hidden="true" /></button> : null}

      <div className="b2p-input" data-area="1"><textarea aria-label="Condições do acordo" value={draft.conditions} maxLength={MAX_CONDITIONS} rows={2} onChange={event => set({ conditions: event.target.value })} placeholder="Condições do acordo (opcional)" /></div>
      {draft.conditions ? <span className="b2p-count">{draft.conditions.length}/{MAX_CONDITIONS}</span> : null}

      <div className="b2p-seg" role="tablist" aria-label="Tipo de valor">
        <button type="button" role="tab" aria-selected={mode === "total"} data-on={mode === "total" ? "1" : "0"} onClick={() => setMode("total")}>Valor total</button>
        <button type="button" role="tab" aria-selected={mode === "trip"} data-on={mode === "trip" ? "1" : "0"} onClick={() => setMode("trip")}>Valor por viagem</button>
      </div>
      <label className="b2p-input"><span className="b2p-pre">R$</span><input inputMode="numeric" aria-label={mode === "trip" ? "Valor por viagem" : "Valor total do acordo"} value={draft.agreed} placeholder="0,00 (opcional)" onChange={event => set({ agreed: maskMoney(event.target.value) })} /></label>
      {agreedCents ? <p className="b2p-note-box" data-tone="warn">
        {mode === "trip" ? <>{trips} {trips === 1 ? "viagem" : "viagens"} × {formatMoney(typedCents || 0)} = <b>{formatMoney(agreedCents)}</b> no total.</>
          : <>Total <b>{formatMoney(agreedCents)}</b>{perTripCents ? <> ({formatMoney(perTripCents)} por viagem)</> : null}.</>}
        {" "}Fora do prazo: <b>{formatMoney(lateCents ?? 0)}</b> (−{LATE_PENALTY_PERCENT}%). O pagamento é combinado entre as empresas; o app só registra e calcula.</p> : null}

      <label className="b2p-input"><span className="b2p-pre">{draft.goal ? "Meta R$" : "R$"}</span><input inputMode="numeric" aria-label="Meta de ganhos" value={draft.goal} placeholder="Meta de ganhos (opcional)" onChange={event => set({ goal: maskMoney(event.target.value) })} /></label>
      {draft.goal ? <p className="b2p-hint">Com meta, a empresa que executa só recebe se os ganhos das viagens chegarem a ela. Concluindo abaixo da meta, <b>não há pagamento</b> pelo trabalho.</p> : null}

      {error || pending ? <p className={error ? "b2p-alert" : "b2p-hint"} role={error ? "alert" : undefined}>{error || pending}</p> : null}
      <div className="b2p-actions">
        <button type="button" className="b2p-btn" data-v="primary" disabled={busy || Boolean(pending)} onClick={() => void submit()}>{busy ? "Enviando…" : "Enviar oferta"}</button>
        <button type="button" className="b2p-btn" data-v="ghost" onClick={onBack}>Cancelar</button>
      </div>
    </div></section>

    <AssignmentOptionPicker open={partnerOpen} title="Escolher empresa" subtitle="Empresas ativas do seu simulador." icon={<Handshake size={26} strokeWidth={1.65} />}
      searchPlaceholder="Buscar empresa..." options={partnerOptions} selectedId={draft.executorCompanyId} counter={{ one: "1 empresa selecionada", none: "Nenhuma empresa selecionada" }} confirmLabel="Usar empresa"
      emptyText="Nenhuma outra empresa ativa neste simulador." viewerId={viewerId} onClose={() => setPartnerOpen(false)} onSelect={choice => set({ executorCompanyId: choice.id })} />
    <AssignmentOptionPicker open={trailerOpen} title="Escolher reboque" subtitle="Reboque da sua frota que será usado na operação." icon={<Container size={26} strokeWidth={1.65} />}
      searchPlaceholder="Buscar reboque..." options={trailerOptions} selectedId={draft.trailerRequirement} counter={{ one: "1 reboque selecionado", none: "Nenhum reboque selecionado" }} confirmLabel="Usar reboque"
      emptyText="Sua frota não tem reboques cadastrados. Cadastre em Frota." noneOption={{ title: "Sem reboque", description: "A operação segue sem reboque." }}
      viewerId={viewerId} onClose={() => setTrailerOpen(false)} onSelect={choice => set({ trailerRequirement: choice.id })} />
  </>;
}
