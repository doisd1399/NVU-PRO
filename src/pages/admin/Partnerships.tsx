import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronRight } from "lucide-react";
import { useOperationalStore, useSessionStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { usePartnerships } from "../../hooks/usePartnerships";
import { useVisibleDriverIdentity } from "../../hooks/useVisibleDriverIdentity";
import { partnershipService } from "../../services/partnershipService";
import { partnerCandidates } from "../../lib/partnerCandidates";
import { markPartnershipsSeen } from "../../lib/partnershipSeen";
import { resolveSimulatorDisplayLabel } from "../../lib/simulatorOptions";
import { partnershipErrorMessage, roleIn, sectionFor, walletEntries, walletTotals, type Partnership, type PixType, type WalletEntry } from "../../lib/partnerships";
import { NewOfferScreen } from "../../components/partnerships/NewOfferScreen";
import { DesignateScreen } from "../../components/partnerships/DesignateScreen";
import { Detail, OfferDetail, Results } from "../../components/partnerships/DetailScreens";
import { HistoryRow, OfferRow, PartnershipOperationCard, SummaryBody } from "../../components/partnerships/PanelParts";
import { PartnershipInfoSheet } from "../../components/partnerships/PartnershipInfoSheet";
import { WalletView } from "../../components/partnerships/WalletScreen";
import { LogoContext, PageHeader, Section, Tabs } from "../../components/partnerships/shared";

type View = { name: "list" } | { name: "new"; partnerId?: string; from?: Partnership } | { name: "offer" | "designate" | "detail" | "results"; id: string };
type Tab = "painel" | "ofertas" | "carteira" | "historico";
type OfferTab = "recebidas" | "enviadas";

/**
 * Parcerias B2P (Central de gestão): painel de gestão de parcerias no estilo da Central. A lista de empresas parceiras vem do
 * catálogo PÚBLICO: só as ATIVAS e do MESMO simulador da empresa logada. As telas ficam em `components/partnerships`.
 */
export default function Partnerships() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeCompanyId, companies, allCompanies, loadCompanyCatalog, companyCatalogLoaded, companyCatalogAttempted, allCompanyMembers, allCompanyMembersReady } = useCompanyStore();
  const { vehicles, trailers, users, simulators, jobs, contracts, sequences } = useOperationalStore();
  const { currentUser } = useSessionStore();
  const { rows, ready, error } = usePartnerships(activeCompanyId);
  const me = activeCompanyId || "";
  const viewerId = String(currentUser?.id || "");
  const ownCompany = companies.find(item => item.id === me) || allCompanies.find(item => item.id === me);
  const [view, setView] = useState<View>({ name: "list" });
  const [tab, setTab] = useState<Tab>("painel");
  const [offerTab, setOfferTab] = useState<OfferTab>("recebidas");
  const [busy, setBusy] = useState(false);
  const [infoId, setInfoId] = useState("");
  // Aceite recusado porque a empresa ainda não usa a confirmação operacional: o app oferece preparar e aceitar.
  const [notReady, setNotReady] = useState("");
  // Mesmo relógio da Central: o "Tempo restante" dos cards anda de minuto em minuto.
  const [tick, setTick] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setTick(value => value + 1), 60_000); return () => window.clearInterval(timer); }, []);
  const now = useMemo(() => Date.now(), [rows, view, tick]);
  const openedFromState = useRef(false);
  useEffect(() => { void loadCompanyCatalog().catch(() => []); }, [loadCompanyCatalog]);
  useEffect(() => { window.scrollTo?.({ top: 0 }); }, [view.name]);
  // Abrir a lista zera o indicador de novidades da Central (ofertas para responder continuam aparecendo até serem respondidas).
  useEffect(() => { if (view.name === "list" && ready && me && viewerId) markPartnershipsSeen(viewerId, me); }, [view.name, ready, rows, me, viewerId]);
  useEffect(() => {
    const state = location.state as { openId?: string; view?: "detail" | "results" } | null;
    const id = state?.openId;
    if (id && !openedFromState.current && rows.some(row => row.id === id)) { openedFromState.current = true; setView({ name: state?.view === "results" ? "results" : "detail", id }); }
  }, [location.state, rows]);

  const byId = useMemo(() => new Map(rows.map(row => [row.id, row])), [rows]);
  const logoById = useMemo(() => new Map(allCompanies.map(item => [item.id, String(item.logoUrl || item.logoURL || item.companyLogoURL || "")])), [allCompanies]);
  const driverIdentities = useVisibleDriverIdentity(rows.map(row => row.driverId || ""), Boolean(me));
  const logoValue = useMemo(() => ({ logo: (companyId: string) => logoById.get(companyId) || "", viewerId, driverPhoto: (driverId: string) => driverIdentities[driverId]?.profilePhotoURL || "" }), [logoById, viewerId, driverIdentities]);
  const candidates = useMemo(() => partnerCandidates({ ownCompany, allCompanies, simulators: simulators as any[], history: rows }), [ownCompany, allCompanies, simulators, rows]);
  const catalog = { loaded: companyCatalogLoaded, failed: companyCatalogAttempted && !companyCatalogLoaded, retry: () => void loadCompanyCatalog(true).catch(() => []) };

  const groups = useMemo(() => {
    const out: Record<string, Partnership[]> = { action: [], running: [], waiting: [], done: [] };
    rows.forEach(row => { const key = sectionFor(row, me); if (out[key]) out[key].push(row); });
    return out;
  }, [rows, me]);
  const received = rows.filter(row => roleIn(row, me) === "executor" && (row.status === "pending" || (row.status === "accepted" && !row.jobId)));
  const sent = rows.filter(row => roleIn(row, me) === "contractor" && row.status === "pending");
  const history = rows.filter(row => ["completed", "declined", "cancelled"].includes(row.status));
  const entries = useMemo(() => walletEntries(rows, me), [rows, me]);
  const totals = useMemo(() => walletTotals(entries), [entries]);
  const toAnswer = groups.action.length;

  const run = async (task: () => Promise<void>, failure: string) => {
    if (busy) return;
    setBusy(true);
    try { await task(); } catch (reason) { toast.error(partnershipErrorMessage(reason, failure)); } finally { setBusy(false); }
  };
  const respond = (p: Partnership, decision: "accept" | "decline", prepare = false) => run(async () => {
    if (prepare) await partnershipService.prepareCompany(me);
    try { await partnershipService.respond(p.id, decision); }
    catch (reason) { if (decision === "accept" && /confirmação operacional/i.test(String((reason as { message?: string })?.message || ""))) { setNotReady(p.id); return; } throw reason; }
    setNotReady("");
    if (decision === "accept") { toast.success("Oferta aceita. Agora designe o motorista e escolha o veículo."); setView({ name: "designate", id: p.id }); }
    else { toast.message("Oferta recusada."); setView({ name: "list" }); }
  }, prepare ? "Não foi possível preparar a empresa." : "Não foi possível responder a oferta.");
  const cancel = (p: Partnership) => run(async () => { await partnershipService.cancel(p.id); toast.message("Oferta cancelada."); setView({ name: "list" }); }, "Não foi possível cancelar a oferta.");
  const hide = (p: Partnership) => { if (window.confirm(`Excluir "${p.operationName}" da sua lista? Esta operação ${p.status === "declined" ? "recusada" : "cancelada"} não poderá ser recuperada.`)) void run(async () => { await partnershipService.hide(p.id, me); toast.message("Operação excluída."); }, "Não foi possível excluir a operação."); };
  const savePix = (p: Partnership) => (type: PixType, key: string) => run(async () => { await partnershipService.setPix(p.id, type, key); toast.success("Chave Pix salva."); }, "Não foi possível salvar a chave Pix.");
  const pay = (partnershipId: string, action: "paid" | "received") => run(async () => {
    await partnershipService.settle(partnershipId, action);
    toast.success(action === "paid" ? "Pagamento registrado. A parceira será avisada." : "Recebimento confirmado.");
  }, "Não foi possível registrar o pagamento.");
  const payEntry = (entry: WalletEntry) => void pay(entry.partnershipId, entry.kind === "investimento" ? "paid" : "received");

  const simulatorLabel = ownCompany ? resolveSimulatorDisplayLabel(ownCompany, simulators as any[], allCompanies) : "";
  const infoRow = infoId ? byId.get(infoId) : undefined;
  const companyName = String(ownCompany?.companyName || ownCompany?.fleetName || "");
  const company = { name: companyName, simulator: simulatorLabel };
  // Motorista da própria empresa: abre o perfil, como no card de Trabalhos ativos (o motorista de outra empresa não abre).
  const openDriver = (p: Partnership) => p.driverId && roleIn(p, me) === "executor"
    ? () => navigate(`/admin/driver/${p.driverId}/perfil`, { state: { returnUrl: "/admin/parcerias", companyId: me } }) : undefined;
  const TITLES: Record<string, [string, string]> = {
    list: ["Parcerias B2P", "Ofertas, operações e pagamentos entre empresas."], new: ["Nova oferta", "Proponha uma operação a uma empresa parceira."],
    offer: ["Oferta recebida", "Analise as condições e responda."], designate: ["Designar trabalho", "Escolha o motorista e o veículo da sua empresa."],
    detail: ["Parceria", "Acompanhe a operação e o pagamento."], results: ["Resultados", "Ganhos e ritmo da operação."],
  };
  const header = <PageHeader title={TITLES[view.name][0]} description={TITLES[view.name][1]} companyName={companyName} simulator={simulatorLabel} />;
  const shell = (children: React.ReactNode) => <LogoContext.Provider value={logoValue}><div className="nvu-central-page nvu-b2p"><div className="nvu-central-stack">{header}{children}</div>{infoRow ? <PartnershipInfoSheet p={infoRow} me={me} driverPhoto={infoRow.driverId ? driverIdentities[infoRow.driverId]?.profilePhotoURL : undefined} onResults={() => setView({ name: "results", id: infoRow.id })} onRepeat={() => setView({ name: "new", from: infoRow })} onClose={() => setInfoId("")} /> : null}</div></LogoContext.Provider>;
  if (!me) return shell(<p className="b2p-empty">Selecione uma empresa para ver as parcerias.</p>);
  const current = "id" in view ? byId.get(view.id) : undefined;
  const goList = () => setView({ name: "list" });

  if (view.name === "new") return shell(<NewOfferScreen key={view.from?.id || view.partnerId || "new"} me={me} ownCompany={ownCompany} candidates={candidates} catalog={catalog} initial={view} rows={rows}
    trailers={trailers as any[]} simulators={simulators as any[]} onBack={goList}
    onSent={(isReady, partnerName) => {
      if (isReady) toast.success("Oferta enviada."); else toast.message(`Oferta enviada. ${partnerName} ainda precisa preparar a confirmação operacional da empresa (Operações) para poder aceitar.`, { duration: 9000 });
      setTab("ofertas"); setOfferTab("enviadas"); goList();
    }} />);
  if ("id" in view && !current) return shell(<><button type="button" className="b2p-back" onClick={goList}>Voltar</button>{ready ? <p className="b2p-empty">Esta parceria não está mais disponível.</p> : <p className="b2p-empty">Carregando…</p>}</>);
  if (view.name === "offer" && current) return shell(<OfferDetail p={current} busy={busy} notReady={notReady === current.id} onBack={goList} onAccept={() => respond(current, "accept")} onPrepare={() => respond(current, "accept", true)} onDecline={() => respond(current, "decline")} />);
  if (view.name === "designate" && current) return shell(<DesignateScreen p={current} me={me} ownCompany={ownCompany} users={users as any[]} members={allCompanyMembers as any[]} membersReady={Boolean(allCompanyMembersReady)}
    vehicles={vehicles as any[]} sequences={sequences as any[]} jobs={jobs as any[]} contracts={contracts as any[]}
    onBack={goList} onDone={() => { toast.success("Motorista designado. A operação já aparece para ele."); setView({ name: "detail", id: current.id }); }} />);
  if (view.name === "results" && current) return shell(<Results p={current} me={me} onBack={() => setView({ name: "detail", id: current.id })} />);
  if (view.name === "detail" && current) return shell(<Detail p={current} me={me} now={now} busy={busy} onBack={goList}
    onDesignate={() => setView({ name: "designate", id: current.id })} onCancel={() => cancel(current)} onPay={action => void pay(current.id, action)} onInfo={() => setInfoId(current.id)}
    company={company} onDriver={openDriver(current)} onSavePix={savePix(current)} />);

  const open = (id: string, name: "offer" | "detail" | "designate" = "detail") => setView({ name, id });
  const openOffer = (p: Partnership) => open(p.id, p.status === "pending" && roleIn(p, me) === "executor" ? "offer" : p.status === "accepted" && !p.jobId && roleIn(p, me) === "executor" ? "designate" : "detail");
  const startNew = () => setView({ name: "new" });
  const newButton = <button type="button" className="b2p-btn" data-v="ghost" data-size="sm" onClick={startNew}>+ Nova oferta</button>;
  const offerList = offerTab === "recebidas" ? received : sent;

  return shell(<>
    {error ? <p className="b2p-alert" role="alert">Não foi possível atualizar as parcerias agora. Os dados podem estar desatualizados.</p> : null}
    <Tabs<Tab> label="Seções de parcerias" value={tab} onChange={setTab} items={[
      { id: "painel", label: "Painel" }, { id: "ofertas", label: "Ofertas", count: toAnswer, warn: true }, { id: "carteira", label: "Carteira" }, { id: "historico", label: "Histórico" }]} />

    {tab === "painel" ? <>
      <section className="nvu-central-section b2p-sec"><SummaryBody totals={totals} active={groups.running.length} toAnswer={toAnswer} done={groups.done.length} /></section>
      <Section title="Parcerias ativas" count={groups.running.length} action={newButton}>
        {groups.running.length ? <div className="nvu-central-job-list b2p-oplist">{groups.running.map(p => <PartnershipOperationCard key={p.id} p={p} me={me} now={now} company={company} onInfo={() => setInfoId(p.id)} onDriver={openDriver(p)} />)}</div>
          : <p className="b2p-empty">{ready ? "Nenhuma parceria ativa no momento." : "Carregando parcerias…"}</p>}
        <div className="b2p-linkrow"><button type="button" className="b2p-link" onClick={() => setTab("ofertas")}>Ver ofertas<ChevronRight size={18} aria-hidden="true" /></button></div>
      </Section>
    </> : null}

    {tab === "ofertas" ? <Section title="Ofertas" action={newButton}>
      <div className="b2p-subtabs" role="tablist" aria-label="Ofertas">
        <button type="button" role="tab" aria-selected={offerTab === "recebidas"} data-on={offerTab === "recebidas" ? "1" : "0"} onClick={() => setOfferTab("recebidas")}>Recebidas ({received.length})</button>
        <button type="button" role="tab" aria-selected={offerTab === "enviadas"} data-on={offerTab === "enviadas" ? "1" : "0"} onClick={() => setOfferTab("enviadas")}>Enviadas ({sent.length})</button>
      </div>
      {offerList.length ? (offerTab === "recebidas"
        ? [["Aguardando sua resposta", offerList.filter(p => p.status === "pending")], ["Aceitas — falta designar o trabalho", offerList.filter(p => p.status !== "pending")]] as [string, Partnership[]][]
        : [["Aguardando resposta da parceira", offerList]] as [string, Partnership[]][]).filter(([, list]) => list.length).map(([label, list]) =>
        <div key={label} className="b2p-group"><h3 className="b2p-group-h">{label}<small>{list.length}</small></h3>
          <div className="b2p-rows">{list.map(p => <OfferRow key={p.id} p={p} me={me} now={now} onOpen={() => openOffer(p)} />)}</div></div>)
        : <p className="b2p-empty">{offerTab === "recebidas" ? "Nenhuma oferta recebida." : "Nenhuma oferta enviada aguardando resposta."}</p>}
    </Section> : null}

    {tab === "carteira" ? <Section title="Carteira de parcerias"><WalletView entries={entries} totals={totals} busy={busy} onOpen={id => open(id)} onPay={payEntry} /></Section> : null}

    {tab === "historico" ? <Section title="Histórico" count={history.length}>
      {history.length ? history.map(p => <HistoryRow key={p.id} p={p} me={me} busy={busy} onOpen={() => open(p.id)} onDelete={() => hide(p)} />) : <p className="b2p-empty">Nenhuma parceria concluída, recusada ou cancelada.</p>}
    </Section> : null}
  </>);
}
