import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, ClipboardList, Send, Trophy } from "lucide-react";
import { useOperationalStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { useCompanyPayments, useCompanyRewards } from "../../hooks/useRewards";
import { rewardService } from "../../services/rewardService";
import { resolveSimulatorDisplayLabel } from "../../lib/simulatorOptions";
import { formatMoney, maskMoney, parseMoneyToCents } from "../../lib/partnerships";
import { CAMPAIGN_STATE_LABEL, OFFER_STATE_LABEL, campaignBudget, campaignState, goalOf, rewardErrorMessage, termText, type CampaignState, type RewardCampaign, type RewardOffer } from "../../lib/rewards";
import { BackLink, PageHeader, Section, Tabs } from "../../components/partnerships/shared";
import { PayrollTab, PaymentDetail, TransfersTab } from "./RewardPayroll";
import { DriverMultiSelect, type DriverChoice } from "../../components/rewards/DriverMultiSelect";
import { resolveDriverPhoto } from "../../lib/resolveDriverPhoto";
import AssignJobAssetPicker, { OperationCardBody } from "../../components/admin/AssignJobAssetPicker";
import "../../components/partnerships/Partnerships.css";

const TONE: Record<CampaignState, string> = { active: "good", scheduled: "warn", ended: "muted", cancelled: "muted", capped: "late" };
const OFFER_TONE: Record<string, string> = { pending: "warn", accepted: "good", declined: "muted", cancelled: "muted" };
const initials = (name: string) => name.split(/\s+/).map(word => word[0]).slice(0, 2).join("").toUpperCase();
const Bar = ({ pct, warn }: { pct: number; warn?: boolean }) => <div className="nvu-central-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><span style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: warn ? "var(--central-warning)" : undefined }} /></div>;
const Row = ({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) => <div data-total={strong ? "1" : undefined}><span>{label}</span><b>{value}</b></div>;

type View = { name: "list" } | { name: "new" } | { name: "detail"; id: string } | { name: "payment"; id: string; from: Tab };
type Tab = "campaigns" | "payroll" | "transfers";

/** Salário (Central de gestão): campanhas de ganho por viagem, folha de pagamento por Pix e transferências com comprovante. */
export default function Rewards() {
  const { activeCompanyId, companies, allCompanies, allCompanyMembers, allCompanyMembersReady } = useCompanyStore();
  const { users, simulators, contracts, sequences, trailers } = useOperationalStore();
  const me = activeCompanyId || "";
  const { campaigns, offers, ready, error } = useCompanyRewards(me);
  const ownCompany = companies.find(item => item.id === me) || allCompanies.find(item => item.id === me);
  const { payments, payDay, ready: paymentsReady } = useCompanyPayments(me);
  const [view, setView] = useState<View>({ name: "list" });
  const [tab, setTab] = useState<Tab>("campaigns");
  const [busy, setBusy] = useState(false);
  const now = useMemo(() => Date.now(), [campaigns, view]);
  useEffect(() => { window.scrollTo?.({ top: 0 }); }, [view.name]);
  const header = (title: string, description: string) => <PageHeader title={title} description={description} companyName={String(ownCompany?.companyName || ownCompany?.fleetName || "")} simulator={ownCompany ? resolveSimulatorDisplayLabel(ownCompany, simulators as any[], allCompanies) : ""} />;
  const shell = (title: string, description: string, children: React.ReactNode) => <div className="nvu-central-page nvu-b2p"><div className="nvu-central-stack">{header(title, description)}{children}</div></div>;
  if (!me) return shell("Salário", "Pague os motoristas pelos serviços prestados.", <p className="b2p-empty">Selecione uma empresa para ver o salário dos motoristas.</p>);
  const goList = () => setView({ name: "list" });

  if (view.name === "new") {
    const drivers: DriverChoice[] = (users as any[]).filter(user => user.status === "active" && (allCompanyMembers as any[]).some(member => member.userId === user.id && member.companyId === me && member.status === "active" && member.roles?.includes("driver")))
      .map(user => ({ id: String(user.id), name: String(user.name || "Motorista"), photo: resolveDriverPhoto(user) })).sort((x, y) => x.name.localeCompare(y.name));
    const ownContracts = (contracts as any[]).filter(item => item.companyId === me && item.status === "active" && item.deleted !== true);
    return shell("Nova campanha", "Escolha a operação e defina o pagamento.", <NewCampaign me={me} drivers={drivers} ready={Boolean(allCompanyMembersReady)} contracts={ownContracts} sequences={sequences as any[]} trailers={trailers as any[]} busy={busy} onBack={goList} onSend={async payload => {
      setBusy(true);
      try { const sent = await rewardService.create(payload); toast.success(`Oferta enviada a ${sent.drivers} ${sent.drivers === 1 ? "motorista" : "motoristas"}.`); goList(); }
      catch (reason) { toast.error(rewardErrorMessage(reason, "Não foi possível enviar a campanha.")); } finally { setBusy(false); }
    }} />);
  }
  if (view.name === "payment") {
    const back = view.from;
    return shell("Pagamento", "Pague por Pix e registre o comprovante.", <PaymentDetail payment={payments.find(item => item.id === view.id)} backLabel={back === "transfers" ? "Transferências" : "Folha"} onBack={() => { setTab(back); goList(); }} />);
  }
  if (view.name === "detail") {
    const campaign = campaigns.find(item => item.id === view.id);
    if (!campaign) return shell("Campanha", "Acompanhe o ganho dos motoristas.", <><BackLink label="Salário" onClick={goList} /><p className="b2p-empty">{ready ? "Esta campanha não está mais disponível." : "Carregando…"}</p></>);
    return shell("Campanha", "Acompanhe o ganho dos motoristas.", <CampaignDetail campaign={campaign} offers={offers.filter(offer => offer.campaignId === campaign.id)} now={now} busy={busy} onBack={goList}
      onCancel={async () => { if (!window.confirm("Encerrar esta campanha? Ofertas sem resposta serão canceladas e novas viagens deixam de ser creditadas. O que já foi ganho continua registrado.")) return; setBusy(true);
        try { await rewardService.cancel(campaign.id); toast.message("Campanha encerrada."); } catch (reason) { toast.error(rewardErrorMessage(reason, "Não foi possível encerrar a campanha.")); } finally { setBusy(false); } }} />);
  }

  const live = campaigns.filter(item => { const state = campaignState(item, now); return state === "active" || state === "scheduled" || state === "capped"; });
  const accrued = live.reduce((sum, item) => sum + item.accruedCents, 0), budget = live.reduce((sum, item) => sum + item.budgetCents, 0);
  const toPay = payments.filter(item => item.status === "pending" || item.status === "contested").length;
  const tabs = <Tabs<Tab> label="Seções de salário" value={tab} onChange={setTab} items={[{ id: "campaigns", label: "Campanhas" }, { id: "payroll", label: "Folha", count: toPay, warn: true }, { id: "transfers", label: "Transferências" }]} />;
  if (tab === "payroll") return shell("Salário", "Pague os motoristas pelos serviços prestados.", <>{tabs}<PayrollTab companyId={me} payments={payments} offers={offers} payDay={payDay} ready={paymentsReady} now={now} onOpen={id => setView({ name: "payment", id, from: "payroll" })} /></>);
  if (tab === "transfers") return shell("Salário", "Pague os motoristas pelos serviços prestados.", <>{tabs}<TransfersTab payments={payments} ready={paymentsReady} onOpen={id => setView({ name: "payment", id, from: "transfers" })} /></>);
  return shell("Salário", "Pague os motoristas pelos serviços prestados.", <>
    {tabs}
    {error ? <p className="b2p-alert" role="alert">Não foi possível atualizar as campanhas agora. Os dados podem estar desatualizados.</p> : null}
    <section className="nvu-central-section b2p-sec">
      <div className="b2p-sec-head"><h2>Investimento</h2></div>
      <div className="b2p-sum"><div><small>Ganhos acumulados</small><b>{formatMoney(accrued)}</b><em>nas campanhas em andamento</em></div><div><small>Teto das campanhas</small><b>{formatMoney(budget)}</b><em>{budget ? `restam ${formatMoney(Math.max(0, budget - accrued))}` : "sem campanhas ativas"}</em></div></div>
      <Bar pct={budget ? accrued / budget * 100 : 0} warn={Boolean(budget) && accrued / budget > 0.9} />
      <div className="b2p-facts"><div><b>{live.length}</b><span>Campanhas</span></div><div><b>{live.reduce((sum, item) => sum + item.acceptedCount, 0)}</b><span>Motoristas</span></div><div><b>{live.reduce((sum, item) => sum + item.tripsCount, 0)}</b><span>Viagens</span></div></div>
    </section>
    <Section title="Campanhas" count={campaigns.length} action={<button type="button" className="b2p-btn" data-v="ghost" data-size="sm" onClick={() => setView({ name: "new" })}>+ Nova campanha</button>}>
      {campaigns.length ? campaigns.map(campaign => { const state = campaignState(campaign, now);
        return <button type="button" className="b2p-row" key={campaign.id} onClick={() => setView({ name: "detail", id: campaign.id })} aria-label={`${campaign.name}, ${CAMPAIGN_STATE_LABEL[state]}`}>
          <span className="nvu-central-avatar b2p-logo" style={{ display: "inline-grid", placeItems: "center", width: 44, height: 44 }}><Trophy size={20} aria-hidden="true" /></span>
          <span className="b2p-row-head"><strong className="b2p-row-title">{campaign.name}</strong><span className="b2p-pill b2p-row-status" data-tone={TONE[state]}><i aria-hidden="true" />{CAMPAIGN_STATE_LABEL[state]}</span></span>
          <span className="b2p-row-sub">{campaign.contractName ? `${campaign.contractName} · ` : ""}{termText(campaign)} · {formatMoney(campaign.perTripCents)} por viagem</span>
          <span className="b2p-row-facts"><span>{formatMoney(campaign.accruedCents)}</span><span>{campaign.tripsCount} {campaign.tripsCount === 1 ? "viagem" : "viagens"}</span><span>{campaign.acceptedCount} de {campaign.driversCount} aceitaram</span></span>
          <ChevronRight className="b2p-row-chev" size={18} aria-hidden="true" />
        </button>; }) : <p className="b2p-empty">{ready ? "Nenhuma campanha ainda. Toque em + Nova campanha." : "Carregando campanhas…"}</p>}
      <p className="b2p-hint">Quando o ganho chega ao teto, a campanha para de creditar viagens e você é avisado.</p>
    </Section>
  </>);
}

const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => <div className="b2p-field"><span className="b2p-label">{label}</span>{children}{hint ? <span className="b2p-hint">{hint}</span> : null}</div>;
type ContractChoice = { id: string; name: string; deadlineDays?: number; totalDeliveries?: number; mode?: string; trailerId?: string | null; sequenceId?: string | null; sequenceOrder?: number | null };

/**
 * Nova campanha: 1) operação (seletor "Escolher operação"), 2) valor por viagem, 3) meta de ganhos, 4) quem participa, 5) nome.
 * As viagens e o prazo vêm da operação. Valor por viagem e meta andam juntos: meta = valor por viagem × viagens da operação (o total que o motorista alcança ao concluir).
 */
function NewCampaign({ me, drivers, ready, contracts, sequences, trailers, busy, onBack, onSend }: { me: string; drivers: DriverChoice[]; contracts: ContractChoice[]; sequences: any[]; trailers: any[]; ready: boolean; busy: boolean; onBack: () => void; onSend: (payload: Parameters<typeof rewardService.create>[0]) => Promise<void> }) {
  const [contractId, setContractId] = useState(""), [pickerOpen, setPickerOpen] = useState(false), [perTrip, setPerTrip] = useState(""), [goalText, setGoalText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState(""), [error, setError] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  const contract = contracts.find(item => item.id === contractId), trips = Math.max(0, Math.floor(Number(contract?.totalDeliveries) || 0));
  const trailer = trailers.find(item => item.id === contract?.trailerId);
  const suggestion = contract ? `Campanha ${contract.name}`.slice(0, 60) : "", finalName = name.trim() || suggestion; // nome em branco usa a sugestão (sem texto pré-preenchido atrapalhando a digitação)
  const perTripCents = parseMoneyToCents(perTrip) || 0, people = picked.length;
  const goalCents = perTripCents * trips; // total que o motorista alcança ao concluir a operação
  const totalTrips = people * trips, budget = totalTrips * perTripCents; // investimento = total de viagens (bruto) × valor por viagem = o que o empresário paga aos motoristas
  const money = (cents: number) => cents ? maskMoney(String(cents)) : "";
  // Os dois campos andam juntos: mexer em um recalcula o outro (a meta é sempre valor por viagem × viagens da operação).
  const changePerTrip = (value: string) => { const text = maskMoney(value); setPerTrip(text); setGoalText(trips ? money((parseMoneyToCents(text) || 0) * trips) : ""); };
  const changeGoal = (value: string) => { const text = maskMoney(value), each = trips ? Math.floor((parseMoneyToCents(text) || 0) / trips) : 0; setGoalText(text); setPerTrip(each ? money(each) : ""); };
  const snapGoal = () => setGoalText(goalCents ? money(goalCents) : ""); // ao sair do campo, mostra a meta exata (valor por viagem × viagens)
  const send = async () => {
    if (!contractId) return setError("Escolha a operação da campanha.");
    if (!trips) return setError("Essa operação não tem viagens. Escolha outra operação.");
    if (!perTripCents) return setError("Informe o valor por viagem ou a meta de ganhos.");
    if (!people) return setError(drivers.length ? "Escolha ao menos um motorista." : "A empresa não tem motoristas ativos.");
    if (finalName.length < 3) return setError("Dê um nome à campanha (ao menos 3 letras).");
    setError(""); await onSend({ companyId: me, contractId, name: finalName, perTripCents, goalCents, audience: "selected", driverIds: picked, requestId });
  };
  return <>
    <BackLink label="Salário" onClick={onBack} />
    <section className="nvu-central-section b2p-sec"><div className="b2p-form">
      <Field label="1. Operação" hint={contract?.deadlineDays ? `O prazo é o da operação (${contract.deadlineDays} dias). O pagamento vale só para viagens dessa operação.` : "O prazo é o da operação. O pagamento vale só para viagens dessa operação."}>
        {/* Prévia igual ao cartão da lista "Escolher operação"; tocar abre a lista para trocar */}
        <div className="nvu-assignment-theme"><button type="button" className={"nvu-assignment-choice nvu-assignment-contract-choice" + (contract ? " is-selected" : "")} onClick={() => setPickerOpen(true)} aria-haspopup="dialog" aria-label={contract ? `Alterar operação: ${contract.name}` : "Escolher operação"}>
          {contract ? <OperationCardBody name={contract.name} trailerName={trailer?.name || "Qualquer reboque"} totalDeliveries={contract.totalDeliveries} deadlineDays={contract.deadlineDays} />
            : <><span className="nvu-assignment-choice-symbol"><ClipboardList size={23} strokeWidth={1.65} /></span><span className="nvu-assignment-choice-copy"><strong>Escolher operação</strong></span></>}
          <ChevronRight size={18} aria-hidden="true" style={{ alignSelf: "center", justifySelf: "center" }} /></button></div>
        {!contracts.length ? <span className="b2p-note-box" data-tone="warn" role="note">Nenhuma operação ativa. Cadastre uma em Central de gestão → Operações e volte aqui.</span> : null}
      </Field>
      <Field label="2. Valor por viagem"><div className="b2p-input"><span className="b2p-pre">R$</span><input inputMode="numeric" value={perTrip} placeholder="25,00" onChange={event => changePerTrip(event.target.value)} /></div></Field>
      <Field label="3. Meta de ganhos" hint="Total que o motorista alcança ao concluir a operação."><div className="b2p-input"><span className="b2p-pre">R$</span><input inputMode="numeric" value={goalText} placeholder="300,00" onChange={event => changeGoal(event.target.value)} onBlur={snapGoal} /></div></Field>
      <DriverMultiSelect drivers={drivers} selected={picked} onChange={setPicked} disabled={busy} ready={ready} />
      <Field label="4. Nome da campanha"><div className="b2p-input"><input value={name} maxLength={60} placeholder={suggestion || "Ex.: Semana de Ouro"} onChange={event => setName(event.target.value)} /></div></Field>
      <div className="b2p-settle">
        <Row label={`Viagens no total (1 operação de ${trips} ${trips === 1 ? "viagem" : "viagens"} × ${people} ${people === 1 ? "motorista" : "motoristas"})`} value={totalTrips} strong />
        <Row label={`Investimento total a pagar aos motoristas (${totalTrips} ${totalTrips === 1 ? "viagem" : "viagens"} × ${formatMoney(perTripCents)})`} value={formatMoney(budget)} strong />
      </div>
      <p className="b2p-hint">{goalCents ? `Se todos os motoristas atingirem a meta de ${formatMoney(goalCents)} cada, o investimento é de ${formatMoney(budget)}. ` : ""}Cada motorista recebe a oferta e aceita ou recusa. Só contam viagens da operação confirmadas depois do aceite. O pagamento sai na folha do dia de pagamento, depois que o motorista conclui a operação; se não concluir na semana, recebe na semana seguinte.</p>
      {error ? <p className="b2p-alert" role="alert">{error}</p> : null}
      <div className="b2p-actions"><button type="button" className="b2p-btn" data-v="primary" disabled={busy} onClick={() => void send()}><Send size={16} aria-hidden="true" />{busy ? "Enviando…" : "Enviar oferta aos motoristas"}</button></div>
    </div></section>
    <AssignJobAssetPicker kind="contract" open={pickerOpen} selectedId={contractId} contracts={contracts} sequences={sequences} trailers={trailers} onClose={() => setPickerOpen(false)} onSelect={id => { setContractId(id); const next = contracts.find(item => item.id === id), n = Math.max(0, Math.floor(Number(next?.totalDeliveries) || 0)); setGoalText(n && perTripCents ? money(perTripCents * n) : ""); }} />
  </>;
}

function CampaignDetail({ campaign, offers, now, busy, onBack, onCancel }: { campaign: RewardCampaign; offers: RewardOffer[]; now: number; busy: boolean; onBack: () => void; onCancel: () => void }) {
  const state = campaignState(campaign, now), open = campaign.status === "active" && now <= campaign.endMs && !campaign.capped;
  return <>
    <BackLink label="Salário" onClick={onBack} />
    <section className="nvu-central-section b2p-sec">
      <div className="b2p-sec-head"><h2>{campaign.name}</h2><span className="b2p-pill" data-tone={TONE[state]}><i aria-hidden="true" />{CAMPAIGN_STATE_LABEL[state]}</span></div>
      <div className="b2p-sum"><div><small>Ganhos acumulados</small><b>{formatMoney(campaign.accruedCents)}</b><em>{campaign.tripsCount} {campaign.tripsCount === 1 ? "viagem" : "viagens"}</em></div><div><small>Teto</small><b>{formatMoney(campaign.budgetCents)}</b><em>restam {formatMoney(Math.max(0, campaign.budgetCents - campaign.accruedCents))}</em></div></div>
      <Bar pct={campaign.budgetCents ? campaign.accruedCents / campaign.budgetCents * 100 : 0} warn={campaign.capped} />
      <div className="b2p-settle">
        {campaign.contractName ? <Row label="Operação" value={campaign.contractName} /> : null}<Row label="Prazo" value={termText(campaign)} /><Row label="Ganho por viagem" value={formatMoney(campaign.perTripCents)} />
        {campaign.maxTripsPerDriver ? <><Row label="Viagens da operação" value={campaign.maxTripsPerDriver} /><Row label="Meta de ganhos por motorista" value={formatMoney(goalOf(campaign))} /></> : null}
        {campaign.bonusCents ? <Row label="Bônus da meta" value={`${formatMoney(campaign.bonusCents)} em ${campaign.bonusGoalTrips} viagens`} /> : null}
        <Row label="Aceitaram" value={`${campaign.acceptedCount} de ${campaign.driversCount}`} />
      </div>
      {campaign.capped ? <p className="b2p-note-box" data-tone="warn">O teto foi atingido: novas viagens não são mais creditadas.</p> : null}
    </section>
    <Section title="Motoristas" count={offers.length}>
      {offers.length ? [...offers].sort((a, b) => b.totalCents - a.totalCents || a.driverName.localeCompare(b.driverName)).map((offer, index) => <div className="b2p-wrow" key={offer.id} style={index ? undefined : { borderTop: 0 }}>
        <span className="nvu-central-avatar" style={{ display: "inline-grid", placeItems: "center", width: 36, height: 36, fontWeight: 700 }}>{initials(offer.driverName)}</span>
        <div><b>{offer.driverName}</b><small>{offer.status === "accepted" ? `${offer.trips}${campaign.maxTripsPerDriver ? ` de ${campaign.maxTripsPerDriver}` : ""} ${(campaign.maxTripsPerDriver || offer.trips) === 1 ? "viagem" : "viagens"}${offer.goalReached ? " · bônus de meta" : ""}` : OFFER_STATE_LABEL[offer.status]}</small></div>
        <span className="b2p-amt"><strong data-k="x">{offer.status === "accepted" ? formatMoney(offer.totalCents) : "—"}</strong><span className="b2p-pill" data-tone={OFFER_TONE[offer.status]} style={{ padding: "1px 9px", fontSize: 11 }}><i aria-hidden="true" />{OFFER_STATE_LABEL[offer.status]}</span></span></div>)
        : <p className="b2p-empty">Carregando motoristas…</p>}
      <p className="b2p-hint">Contam só as viagens confirmadas pelo servidor, da operação da campanha, depois do aceite do motorista.</p>
    </Section>
    {open || campaign.status === "active" && campaign.endMs >= now ? <div className="b2p-actions b2p-detail-actions"><button type="button" className="b2p-btn" data-v="danger" disabled={busy} onClick={onCancel}>Encerrar campanha</button></div> : null}
  </>;
}
