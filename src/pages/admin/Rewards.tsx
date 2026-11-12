import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, ClipboardList, KeyRound, Pencil, Send, Trophy } from "lucide-react";
import { useOperationalStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { useCompanyPayments, useCompanyRewards } from "../../hooks/useRewards";
import { rewardService } from "../../services/rewardService";
import { resolveSimulatorDisplayLabel } from "../../lib/simulatorOptions";
import { centsToMasked, formatMoney, maskMoney, parseMoneyToCents } from "../../lib/partnerships";
import { CAMPAIGN_STATE_LABEL, OFFER_STATE_LABEL, campaignBudget, campaignState, goalEstimate, goalOf, offerCompleted, rewardErrorMessage, termText, type CampaignState, type RewardCampaign, type RewardOffer } from "../../lib/rewards";
import { BackLink, PageHeader, Section, Tabs } from "../../components/partnerships/shared";
import { PayrollTab, PaymentDetail, TransfersTab } from "./RewardPayroll";
import { DriverMultiSelect, type DriverChoice } from "../../components/rewards/DriverMultiSelect";
import { resolveDriverPhoto } from "../../lib/resolveDriverPhoto";
import AssignJobAssetPicker, { OperationCardBody } from "../../components/admin/AssignJobAssetPicker";
import { countFleetAssetUsage } from "../../lib/fleetUsage";
import { DriverAvatar, DriverPhotosContext } from "../../components/rewards/DriverAvatar";
import "../../components/partnerships/Partnerships.css";

const TONE: Record<CampaignState, string> = { active: "good", scheduled: "warn", ended: "muted", cancelled: "muted", capped: "late" };
const OFFER_TONE: Record<string, string> = { pending: "warn", accepted: "good", declined: "muted", cancelled: "muted" };
const offerLabel = (offer: RewardOffer) => offer.status === "pending" && offer.jobId ? "Na fila do motorista" : OFFER_STATE_LABEL[offer.status];
const Bar = ({ pct, warn }: { pct: number; warn?: boolean }) => <div className="nvu-central-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><span style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: warn ? "var(--central-warning)" : undefined }} /></div>;
const Row = ({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) => <div data-total={strong ? "1" : undefined}><span>{label}</span><b>{value}</b></div>;

type View = { name: "list" } | { name: "new" } | { name: "edit"; id: string } | { name: "detail"; id: string } | { name: "payment"; id: string; from: Tab };
type Tab = "campaigns" | "payroll" | "transfers";

/** Pagamentos (Central de gestão): campanhas de ganho por viagem, folha de pagamento por Pix e transferências com comprovante. */
export default function Rewards() {
  const { activeCompanyId, companies, allCompanies, allCompanyMembers, allCompanyMembersReady } = useCompanyStore();
  const { users, simulators, contracts, sequences, trailers, vehicles, jobs } = useOperationalStore();
  const me = activeCompanyId || "";
  const { campaigns: allCampaigns, offers, ready, error } = useCompanyRewards(me);
  const campaigns = useMemo(() => allCampaigns.filter(item => !item.hidden), [allCampaigns]); // excluídas do histórico não aparecem
  const ownCompany = companies.find(item => item.id === me) || allCompanies.find(item => item.id === me);
  const { payments, payDay, ready: paymentsReady } = useCompanyPayments(me);
  const [view, setView] = useState<View>({ name: "list" });
  const [tab, setTab] = useState<Tab>("campaigns");
  const [busy, setBusy] = useState(false);
  const now = useMemo(() => Date.now(), [campaigns, view]);
  useEffect(() => { window.scrollTo?.({ top: 0 }); }, [view.name]);
  const header = (title: string, description: string) => <PageHeader title={title} description={description} companyName={String(ownCompany?.companyName || ownCompany?.fleetName || "")} simulator={ownCompany ? resolveSimulatorDisplayLabel(ownCompany, simulators as any[], allCompanies) : ""} />;
  // Fotos dos motoristas nas listas de Pagamentos (campanha, folha e transferências).
  const photos = useMemo(() => new Map((users as any[]).map(user => [String(user.id), resolveDriverPhoto(user) || ""] as [string, string]).filter(([, photo]) => photo)), [users]);
  const shell = (title: string, description: string, children: React.ReactNode) => <DriverPhotosContext.Provider value={photos}><div className="nvu-central-page nvu-b2p"><div className="nvu-central-stack">{header(title, description)}{children}</div></div></DriverPhotosContext.Provider>;
  if (!me) return shell("Pagamentos", "Pague os motoristas.", <p className="b2p-empty">Selecione uma empresa.</p>);
  const goList = () => setView({ name: "list" });

  if (view.name === "new") {
    const drivers: DriverChoice[] = (users as any[]).filter(user => user.status === "active" && (allCompanyMembers as any[]).some(member => member.userId === user.id && member.companyId === me && member.status === "active" && member.roles?.includes("driver")))
      .map(user => ({ id: String(user.id), name: String(user.name || "Motorista"), photo: resolveDriverPhoto(user) })).sort((x, y) => x.name.localeCompare(y.name));
    const ownContracts = (contracts as any[]).filter(item => item.companyId === me && item.status === "active" && item.deleted !== true);
    return shell("Nova campanha", "Escolha a operação.", <NewCampaign me={me} drivers={drivers} ready={Boolean(allCompanyMembersReady)} contracts={ownContracts} sequences={sequences as any[]} trailers={trailers as any[]} vehicles={(vehicles as any[]).filter(item => item.companyId === me || !item.companyId)} jobs={jobs as any[]} members={allCompanyMembers as any[]} membersReady={Boolean(allCompanyMembersReady)} busy={busy} onBack={goList} onSend={async payload => {
      setBusy(true);
      try {
        // O trabalho entra na fila do motorista pelo mesmo comando de "Encaminhar trabalho": a empresa precisa estar preparada para ele (como em Parcerias).
        if ((ownCompany as any)?.operationalCommandVersion !== 1) await rewardService.prepareCompany(me);
        const sent = await rewardService.create(payload);
        if (sent.drivers) toast.success(`Trabalho encaminhado a ${sent.drivers} ${sent.drivers === 1 ? "motorista" : "motoristas"}.`);
        if (sent.failed?.length) toast.warning(`Não foi possível encaminhar a ${sent.failed.map(row => row.driverName).join(", ")}: ${sent.failed[0].message}`, { duration: 9000 });
        if (sent.drivers) goList(); else toast.error("Nenhum motorista recebeu o trabalho. Confira os avisos e tente de novo.");
      }
      catch (reason) { toast.error(rewardErrorMessage(reason, "Não foi possível enviar a campanha.")); } finally { setBusy(false); }
    }} />);
  }
  if (view.name === "payment") {
    const back = view.from;
    return shell("Pagamento", "Pague por Pix.", <PaymentDetail payment={payments.find(item => item.id === view.id)} backLabel={back === "transfers" ? "Transferências" : "Folha"} onBack={() => { setTab(back); goList(); }} />);
  }
  if (view.name === "edit") {
    const campaign = campaigns.find(item => item.id === view.id);
    if (!campaign) return shell("Editar campanha", "Altere as condições.", <><BackLink label="Pagamentos" onClick={goList} /><p className="b2p-empty">{ready ? "Esta campanha não está mais disponível." : "Carregando…"}</p></>);
    return shell("Editar campanha", "Os motoristas são avisados.", <EditCampaign campaign={campaign} busy={busy} onBack={() => setView({ name: "detail", id: campaign.id })} onSave={async patch => {
      setBusy(true);
      try { const done = await rewardService.update(campaign.id, { ...patch, expectedRevision: campaign.revision }); toast.success(`Campanha atualizada. ${done.notified} ${done.notified === 1 ? "motorista avisado" : "motoristas avisados"}.`); setView({ name: "detail", id: campaign.id }); }
      catch (reason) { toast.error(rewardErrorMessage(reason, "Não foi possível salvar as alterações.")); } finally { setBusy(false); }
    }} />);
  }
  if (view.name === "detail") {
    const campaign = campaigns.find(item => item.id === view.id);
    if (!campaign) return shell("Campanha", "Acompanhe os motoristas.", <><BackLink label="Pagamentos" onClick={goList} /><p className="b2p-empty">{ready ? "Esta campanha não está mais disponível." : "Carregando…"}</p></>);
    return shell("Campanha", "Acompanhe os motoristas.", <CampaignDetail campaign={campaign} offers={offers.filter(offer => offer.campaignId === campaign.id)} now={now} busy={busy} onBack={goList} onEdit={() => setView({ name: "edit", id: campaign.id })}
      onHide={async () => { if (!window.confirm("Excluir esta campanha do histórico? Os pagamentos já feitos continuam registrados.")) return; setBusy(true);
        try { await rewardService.hide(campaign.id); toast.message("Campanha excluída do histórico."); goList(); } catch (reason) { toast.error(rewardErrorMessage(reason, "Não foi possível excluir a campanha.")); } finally { setBusy(false); } }}
      onCancel={async () => { if (!window.confirm("Encerrar esta campanha? Ofertas sem resposta serão canceladas e novas viagens deixam de ser creditadas. O que já foi ganho continua registrado.")) return; setBusy(true);
        try { await rewardService.cancel(campaign.id); toast.message("Campanha encerrada."); } catch (reason) { toast.error(rewardErrorMessage(reason, "Não foi possível encerrar a campanha.")); } finally { setBusy(false); } }} />);
  }

  const live = campaigns.filter(item => { const state = campaignState(item, now); return state === "active" || state === "scheduled" || state === "capped"; });
  const accrued = live.reduce((sum, item) => sum + item.accruedCents, 0), budget = live.reduce((sum, item) => sum + item.budgetCents, 0);
  const toPay = payments.filter(item => item.status === "pending" || item.status === "contested").length;
  const tabs = <Tabs<Tab> label="Seções de pagamentos" value={tab} onChange={setTab} items={[{ id: "campaigns", label: "Campanhas" }, { id: "payroll", label: "Folha", count: toPay, warn: true }, { id: "transfers", label: "Transferências" }]} />;
  if (tab === "payroll") return shell("Pagamentos", "Pague os motoristas.", <>{tabs}<PayrollTab companyId={me} payments={payments} offers={offers} payDay={payDay} ready={paymentsReady} now={now} onOpen={id => setView({ name: "payment", id, from: "payroll" })} /></>);
  if (tab === "transfers") return shell("Pagamentos", "Pague os motoristas.", <>{tabs}<TransfersTab payments={payments} ready={paymentsReady} onOpen={id => setView({ name: "payment", id, from: "transfers" })} /></>);
  return shell("Pagamentos", "Pague os motoristas.", <>
    {tabs}
    {error ? <p className="b2p-alert" role="alert">Não foi possível atualizar agora.</p> : null}
    <section className="nvu-central-section b2p-sec">
      <div className="b2p-sec-head"><h2>Investimento</h2></div>
      <div className="b2p-sum"><div><small>Ganhos acumulados</small><b>{formatMoney(accrued)}</b><em>em andamento</em></div><div><small>Teto das campanhas</small><b>{formatMoney(budget)}</b><em>{budget ? `restam ${formatMoney(Math.max(0, budget - accrued))}` : "sem campanhas ativas"}</em></div></div>
      <Bar pct={budget ? accrued / budget * 100 : 0} warn={Boolean(budget) && accrued / budget > 0.9} />
      <div className="b2p-facts"><div><b>{live.length}</b><span>Campanhas</span></div><div><b>{live.reduce((sum, item) => sum + item.acceptedCount, 0)}</b><span>Motoristas</span></div><div><b>{live.reduce((sum, item) => sum + item.tripsCount, 0)}</b><span>Viagens</span></div></div>
    </section>
    <Section title="Campanhas" count={campaigns.length} action={<button type="button" className="b2p-btn" data-v="ghost" data-size="sm" onClick={() => setView({ name: "new" })}>+ Nova campanha</button>}>
      {campaigns.length ? campaigns.map(campaign => { const state = campaignState(campaign, now);
        return <button type="button" className="b2p-row" key={campaign.id} onClick={() => setView({ name: "detail", id: campaign.id })} aria-label={`${campaign.name}, ${CAMPAIGN_STATE_LABEL[state]}`}>
          <span className="nvu-central-avatar b2p-logo" style={{ display: "inline-grid", placeItems: "center", width: 44, height: 44 }}><Trophy size={20} aria-hidden="true" /></span>
          <span className="b2p-row-head"><strong className="b2p-row-title">{campaign.name}</strong><span className="b2p-pill b2p-row-status" data-tone={TONE[state]}><i aria-hidden="true" />{CAMPAIGN_STATE_LABEL[state]}</span></span>
          <span className="b2p-row-sub">{campaign.contractName && campaign.contractName !== campaign.name ? `${campaign.contractName} · ` : ""}{formatMoney(campaign.perTripCents)}/viagem · {termText(campaign)}</span>
          <span className="b2p-row-facts"><span>{formatMoney(campaign.accruedCents)}</span><span>{campaign.tripsCount} {campaign.tripsCount === 1 ? "viagem" : "viagens"}</span><span>{campaign.acceptedCount} de {campaign.driversCount} aceitaram</span></span>
          <ChevronRight className="b2p-row-chev" size={18} aria-hidden="true" />
        </button>; }) : <p className="b2p-empty">{ready ? "Nenhuma campanha ainda." : "Carregando campanhas…"}</p>}
    </Section>
  </>);
}

const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => <div className="b2p-field"><div className="b2p-label-row"><span className="b2p-label">{label}</span>{hint ? <span className="b2p-hint">{hint}</span> : null}</div>{children}</div>;
type ContractChoice = { id: string; name: string; deadlineDays?: number; totalDeliveries?: number; mode?: string; trailerId?: string | null; sequenceId?: string | null; sequenceOrder?: number | null };

/**
 * Nova campanha: 1) operação (seletor "Escolher operação"), 2) salário por viagem (o que a empresa paga), 3) meta de ganhos da operação (total de ganhos das viagens da operação; só uma meta do motorista, sem ligação com o salário),
 * motoristas e nome. As viagens e o prazo vêm da operação.
 */
function NewCampaign({ me, drivers, ready, contracts, sequences, trailers, vehicles, jobs, members, membersReady, busy, onBack, onSend }: { me: string; drivers: DriverChoice[]; contracts: ContractChoice[]; sequences: any[]; trailers: any[]; vehicles: any[]; jobs: any[]; members: any[]; membersReady: boolean; ready: boolean; busy: boolean; onBack: () => void; onSend: (payload: Parameters<typeof rewardService.create>[0]) => Promise<void> }) {
  const [contractId, setContractId] = useState(""), [pickerOpen, setPickerOpen] = useState(false), [vehicleId, setVehicleId] = useState(""), [vehiclePickerOpen, setVehiclePickerOpen] = useState(false), [perTrip, setPerTrip] = useState(""), [goalText, setGoalText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState(""), [error, setError] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  const contract = contracts.find(item => item.id === contractId), trips = Math.max(0, Math.floor(Number(contract?.totalDeliveries) || 0));
  const trailer = trailers.find(item => item.id === contract?.trailerId);
  const suggestion = contract ? `Campanha ${contract.name}`.slice(0, 60) : "", finalName = name.trim() || suggestion; // nome em branco usa a sugestão (sem texto pré-preenchido atrapalhando a digitação)
  const perTripCents = parseMoneyToCents(perTrip) || 0, goalCents = parseMoneyToCents(goalText) || 0, people = picked.length;
  // Resumo: total de viagens (motoristas × viagens da operação), estimativa da meta (soma da meta de cada motorista) e o salário total a pagar (viagens × salário por viagem).
  const totalTrips = people * trips, goalTotal = goalEstimate(goalCents, people), payroll = totalTrips * perTripCents;
  const sortedVehicles = useMemo(() => [...vehicles].sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: "base" })), [vehicles]);
  const usage = useMemo(() => { const map = new Map<string, number | null>(); for (const vehicle of vehicles) map.set(vehicle.id, membersReady ? countFleetAssetUsage({ jobs, members, contracts: contracts as any, assetId: vehicle.id, kind: "vehicle", companyId: me }) : null); return map; }, [vehicles, jobs, members, membersReady, contracts, me]);
  const vehicle = vehicles.find(item => item.id === vehicleId), vehicleUse = usage.get(vehicleId);
  const send = async () => {
    if (!contractId) return setError("Escolha a operação da campanha.");
    if (!vehicleId) return setError("Escolha o veículo do trabalho.");
    if (!trips) return setError("Essa operação não tem viagens. Escolha outra operação.");
    if (!perTripCents) return setError("Informe o salário por viagem.");
    if (!people) return setError(drivers.length ? "Escolha ao menos um motorista." : "A empresa não tem motoristas ativos.");
    if (finalName.length < 3) return setError("Dê um nome à campanha (ao menos 3 letras).");
    setError(""); await onSend({ companyId: me, contractId, vehicleId, name: finalName, perTripCents, goalCents, audience: "selected", driverIds: picked, requestId });
  };
  return <>
    <BackLink label="Pagamentos" onClick={onBack} />
    <section className="nvu-central-section b2p-sec"><div className="b2p-form b2p-compact">
      <Field label="1. Operação">
        {/* Prévia igual ao cartão da lista "Escolher operação"; tocar abre a lista para trocar */}
        <div className="nvu-assignment-theme"><button type="button" className={"nvu-assignment-choice nvu-assignment-contract-choice" + (contract ? " is-selected" : "")} onClick={() => setPickerOpen(true)} aria-haspopup="dialog" aria-label={contract ? `Alterar operação: ${contract.name}` : "Escolher operação"}>
          {contract ? <OperationCardBody name={contract.name} trailerName={trailer?.name || "Qualquer reboque"} totalDeliveries={contract.totalDeliveries} deadlineDays={contract.deadlineDays} />
            : <><span className="nvu-assignment-choice-symbol"><ClipboardList size={23} strokeWidth={1.65} /></span><span className="nvu-assignment-choice-copy"><strong>Escolher operação</strong></span></>}
          <ChevronRight size={18} aria-hidden="true" style={{ alignSelf: "center", justifySelf: "center" }} /></button></div>
        {!contracts.length ? <span className="b2p-note-box" data-tone="warn" role="note">Nenhuma operação ativa. Cadastre uma em Operações.</span> : null}
      </Field>
      <Field label="2. Veículo">
        {/* Igual ao "Veículo" de Encaminhar trabalho: tocar abre a lista da frota */}
        <div className="nvu-assignment-theme"><button type="button" className={"nvu-assignment-choice nvu-assignment-contract-choice" + (vehicle ? " is-selected" : "")} onClick={() => setVehiclePickerOpen(true)} aria-haspopup="dialog" aria-label={vehicle ? `Alterar veículo: ${vehicle.name}` : "Escolher veículo"}>
          <span className="nvu-assignment-choice-symbol"><KeyRound size={23} strokeWidth={1.65} /></span>
          <span className="nvu-assignment-choice-copy"><strong>{vehicle ? vehicle.name : "Escolher veículo"}</strong>{vehicle ? <small>{vehicleUse == null ? "Vínculos em consulta" : vehicleUse === 0 ? "Sem motoristas vinculados" : `Em uso por ${vehicleUse} motorista${vehicleUse === 1 ? "" : "s"}`}</small> : null}</span>
          <ChevronRight size={18} aria-hidden="true" style={{ alignSelf: "center", justifySelf: "center" }} /></button></div>
        {!vehicles.length ? <span className="b2p-note-box" data-tone="warn" role="note">Nenhum veículo na frota. Cadastre um em Frota.</span> : null}
      </Field>
      <Field label="3. Valor por viagem" hint="Sugerimos pagamentos em centavos."><div className="b2p-input"><span className="b2p-pre">R$</span><input inputMode="numeric" value={perTrip} onChange={event => setPerTrip(maskMoney(event.target.value))} /></div></Field>
      <Field label="4. Meta de ganhos" hint="Total de ganhos por operação."><div className="b2p-input"><span className="b2p-pre">R$</span><input inputMode="numeric" value={goalText} onChange={event => setGoalText(maskMoney(event.target.value))} /></div></Field>
      <DriverMultiSelect drivers={drivers} selected={picked} onChange={setPicked} disabled={busy} ready={ready} />
      <Field label="5. Nome da campanha"><div className="b2p-input"><input value={name} maxLength={60} placeholder={suggestion || "Ex.: Semana de Ouro"} onChange={event => setName(event.target.value)} /></div></Field>
      <div className="b2p-settle" aria-label="Resumo">
        <Row label="Total de viagens" value={totalTrips} />
        <Row label="Estimativa da meta" value={goalCents ? formatMoney(goalTotal) : "—"} />
        <Row label="Total a pagar" value={formatMoney(payroll)} strong />
      </div>
      {error ? <p className="b2p-alert" role="alert">{error}</p> : null}
      <div className="b2p-actions"><button type="button" className="b2p-btn" data-v="primary" disabled={busy} onClick={() => void send()}><Send size={16} aria-hidden="true" />{busy ? "Enviando…" : "Encaminhar aos motoristas"}</button></div>
    </div></section>
    <AssignJobAssetPicker kind="contract" open={pickerOpen} selectedId={contractId} contracts={contracts} sequences={sequences} trailers={trailers} onClose={() => setPickerOpen(false)} onSelect={setContractId} />
    <AssignJobAssetPicker kind="vehicle" open={vehiclePickerOpen} selectedId={vehicleId} vehicles={sortedVehicles} sequences={sequences} vehicleUsageById={usage} onClose={() => setVehiclePickerOpen(false)} onSelect={setVehicleId} />
  </>;
}

function CampaignDetail({ campaign, offers, now, busy, onBack, onEdit, onHide, onCancel }: { campaign: RewardCampaign; offers: RewardOffer[]; now: number; busy: boolean; onBack: () => void; onEdit: () => void; onHide: () => void; onCancel: () => void }) {
  const state = campaignState(campaign, now), open = campaign.status === "active" && now <= campaign.endMs && !campaign.capped;
  return <>
    <BackLink label="Pagamentos" onClick={onBack} />
    <section className="nvu-central-section b2p-sec">
      <div className="b2p-sec-head"><h2>{campaign.name}</h2><span className="b2p-pill" data-tone={TONE[state]}><i aria-hidden="true" />{CAMPAIGN_STATE_LABEL[state]}</span></div>
      <div className="b2p-sum"><div><small>Ganhos acumulados</small><b>{formatMoney(campaign.accruedCents)}</b><em>{campaign.tripsCount} {campaign.tripsCount === 1 ? "viagem" : "viagens"}</em></div><div><small>Teto</small><b>{formatMoney(campaign.budgetCents)}</b><em>restam {formatMoney(Math.max(0, campaign.budgetCents - campaign.accruedCents))}</em></div></div>
      <Bar pct={campaign.budgetCents ? campaign.accruedCents / campaign.budgetCents * 100 : 0} warn={campaign.capped} />
      <div className="b2p-settle">
        {campaign.contractName && campaign.contractName !== campaign.name ? <Row label="Operação" value={campaign.contractName} /> : null}{campaign.vehicleName ? <Row label="Veículo" value={campaign.vehicleName} /> : null}<Row label="Prazo" value={termText(campaign)} /><Row label="Valor por viagem" value={formatMoney(campaign.perTripCents)} />
        {campaign.maxTripsPerDriver ? <><Row label="Viagens da operação" value={campaign.maxTripsPerDriver} />{goalOf(campaign) ? <Row label="Meta da operação" value={formatMoney(goalOf(campaign))} /> : null}</> : null}
        {campaign.bonusCents ? <Row label="Bônus da meta" value={`${formatMoney(campaign.bonusCents)} em ${campaign.bonusGoalTrips} viagens`} /> : null}
        <Row label="Aceitaram" value={`${campaign.acceptedCount} de ${campaign.driversCount}`} />
      </div>
      {campaign.capped ? <p className="b2p-note-box" data-tone="warn">Teto atingido.</p> : null}
    </section>
    <Section title="Motoristas" count={offers.length}>
      {offers.length ? [...offers].sort((a, b) => b.totalCents - a.totalCents || a.driverName.localeCompare(b.driverName)).map((offer, index) => <div className="b2p-wrow" key={offer.id} style={index ? undefined : { borderTop: 0 }}>
        <DriverAvatar id={offer.driverId} name={offer.driverName} />
        <div><b>{offer.driverName}</b><small>{offer.status === "accepted" ? `${offer.trips}${campaign.maxTripsPerDriver ? ` de ${campaign.maxTripsPerDriver}` : ""} ${(campaign.maxTripsPerDriver || offer.trips) === 1 ? "viagem" : "viagens"}${goalOf(campaign) ? ` · operação ${formatMoney(offer.simCents)} de ${formatMoney(goalOf(campaign))}${offer.simCents >= goalOf(campaign) ? " ✓" : ""}` : ""}` : offerLabel(offer)}</small></div>
        <span className="b2p-amt"><strong data-k="x" style={offer.expired ? { textDecoration: "line-through", opacity: 0.7 } : undefined}>{offer.status === "accepted" ? formatMoney(offer.expired ? offer.lostCents : offer.totalCents) : "—"}</strong><span className="b2p-pill" data-tone={offer.expired ? "late" : offerCompleted(offer) && offer.status === "accepted" ? "good" : OFFER_TONE[offer.status]} style={{ padding: "1px 9px", fontSize: 11 }}><i aria-hidden="true" />{offer.expired ? "Prazo perdido" : offerCompleted(offer) && offer.status === "accepted" ? "Concluiu" : offerLabel(offer)}</span></span></div>)
        : <p className="b2p-empty">Carregando motoristas…</p>}
    </Section>
    {campaign.status === "cancelled" ? <div className="b2p-actions b2p-detail-actions"><button type="button" className="b2p-btn" data-v="danger" disabled={busy} onClick={onHide}>Excluir do histórico</button></div> : null}
    {open || campaign.status === "active" && campaign.endMs >= now ? <div className="b2p-actions b2p-detail-actions"><button type="button" className="b2p-btn" data-v="primary" disabled={busy} onClick={onEdit}><Pencil size={15} aria-hidden="true" />Editar campanha</button><button type="button" className="b2p-btn" data-v="danger" disabled={busy} onClick={onCancel}>Encerrar campanha</button></div> : null}
  </>;
}

/** Edita nome, valor por viagem e meta de uma campanha em andamento. Cada motorista é avisado do que mudou. */
function EditCampaign({ campaign, busy, onBack, onSave }: { campaign: RewardCampaign; busy: boolean; onBack: () => void; onSave: (patch: { name?: string; perTripCents?: number; goalCents?: number }) => Promise<void> }) {
  const [name, setName] = useState(campaign.name), [perTrip, setPerTrip] = useState(centsToMasked(campaign.perTripCents)), [goal, setGoal] = useState(centsToMasked(campaign.goalCents)), [error, setError] = useState("");
  const perTripCents = parseMoneyToCents(perTrip) || 0, goalCents = parseMoneyToCents(goal) || 0, trimmed = name.trim().replace(/\s+/g, " ");
  const patch = { ...(trimmed !== campaign.name ? { name: trimmed } : {}), ...(perTripCents !== campaign.perTripCents ? { perTripCents } : {}), ...(goalCents !== campaign.goalCents ? { goalCents } : {}) };
  const save = async () => {
    if (trimmed.length < 3) return setError("Dê um nome à campanha (ao menos 3 letras).");
    if (!perTripCents) return setError("Informe o valor por viagem.");
    if (!Object.keys(patch).length) return setError("Nenhuma alteração para salvar.");
    setError(""); await onSave(patch);
  };
  return <>
    <BackLink label="Campanha" onClick={onBack} />
    <section className="nvu-central-section b2p-sec"><div className="b2p-form b2p-compact">
      <Field label="Nome da campanha"><div className="b2p-input"><input value={name} maxLength={60} onChange={event => setName(event.target.value)} /></div></Field>
      <Field label="Valor por viagem"><div className="b2p-input"><span className="b2p-pre">R$</span><input inputMode="numeric" value={perTrip} onChange={event => setPerTrip(maskMoney(event.target.value))} /></div></Field>
      <Field label="Meta de ganhos"><div className="b2p-input"><span className="b2p-pre">R$</span><input inputMode="numeric" value={goal} onChange={event => setGoal(maskMoney(event.target.value))} /></div></Field>
      <p className="b2p-hint">Vale para todos os motoristas, inclusive as viagens já feitas. O valor por viagem não muda depois que há pagamento na folha.</p>
      {error ? <p className="b2p-alert" role="alert">{error}</p> : null}
      <div className="b2p-actions"><button type="button" className="b2p-btn" data-v="primary" disabled={busy} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar e avisar motoristas"}</button></div>
    </div></section>
  </>;
}
