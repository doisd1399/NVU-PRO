import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, Send, Trophy } from "lucide-react";
import { useOperationalStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { useCompanyRewards } from "../../hooks/useRewards";
import { rewardService } from "../../services/rewardService";
import { resolveSimulatorDisplayLabel } from "../../lib/simulatorOptions";
import { formatMoney, maskMoney, parseMoneyToCents } from "../../lib/partnerships";
import { CAMPAIGN_STATE_LABEL, OFFER_STATE_LABEL, campaignState, estimateMaxCost, periodText, rewardErrorMessage, type CampaignState, type RewardCampaign, type RewardOffer } from "../../lib/rewards";
import { BackLink, PageHeader, Section } from "../../components/partnerships/shared";
import "../../components/partnerships/Partnerships.css";

const TONE: Record<CampaignState, string> = { active: "good", scheduled: "warn", ended: "muted", cancelled: "muted", capped: "late" };
const OFFER_TONE: Record<string, string> = { pending: "warn", accepted: "good", declined: "muted", cancelled: "muted" };
const initials = (name: string) => name.split(/\s+/).map(word => word[0]).slice(0, 2).join("").toUpperCase();
const Bar = ({ pct, warn }: { pct: number; warn?: boolean }) => <div className="nvu-central-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><span style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: warn ? "var(--central-warning)" : undefined }} /></div>;
const Row = ({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) => <div data-total={strong ? "1" : undefined}><span>{label}</span><b>{value}</b></div>;
const dateInput = (offsetDays = 0) => { const d = new Date(Date.now() + offsetDays * 86_400_000); return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); };

type View = { name: "list" } | { name: "new" } | { name: "detail"; id: string };

/** Recompensas (Central de gestão): campanhas de ganho por viagem da empresa para os motoristas dela. Fase 1: criar, enviar ofertas e acompanhar. */
export default function Rewards() {
  const { activeCompanyId, companies, allCompanies, allCompanyMembers } = useCompanyStore();
  const { users, simulators } = useOperationalStore();
  const me = activeCompanyId || "";
  const { campaigns, offers, ready, error } = useCompanyRewards(me);
  const ownCompany = companies.find(item => item.id === me) || allCompanies.find(item => item.id === me);
  const [view, setView] = useState<View>({ name: "list" });
  const [busy, setBusy] = useState(false);
  const now = useMemo(() => Date.now(), [campaigns, view]);
  useEffect(() => { window.scrollTo?.({ top: 0 }); }, [view.name]);
  const header = (title: string, description: string) => <PageHeader title={title} description={description} companyName={String(ownCompany?.companyName || ownCompany?.fleetName || "")} simulator={ownCompany ? resolveSimulatorDisplayLabel(ownCompany, simulators as any[], allCompanies) : ""} />;
  const shell = (title: string, description: string, children: React.ReactNode) => <div className="nvu-central-page nvu-b2p"><div className="nvu-central-stack">{header(title, description)}{children}</div></div>;
  if (!me) return shell("Recompensas", "Campanhas de ganho por viagem para os motoristas.", <p className="b2p-empty">Selecione uma empresa para ver as recompensas.</p>);
  const goList = () => setView({ name: "list" });

  if (view.name === "new") {
    const drivers = (allCompanyMembers as any[]).filter(member => member.companyId === me && member.status === "active").map(member => ({ id: String(member.userId), name: String((users as any[]).find(user => user.id === member.userId)?.name || "Motorista") }))
      .filter((driver, index, list) => list.findIndex(other => other.id === driver.id) === index);
    return shell("Nova campanha", "Defina a recompensa e quem participa.", <NewCampaign me={me} drivers={drivers} busy={busy} onBack={goList} onSend={async payload => {
      setBusy(true);
      try { const sent = await rewardService.create(payload); toast.success(`Oferta enviada a ${sent.drivers} ${sent.drivers === 1 ? "motorista" : "motoristas"}.`); goList(); }
      catch (reason) { toast.error(rewardErrorMessage(reason, "Não foi possível enviar a campanha.")); } finally { setBusy(false); }
    }} />);
  }
  if (view.name === "detail") {
    const campaign = campaigns.find(item => item.id === view.id);
    if (!campaign) return shell("Campanha", "Acompanhe o ganho dos motoristas.", <><BackLink label="Recompensas" onClick={goList} /><p className="b2p-empty">{ready ? "Esta campanha não está mais disponível." : "Carregando…"}</p></>);
    return shell("Campanha", "Acompanhe o ganho dos motoristas.", <CampaignDetail campaign={campaign} offers={offers.filter(offer => offer.campaignId === campaign.id)} now={now} busy={busy} onBack={goList}
      onCancel={async () => { if (!window.confirm("Encerrar esta campanha? Ofertas sem resposta serão canceladas e novas viagens deixam de ser creditadas. O que já foi ganho continua registrado.")) return; setBusy(true);
        try { await rewardService.cancel(campaign.id); toast.message("Campanha encerrada."); } catch (reason) { toast.error(rewardErrorMessage(reason, "Não foi possível encerrar a campanha.")); } finally { setBusy(false); } }} />);
  }

  const live = campaigns.filter(item => { const state = campaignState(item, now); return state === "active" || state === "scheduled" || state === "capped"; });
  const accrued = live.reduce((sum, item) => sum + item.accruedCents, 0), budget = live.reduce((sum, item) => sum + item.budgetCents, 0);
  return shell("Recompensas", "Campanhas de ganho por viagem para os motoristas.", <>
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
          <span className="b2p-row-sub">{periodText(campaign.startMs, campaign.endMs)} · {formatMoney(campaign.perTripCents)} por viagem</span>
          <span className="b2p-row-facts"><span>{formatMoney(campaign.accruedCents)}</span><span>{campaign.tripsCount} {campaign.tripsCount === 1 ? "viagem" : "viagens"}</span><span>{campaign.acceptedCount} de {campaign.driversCount} aceitaram</span></span>
          <ChevronRight className="b2p-row-chev" size={18} aria-hidden="true" />
        </button>; }) : <p className="b2p-empty">{ready ? "Nenhuma campanha ainda. Toque em + Nova campanha." : "Carregando campanhas…"}</p>}
      <p className="b2p-hint">Quando o ganho chega ao teto, a campanha para de creditar viagens e você é avisado.</p>
    </Section>
  </>);
}

function NewCampaign({ me, drivers, busy, onBack, onSend }: { me: string; drivers: { id: string; name: string }[]; busy: boolean; onBack: () => void; onSend: (payload: Parameters<typeof rewardService.create>[0]) => Promise<void> }) {
  const [name, setName] = useState(""), [start, setStart] = useState(dateInput()), [end, setEnd] = useState(dateInput(6)), [audience, setAudience] = useState<"all" | "selected">("all");
  const [picked, setPicked] = useState<string[]>([]), [perTrip, setPerTrip] = useState(""), [bonus, setBonus] = useState(""), [goal, setGoal] = useState(""), [budget, setBudget] = useState(""), [expected, setExpected] = useState(""), [error, setError] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  const perTripCents = parseMoneyToCents(perTrip) || 0, bonusCents = parseMoneyToCents(bonus) || 0, goalTrips = Math.max(0, Math.floor(Number(goal) || 0)), budgetCents = parseMoneyToCents(budget) || 0;
  const people = audience === "all" ? drivers.length : picked.length, trips = Math.max(0, Math.floor(Number(expected) || goalTrips || 0));
  const cost = estimateMaxCost({ perTripCents, bonusCents, bonusGoalTrips: goalTrips }, people, trips);
  const send = async () => {
    if (name.trim().length < 3) return setError("Dê um nome à campanha (ao menos 3 letras).");
    if (!perTripCents) return setError("Informe o valor por viagem.");
    if (bonusCents && !goalTrips) return setError("Informe a meta de viagens para o bônus.");
    if (!budgetCents || budgetCents < perTripCents) return setError("Informe o teto de investimento (ao menos o valor de uma viagem).");
    if (!people) return setError(audience === "all" ? "A empresa não tem motoristas ativos." : "Escolha ao menos um motorista.");
    if (end < start) return setError("O fim da campanha não pode ser antes do início.");
    setError(""); await onSend({ companyId: me, name: name.trim(), startDate: start, endDate: end, perTripCents, bonusCents, bonusGoalTrips: bonusCents ? goalTrips : 0, budgetCents, audience, driverIds: audience === "selected" ? picked : [], requestId });
  };
  const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => <div className="b2p-field"><span className="b2p-label">{label}</span>{children}{hint ? <span className="b2p-hint">{hint}</span> : null}</div>;
  const money = (value: string, set: (v: string) => void, placeholder: string) => <div className="b2p-input"><span className="b2p-pre">R$</span><input inputMode="numeric" value={value} placeholder={placeholder} onChange={event => set(maskMoney(event.target.value))} /></div>;
  return <>
    <BackLink label="Recompensas" onClick={onBack} />
    <section className="nvu-central-section b2p-sec"><div className="b2p-form">
      <Field label="Nome da campanha"><div className="b2p-input"><input value={name} maxLength={60} placeholder="Ex.: Semana de Ouro" onChange={event => setName(event.target.value)} /></div></Field>
      <div className="b2p-grid2"><Field label="Início"><div className="b2p-input"><input type="date" value={start} onChange={event => setStart(event.target.value)} /></div></Field><Field label="Fim"><div className="b2p-input"><input type="date" value={end} onChange={event => setEnd(event.target.value)} /></div></Field></div>
      <Field label="Quem participa"><div className="b2p-seg" role="group" aria-label="Quem participa">{(["all", "selected"] as const).map(item => <button type="button" key={item} data-on={audience === item ? "1" : "0"} aria-pressed={audience === item} onClick={() => setAudience(item)}>{item === "all" ? `Todos (${drivers.length})` : "Escolher"}</button>)}</div></Field>
      {audience === "selected" ? <div className="b2p-picklist" role="group" aria-label="Motoristas">{drivers.map(driver => <button type="button" className="b2p-pick" key={driver.id} data-on={picked.includes(driver.id) ? "1" : "0"} aria-pressed={picked.includes(driver.id)} onClick={() => setPicked(list => list.includes(driver.id) ? list.filter(item => item !== driver.id) : [...list, driver.id])}>
        <span className="nvu-central-avatar" style={{ display: "inline-grid", placeItems: "center", width: 34, height: 34, fontWeight: 700 }}>{initials(driver.name)}</span><span><b>{driver.name}</b></span><span className="b2p-radio">{picked.includes(driver.id) ? "✓" : ""}</span></button>)}</div> : null}
      <div className="b2p-grid2"><Field label="Valor por viagem">{money(perTrip, setPerTrip, "25,00")}</Field><Field label="Bônus da meta (opcional)">{money(bonus, setBonus, "200,00")}</Field></div>
      <Field label="Meta para o bônus" hint="O bônus é pago a quem completar esta quantidade de viagens no período."><div className="b2p-input"><input inputMode="numeric" value={goal} placeholder="20" onChange={event => setGoal(event.target.value.replace(/\D/g, "").slice(0, 4))} /><span className="b2p-pre">viagens</span></div></Field>
      <Field label="Teto de investimento da campanha">{money(budget, setBudget, "6.000,00")}</Field>
      <Field label="Viagens por motorista (estimativa)" hint="Só para o simulador abaixo; não limita ninguém."><div className="b2p-input"><input inputMode="numeric" value={expected} placeholder={goalTrips ? String(goalTrips) : "20"} onChange={event => setExpected(event.target.value.replace(/\D/g, "").slice(0, 4))} /></div></Field>
      <div className="b2p-settle">
        <Row label="Motoristas" value={people} /><Row label={`Ganho por viagens (${trips} cada)`} value={formatMoney(cost.tripsCents)} /><Row label={`Bônus de meta (${bonusCents && trips >= goalTrips ? people : 0} × ${formatMoney(bonusCents)})`} value={formatMoney(cost.bonusCents)} />
        <Row label="Custo máximo estimado" value={formatMoney(cost.totalCents)} strong />
      </div>
      {budgetCents ? cost.totalCents <= budgetCents
        ? <p className="b2p-note-box">Dentro do teto de <b>{formatMoney(budgetCents)}</b>. Você só paga o que os motoristas realmente fizerem.</p>
        : <p className="b2p-note-box" data-tone="warn">A estimativa passa do teto de <b>{formatMoney(budgetCents)}</b>: a campanha para de creditar quando o teto for atingido.</p> : null}
      <p className="b2p-hint">Cada motorista recebe a oferta e <b>aceita ou recusa</b>. Só contam viagens confirmadas depois do aceite e dentro do período. O pagamento é feito por você, por Pix (nesta fase o NVU calcula e registra o ganho).</p>
      {error ? <p className="b2p-alert" role="alert">{error}</p> : null}
      <div className="b2p-actions"><button type="button" className="b2p-btn" data-v="primary" disabled={busy} onClick={() => void send()}><Send size={16} aria-hidden="true" />{busy ? "Enviando…" : "Enviar oferta aos motoristas"}</button></div>
    </div></section>
  </>;
}

function CampaignDetail({ campaign, offers, now, busy, onBack, onCancel }: { campaign: RewardCampaign; offers: RewardOffer[]; now: number; busy: boolean; onBack: () => void; onCancel: () => void }) {
  const state = campaignState(campaign, now), open = campaign.status === "active" && now <= campaign.endMs && !campaign.capped;
  return <>
    <BackLink label="Recompensas" onClick={onBack} />
    <section className="nvu-central-section b2p-sec">
      <div className="b2p-sec-head"><h2>{campaign.name}</h2><span className="b2p-pill" data-tone={TONE[state]}><i aria-hidden="true" />{CAMPAIGN_STATE_LABEL[state]}</span></div>
      <div className="b2p-sum"><div><small>Ganhos acumulados</small><b>{formatMoney(campaign.accruedCents)}</b><em>{campaign.tripsCount} {campaign.tripsCount === 1 ? "viagem" : "viagens"}</em></div><div><small>Teto</small><b>{formatMoney(campaign.budgetCents)}</b><em>restam {formatMoney(Math.max(0, campaign.budgetCents - campaign.accruedCents))}</em></div></div>
      <Bar pct={campaign.budgetCents ? campaign.accruedCents / campaign.budgetCents * 100 : 0} warn={campaign.capped} />
      <div className="b2p-settle">
        <Row label="Período" value={periodText(campaign.startMs, campaign.endMs)} /><Row label="Ganho por viagem" value={formatMoney(campaign.perTripCents)} />
        {campaign.bonusCents ? <Row label="Bônus da meta" value={`${formatMoney(campaign.bonusCents)} em ${campaign.bonusGoalTrips} viagens`} /> : null}
        <Row label="Aceitaram" value={`${campaign.acceptedCount} de ${campaign.driversCount}`} />
      </div>
      {campaign.capped ? <p className="b2p-note-box" data-tone="warn">O teto foi atingido: novas viagens não são mais creditadas.</p> : null}
    </section>
    <Section title="Motoristas" count={offers.length}>
      {offers.length ? [...offers].sort((a, b) => b.totalCents - a.totalCents || a.driverName.localeCompare(b.driverName)).map((offer, index) => <div className="b2p-wrow" key={offer.id} style={index ? undefined : { borderTop: 0 }}>
        <span className="nvu-central-avatar" style={{ display: "inline-grid", placeItems: "center", width: 36, height: 36, fontWeight: 700 }}>{initials(offer.driverName)}</span>
        <div><b>{offer.driverName}</b><small>{offer.status === "accepted" ? `${offer.trips} ${offer.trips === 1 ? "viagem" : "viagens"}${offer.goalReached ? " · bônus de meta" : ""}` : OFFER_STATE_LABEL[offer.status]}</small></div>
        <span className="b2p-amt"><strong data-k="x">{offer.status === "accepted" ? formatMoney(offer.totalCents) : "—"}</strong><span className="b2p-pill" data-tone={OFFER_TONE[offer.status]} style={{ padding: "1px 9px", fontSize: 11 }}><i aria-hidden="true" />{OFFER_STATE_LABEL[offer.status]}</span></span></div>)
        : <p className="b2p-empty">Carregando motoristas…</p>}
      <p className="b2p-hint">Contam só as viagens confirmadas pelo servidor, depois do aceite do motorista e dentro do período.</p>
    </Section>
    {open || campaign.status === "active" && campaign.endMs >= now ? <div className="b2p-actions b2p-detail-actions"><button type="button" className="b2p-btn" data-v="danger" disabled={busy} onClick={onCancel}>Encerrar campanha</button></div> : null}
  </>;
}
