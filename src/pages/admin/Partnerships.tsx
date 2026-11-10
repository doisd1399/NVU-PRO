import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowRight, Building2, Calendar, Camera, Check, ChevronRight, Container, Handshake, KeyRound, MessageSquare, Plus, Repeat, Search, Target, Trophy, Truck, UserRound,
} from "lucide-react";
import { useOperationalStore, useSessionStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { usePartnerships } from "../../hooks/usePartnerships";
import { partnershipService } from "../../services/partnershipService";
import { StableImage } from "../../components/common/StableImage";
import AssignJobAssetPicker from "../../components/admin/AssignJobAssetPicker";
import { AssignmentOptionPicker, type PickerOption } from "../../components/admin/AssignmentOptionPicker";
import { operationalRequestId } from "../../lib/operationalRequestId";
import { isTrailerlessSimulator } from "../../lib/resolveSimulator";
import { resolveDriverPhoto } from "../../lib/resolveDriverPhoto";
import { countFleetAssetUsage } from "../../lib/fleetUsage";
import { partnerCandidates, type PartnerCandidate } from "../../lib/partnerCandidates";
import {
  emptyDraft, formatMoney, initialsOf, matchesRequirement, MAX_CONDITIONS, paceOf, parseMoneyToCents, partnershipErrorMessage, pipsFor, remainingText,
  resultsOf, roleIn, sectionFor, statusText, validateDraft, type OfferDraft, type Partnership,
} from "../../lib/partnerships";
import "./Partnerships.css";

type View = { name: "list" } | { name: "new"; partnerId?: string; from?: Partnership } | { name: "offer" | "designate" | "detail" | "results"; id: string };
type Tab = "all" | "contractor" | "executor";
const dateTime = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const dayTime = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const fmt = (formatter: Intl.DateTimeFormat, ms: number) => ms ? formatter.format(new Date(ms)).replace(".", "") : "—";
const OPEN_JOB = ["pending", "active", "delayed", "awaiting_completion"];

/** Logos das empresas (catálogo público) para os cartões; sem logo, a sigla. */
const LogoContext = createContext<{ logo: (companyId: string) => string; viewerId: string }>({ logo: () => "", viewerId: "" });

function Logo({ name, tone, companyId }: { name: string; tone: "me" | "partner" | "muted" | "ghost"; companyId?: string }) {
  const { logo, viewerId } = useContext(LogoContext);
  const src = companyId ? logo(companyId) : "";
  if (tone === "ghost") return <span className="b2p-nd" data-tone="ghost" aria-hidden="true"><Plus size={18} /></span>;
  return <span className="b2p-nd" data-tone={tone} data-img={src ? "1" : "0"} aria-hidden="true">
    {src ? <StableImage src={src} alt="" loading="lazy" decoding="async" wrapperClassName="b2p-nd-img" className="object-cover" referrerPolicy="no-referrer"
      persistentViewerId={viewerId} persistentAssetId={`company-logo:${companyId}`} fallback={<span>{initialsOf(name)}</span>} /> : initialsOf(name)}
  </span>;
}

function PageHeader({ onBack, title = "Parcerias", eyebrow = "B2P" }: { onBack: () => void; title?: string; eyebrow?: string }) {
  return <header className="b2p-head">
    <button type="button" className="b2p-back" onClick={onBack} aria-label="Voltar"><ArrowLeft size={18} aria-hidden="true" /></button>
    <div><span className="b2p-eyebrow">{eyebrow}</span><h1>{title}</h1></div>
  </header>;
}

function SectionLine({ label, count, tone }: { label: string; count: number; tone?: "warn" }) {
  return <div className="b2p-line" data-tone={tone}><span>{label}</span><i>{count}</i><div /></div>;
}

function Pips({ done, total }: { done: number; total: number }) {
  const filled = pipsFor(done, total);
  return <div className="b2p-pips" role="img" aria-label={`${done} de ${total} viagens`}>
    {Array.from({ length: 20 }, (_, index) => <i key={index} data-on={index < filled ? "1" : "0"} data-last={index === filled - 1 ? "1" : "0"} />)}
  </div>;
}

/** Condições da oferta em quatro células: viagens, prazo, reboque exigido e meta. O veículo NÃO faz parte da oferta. */
function Spec({ p }: { p: Partnership }) {
  return <dl className="b2p-spec">
    <div><dt>Viagens</dt><dd>{p.totalTrips}</dd></div>
    <div><dt>Prazo final</dt><dd>{fmt(dateTime, p.deadlineMs)}</dd></div>
    {p.trailerRequirement ? <div><dt>Reboque</dt><dd>{p.trailerRequirement}</dd></div> : null}
    {p.goalAmountCents ? <div><dt>Meta de ganhos</dt><dd>{formatMoney(p.goalAmountCents, p.currency)}</dd></div> : null}
  </dl>;
}

function PactCard({ p, me, now, onOpen, onRepeat, onResults }: { p: Partnership; me: string; now: number; onOpen: () => void; onRepeat?: () => void; onResults?: () => void }) {
  const role = roleIn(p, me), done = p.status === "completed";
  const pace = paceOf(p, now), results = resultsOf(p);
  const mine = role === "contractor" ? p.contractorName : p.executorName, other = role === "contractor" ? p.executorName : p.contractorName;
  const mineId = role === "contractor" ? p.contractorCompanyId : p.executorCompanyId, otherId = role === "contractor" ? p.executorCompanyId : p.contractorCompanyId;
  return <article className="b2p-pact">
    <header>
      <span className="b2p-role" data-role={role}>{role === "contractor" ? "Você contratou" : "Você executa"}</span>
      {done ? <span className="b2p-chip" data-solid="1"><Check size={13} aria-hidden="true" />Concluída</span> : <button type="button" className="b2p-go" onClick={onOpen} aria-label={`Abrir ${p.operationName}`}><ChevronRight size={18} aria-hidden="true" /></button>}
    </header>
    {done ? <div><h3>{p.operationName}</h3><p className="b2p-sub">{other}{p.driverName ? ` · ${p.driverName}` : ""}{p.updatedAtMs ? ` · ${fmt(dayTime, p.updatedAtMs)}` : ""}</p></div>
      : <><div className="b2p-route"><Logo name={mine} tone="me" companyId={mineId} /><div className="b2p-track"><Pips done={p.progress} total={p.totalTrips} />
        <div className="b2p-track-l"><span>{p.progress} de {p.totalTrips}</span><span>{Math.max(0, p.totalTrips - p.progress)} restantes</span></div></div><Logo name={other} tone="partner" companyId={otherId} /></div>
        <div className="b2p-parties"><div><small>{role === "contractor" ? "Contratante" : "Executora"}</small><b>{mine}</b></div><div><small>{role === "contractor" ? "Executora" : "Contratante"}</small><b>{other}</b></div></div>
        <h3 className="b2p-opname">{p.operationName}</h3></>}
    <dl className="b2p-sts">
      <div><dt>Viagens</dt><dd>{p.progress}{done ? " de " : " / "}{p.totalTrips}</dd></div>
      {done ? <div><dt>Ganhos</dt><dd>{formatMoney(results.earningsCents, p.currency)}</dd></div> : <div><dt>Prazo</dt><dd>{remainingText(p.deadlineMs, now) || "—"}</dd></div>}
      {p.goalAmountCents ? <div><dt>Meta</dt><dd className="b2p-tq">{results.goalPercent ?? 0}%</dd></div> : <div><dt>Ritmo</dt><dd data-tone={pace.tone}>{pace.label || "—"}</dd></div>}
    </dl>
    {!done && pace.label && p.goalAmountCents ? <p className="b2p-pace" data-tone={pace.tone}>{pace.label}</p> : null}
    {done && role === "contractor" && onRepeat ? <button type="button" className="b2p-repeat" onClick={onRepeat}>
      <span className="b2p-lrt"><Logo name={mine} tone="me" companyId={mineId} /><span className="b2p-cn" /><Logo name={other} tone="partner" companyId={otherId} /></span>
      <span className="b2p-ltx"><b>Repetir com a {other}</b><small>Mesmas {p.totalTrips} viagens{p.trailerRequirement ? ` e reboque ${p.trailerRequirement}` : ""}</small></span><span className="b2p-go" data-solid="1"><ArrowRight size={16} aria-hidden="true" /></span></button> : null}
    {done && onResults ? <button type="button" className="b2p-ghost" onClick={onResults}><Trophy size={17} aria-hidden="true" />Ver resultados</button> : null}
  </article>;
}

function Ticket({ p, mode, onOpen, onDecline, onCancel, busy }: { p: Partnership; mode: "invite" | "sent" | "designate"; onOpen: () => void; onDecline?: () => void; onCancel?: () => void; busy: boolean }) {
  const invite = mode === "invite", designate = mode === "designate";
  return <article className="b2p-tk" data-mode={mode}>
    <div className="b2p-tk-a">
      <div className="b2p-who"><Logo name={invite || designate ? p.contractorName : p.executorName} tone={invite || designate ? "me" : "partner"} companyId={invite || designate ? p.contractorCompanyId : p.executorCompanyId} />
        <div><span className="b2p-eyebrow" data-amber={invite || designate ? "1" : "0"}>{invite ? "Convite de parceria" : designate ? "Oferta aceita" : "Oferta enviada"}</span>
          <small>{invite || designate ? `recebido em ${fmt(dayTime, p.createdAtMs)}` : `enviada em ${fmt(dayTime, p.createdAtMs)}`}</small></div></div>
      <p className="b2p-inv">{invite || designate ? <><em>{p.contractorName}</em> convida a {p.executorName} para {p.operationName}</> : <>Você convidou a <em>{p.executorName}</em> para {p.operationName}</>}</p>
    </div>
    <div className="b2p-perf" />
    <div className="b2p-tk-b">
      <Spec p={p} />
      <p className="b2p-pt"><Target size={14} aria-hidden="true" />Pontua para <b>{p.contractorName}</b></p>
      <div className="b2p-acts">
        {invite ? <><button type="button" className="b2p-cta" onClick={onOpen}>Ver oferta<ArrowRight size={17} aria-hidden="true" /></button>
          <button type="button" className="b2p-txt" data-tone="danger" disabled={busy} onClick={onDecline}>Recusar</button></>
          : designate ? <button type="button" className="b2p-cta" onClick={onOpen}>Designar trabalho<ArrowRight size={17} aria-hidden="true" /></button>
          : <><button type="button" className="b2p-ghost" onClick={onOpen}>Ver detalhes</button>
            {onCancel ? <button type="button" className="b2p-txt" data-tone="danger" disabled={busy} onClick={onCancel}>Cancelar oferta</button> : null}</>}
      </div>
    </div>
  </article>;
}

export default function Partnerships() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeCompanyId, companies, allCompanies, loadCompanyCatalog, companyCatalogLoaded, companyCatalogAttempted, allCompanyMembers, allCompanyMembersReady } = useCompanyStore();
  const { vehicles, trailers, users, simulators, jobs, contracts, sequences } = useOperationalStore();
  const { currentUser } = useSessionStore();
  const { rows, ready, error } = usePartnerships(activeCompanyId);
  const me = activeCompanyId || "";
  const ownCompany = companies.find(item => item.id === me) || allCompanies.find(item => item.id === me);
  const [view, setView] = useState<View>({ name: "list" });
  const [tab, setTab] = useState<Tab>("all");
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const now = useMemo(() => Date.now(), [rows, view]);
  const openedFromState = useRef(false);
  // A lista de empresas parceiras vem do catálogo PÚBLICO (todas as empresas do sistema), não só das empresas do usuário.
  useEffect(() => { void loadCompanyCatalog().catch(() => []); }, [loadCompanyCatalog]);
  useEffect(() => {
    const id = (location.state as { openId?: string } | null)?.openId;
    if (id && !openedFromState.current && rows.some(row => row.id === id)) { openedFromState.current = true; setView({ name: "detail", id }); }
  }, [location.state, rows]);

  const byId = useMemo(() => new Map(rows.map(row => [row.id, row])), [rows]);
  const logoById = useMemo(() => new Map(allCompanies.map(item => [item.id, String(item.logoUrl || item.logoURL || item.companyLogoURL || "")])), [allCompanies]);
  const logoValue = useMemo(() => ({ logo: (companyId: string) => logoById.get(companyId) || "", viewerId: String(currentUser?.id || "") }), [logoById, currentUser?.id]);
  const candidates = useMemo(() => partnerCandidates({ ownCompany, allCompanies, simulators: simulators as any[], history: rows }), [ownCompany, allCompanies, simulators, rows]);
  const catalog = { loaded: companyCatalogLoaded, failed: companyCatalogAttempted && !companyCatalogLoaded, retry: () => void loadCompanyCatalog(true).catch(() => []) };

  const visible = rows.filter(row => tab === "all" || roleIn(row, me) === tab);
  const sections = useMemo(() => {
    const groups: Record<string, Partnership[]> = { action: [], running: [], waiting: [], done: [] };
    visible.forEach(row => { const key = sectionFor(row, me); if (groups[key]) groups[key].push(row); });
    return groups;
  }, [visible, me]);
  const toAnswer = rows.filter(row => sectionFor(row, me) === "action").length;
  const active = rows.filter(row => sectionFor(row, me) === "running").length;
  const back = () => { if (view.name === "list") navigate("/admin/fleet"); else setView({ name: "list" }); };

  const run = async (task: () => Promise<void>, failure: string) => {
    if (busy) return;
    setBusy(true);
    try { await task(); } catch (reason) { toast.error(partnershipErrorMessage(reason, failure)); } finally { setBusy(false); }
  };
  const respond = (p: Partnership, decision: "accept" | "decline") => run(async () => {
    await partnershipService.respond(p.id, decision);
    if (decision === "accept") { toast.success("Oferta aceita. Agora designe o motorista e o veículo."); setView({ name: "designate", id: p.id }); }
    else { toast.message("Oferta recusada."); setView({ name: "list" }); }
  }, "Não foi possível responder a oferta.");
  const cancel = (p: Partnership) => run(async () => { await partnershipService.cancel(p.id); toast.message("Oferta cancelada."); setView({ name: "list" }); }, "Não foi possível cancelar a oferta.");

  const shell = (children: React.ReactNode) => <LogoContext.Provider value={logoValue}><div className="nvu-b2p">{children}</div></LogoContext.Provider>;
  if (!me) return shell(<><PageHeader onBack={() => navigate("/admin/fleet")} /><p className="b2p-empty">Selecione uma empresa para ver as parcerias.</p></>);
  const current = "id" in view ? byId.get(view.id) : undefined;

  if (view.name === "new") return shell(<NewOffer key={view.from?.id || view.partnerId || "new"} me={me} ownCompany={ownCompany} candidates={candidates} catalog={catalog} initial={view}
    trailers={trailers as any[]} simulators={simulators as any[]} onBack={() => setView({ name: "list" })} onSent={(ready, partnerName) => {
      if (ready) toast.success("Oferta enviada."); else toast.message(`Oferta enviada. ${partnerName} ainda precisa preparar a confirmação operacional da empresa (Operações) para poder aceitar.`, { duration: 9000 });
      setView({ name: "list" });
    }} />);
  if ("id" in view && !current) return shell(<><PageHeader onBack={() => setView({ name: "list" })} />{ready ? <p className="b2p-empty">Esta parceria não está mais disponível.</p> : <p className="b2p-empty">Carregando…</p>}</>);
  if (view.name === "offer" && current) return shell(<OfferDetail p={current} busy={busy} onBack={() => setView({ name: "list" })} onAccept={() => respond(current, "accept")} onDecline={() => respond(current, "decline")} />);
  if (view.name === "designate" && current) return shell(<Designate p={current} me={me} ownCompany={ownCompany} users={users as any[]} members={allCompanyMembers as any[]} membersReady={Boolean(allCompanyMembersReady)}
    vehicles={vehicles as any[]} trailers={trailers as any[]} sequences={sequences as any[]} jobs={jobs as any[]} contracts={contracts as any[]} simulators={simulators as any[]}
    onBack={() => setView({ name: "list" })} onDone={() => { toast.success("Motorista designado. A operação já aparece para ele."); setView({ name: "detail", id: current.id }); }} />);
  if (view.name === "results" && current) return shell(<Results p={current} me={me} onBack={() => setView({ name: "detail", id: current.id })} />);
  if (view.name === "detail" && current) return shell(<Detail p={current} me={me} now={now} busy={busy} onBack={() => setView({ name: "list" })}
    onResults={() => setView({ name: "results", id: current.id })} onDesignate={() => setView({ name: "designate", id: current.id })} onCancel={() => cancel(current)}
    onRepeat={() => setView({ name: "new", from: current })} />);

  const empty = ready && rows.length === 0;
  const quick = (candidates.list.some(item => item.partnered) ? candidates.list.filter(item => item.partnered) : candidates.list).slice(0, 3);
  return shell(<>
    <PageHeader onBack={back} />
    {error ? <p className="b2p-alert" role="alert">Não foi possível atualizar as parcerias agora. Os dados podem estar desatualizados.</p> : null}
    <button type="button" className="b2p-launch" data-slim={rows.length > 1 ? "1" : "0"} onClick={() => setView({ name: "new" })}>
      <span className="b2p-lrt"><Logo name={String(ownCompany?.companyName || "Eu")} tone="me" companyId={me} /><span className="b2p-cn" /><Logo name="" tone="ghost" /></span>
      <span className="b2p-ltx"><b>Propor operação</b>{rows.length <= 1 ? <small>Convide uma empresa parceira para executar viagens por você</small> : null}</span>
      <span className="b2p-go" data-solid="1"><ArrowRight size={18} aria-hidden="true" /></span>
    </button>
    <section aria-label="Enviar rápido">
      <div className="b2p-line"><span data-on="1">Enviar rápido para</span><div /></div>
      {quick.length ? <div className="b2p-rail">
        {quick.map(item => <button type="button" className="b2p-rail-it" key={item.id} onClick={() => setView({ name: "new", partnerId: item.id })}>
          <Logo name={item.name} tone={item.partnered ? "partner" : "muted"} companyId={item.id} /><b>{item.name}</b><small>{item.simulatorLabel}</small></button>)}
        <button type="button" className="b2p-rail-it" onClick={() => setPicker(true)}><Logo name="" tone="ghost" /><b>Ver todas</b><small>{candidates.list.length} ativas</small></button>
      </div> : <CatalogStatus catalog={catalog} candidates={candidates} />}
    </section>
    {rows.length ? <>
      {toAnswer || active ? <p className="b2p-strip">{toAnswer ? <><b data-amber="1">{toAnswer}</b>&nbsp;para responder<span className="b2p-sep" /></> : null}<b>{active}</b>&nbsp;{active === 1 ? "ativa" : "ativas"}</p> : null}
      <div className="b2p-tabs" role="tablist">{([["all", "Todas"], ["contractor", "Contratei"], ["executor", "Executo"]] as const).map(([key, label]) =>
        <button type="button" role="tab" aria-selected={tab === key} data-on={tab === key ? "1" : "0"} key={key} onClick={() => setTab(key)}>{label}</button>)}</div>
      {sections.action.length ? <><SectionLine label="Precisa da sua ação" count={sections.action.length} tone="warn" />
        {sections.action.map(p => p.status === "pending" ? <Ticket key={p.id} p={p} mode="invite" busy={busy} onOpen={() => setView({ name: "offer", id: p.id })} onDecline={() => respond(p, "decline")} />
          : <Ticket key={p.id} p={p} mode="designate" busy={busy} onOpen={() => setView({ name: "designate", id: p.id })} />)}</> : null}
      <SectionLine label="Em andamento" count={sections.running.length} />
      {sections.running.length ? sections.running.map(p => <PactCard key={p.id} p={p} me={me} now={now} onOpen={() => setView({ name: "detail", id: p.id })} />) : <p className="b2p-none">Nenhuma operação em andamento.</p>}
      {sections.waiting.length ? <><SectionLine label="Aguardando resposta" count={sections.waiting.length} />
        {sections.waiting.map(p => <Ticket key={p.id} p={p} mode="sent" busy={busy} onOpen={() => setView({ name: "detail", id: p.id })} onCancel={p.status === "pending" && p.contractorCompanyId === me ? () => cancel(p) : undefined} />)}</> : null}
      {sections.done.length ? <><SectionLine label="Concluídas" count={sections.done.length} />
        {sections.done.map(p => <PactCard key={p.id} p={p} me={me} now={now} onOpen={() => setView({ name: "detail", id: p.id })} onResults={() => setView({ name: "results", id: p.id })}
          onRepeat={() => setView({ name: "new", from: p })} />)}</> : null}
    </> : empty ? <p className="b2p-empty">Nenhuma parceria ainda. Toque em <b>Propor operação</b> para convidar uma empresa parceira.</p> : !ready ? <p className="b2p-empty">Carregando parcerias…</p> : null}
    <PartnerPicker open={picker} candidates={candidates} viewerId={String(currentUser?.id || "")} onClose={() => setPicker(false)} onPick={id => { setPicker(false); setView({ name: "new", partnerId: id }); }} />
  </>);
}

type CatalogState = { loaded: boolean; failed: boolean; retry: () => void };

/** Estado da lista de empresas parceiras: carregando, falha (com nova tentativa) ou nenhuma empresa ativa no simulador. */
function CatalogStatus({ catalog, candidates }: { catalog: CatalogState; candidates: ReturnType<typeof partnerCandidates> }) {
  if (catalog.failed) return <p className="b2p-note" role="alert">Não foi possível carregar as empresas agora. <button type="button" className="b2p-link" onClick={catalog.retry}>Tentar de novo</button></p>;
  if (!catalog.loaded) return <p className="b2p-note" role="status">Carregando as empresas ativas…</p>;
  if (!candidates.simulatorId) return <p className="b2p-note" role="status">Não foi possível identificar o simulador da sua empresa. Confira o cadastro em Editar empresa.</p>;
  return <p className="b2p-note" role="status">Nenhuma outra empresa ativa no {candidates.simulatorLabel || "seu simulador"} no momento.</p>;
}

const candidateOption = (item: PartnerCandidate): PickerOption => ({
  id: item.id, title: item.name, description: item.simulatorLabel,
  avatar: { src: item.logo, assetId: `company-logo:${item.id}`, initials: initialsOf(item.name) },
  tag: item.partnered ? { label: "Já parceira", tone: "good" } : undefined,
});

/** Escolha da empresa parceira: lista da Central (busca + cartões com logo), só empresas ativas do mesmo simulador. */
function PartnerPicker({ open, candidates, selectedId = "", viewerId, onClose, onPick }: {
  open: boolean; candidates: ReturnType<typeof partnerCandidates>; selectedId?: string; viewerId: string; onClose: () => void; onPick: (id: string) => void;
}) {
  const options = useMemo(() => candidates.list.map(candidateOption), [candidates.list]);
  return <AssignmentOptionPicker open={open} title="Escolher empresa parceira" subtitle={`Empresas ativas do ${candidates.simulatorLabel || "seu simulador"}.`}
    icon={<Building2 size={26} strokeWidth={1.65} />} searchPlaceholder="Buscar empresa..." options={options} selectedId={selectedId} counter={{ one: "1 empresa selecionada", none: "Nenhuma empresa selecionada" }}
    confirmLabel="Usar empresa" emptyText="Nenhuma empresa ativa neste simulador." viewerId={viewerId} onClose={onClose} onSelect={choice => onPick(choice.id)} />;
}

/** Linha de formulário que abre uma lista de opções (mesmo padrão dos campos "Veículo"/"Operação" da Central). */
function PickRow({ icon, label, value, hint, placeholder, onOpen, disabled, avatar }: {
  icon: React.ReactNode; label: string; value?: string; hint?: string; placeholder: string; onOpen: () => void; disabled?: boolean; avatar?: React.ReactNode;
}) {
  return <button type="button" className="b2p-fr b2p-pick" onClick={onOpen} disabled={disabled} aria-haspopup="dialog" aria-label={value ? `Alterar ${label}: ${value}` : `Escolher ${label}`}>
    <span className="b2p-fr-ic" aria-hidden="true">{icon}</span><span className="b2p-fr-k">{label}</span>
    <span className="b2p-fr-v">{avatar}<span className="b2p-pick-copy">{value ? <><b>{value}</b>{hint ? <small>{hint}</small> : null}</> : <span className="b2p-pick-ph">{placeholder}</span>}</span></span>
    <ChevronRight size={17} className="b2p-fr-ch" aria-hidden="true" />
  </button>;
}

function Row({ icon, label, children, tall }: { icon: React.ReactNode; label: string; children: React.ReactNode; tall?: boolean }) {
  return <label className="b2p-fr" data-tall={tall ? "1" : "0"}><span className="b2p-fr-ic" aria-hidden="true">{icon}</span><span className="b2p-fr-k">{label}</span><span className="b2p-fr-v">{children}</span></label>;
}

function NewOffer({ me, ownCompany, candidates, catalog, initial, trailers, simulators, onBack, onSent }: {
  me: string; ownCompany: any; candidates: ReturnType<typeof partnerCandidates>; catalog: CatalogState; initial: { partnerId?: string; from?: Partnership };
  trailers: any[]; simulators: any[]; onBack: () => void; onSent: (executorReady: boolean, partnerName: string) => void;
}) {
  const { viewerId } = useContext(LogoContext);
  const from = initial.from;
  const [draft, setDraft] = useState<OfferDraft>(() => from ? { ...emptyDraft(from.executorCompanyId), operationName: from.operationName, totalTrips: String(from.totalTrips),
    trailerRequirement: from.trailerRequirement || "", conditions: from.conditions, goal: from.goalAmountCents ? String(from.goalAmountCents / 100).replace(".", ",") : "" } : emptyDraft(initial.partnerId || ""));
  const [partnerOpen, setPartnerOpen] = useState(false), [trailerOpen, setTrailerOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const requestId = useRef(operationalRequestId());
  const partner = candidates.list.find(item => item.id === draft.executorCompanyId);
  const trailerless = isTrailerlessSimulator(ownCompany, simulators);
  const set = (patch: Partial<OfferDraft>) => { setDraft(current => ({ ...current, ...patch })); setError(""); };
  // Reboques da frota da contratante (por nome); o reboque exigido já escolhido aparece marcado mesmo que não esteja na frota.
  const trailerOptions = useMemo<PickerOption[]>(() => {
    const names = [...new Set(trailers.filter(item => !item.companyId || item.companyId === me).map(item => String(item.name || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
    if (draft.trailerRequirement && !names.some(name => name.toLowerCase() === draft.trailerRequirement.toLowerCase())) names.unshift(draft.trailerRequirement);
    return names.map(name => ({ id: name, title: name, description: "Reboque exigido na oferta", avatar: { icon: <Container size={22} strokeWidth={1.65} /> } }));
  }, [trailers, me, draft.trailerRequirement]);
  const submit = async () => {
    const message = validateDraft(draft, Date.now(), trailerless);
    if (message) { setError(message); return; }
    if (!partner) { setError("Escolha uma empresa ativa do seu simulador."); return; }
    setBusy(true); setError("");
    try {
      const sent = await partnershipService.createOffer({ contractorCompanyId: me, executorCompanyId: draft.executorCompanyId, operationName: draft.operationName.trim(), totalTrips: Number(draft.totalTrips),
        trailerRequirement: trailerless ? null : draft.trailerRequirement.trim() || null,
        deadlineAt: new Date(draft.deadlineAt).toISOString(), conditions: draft.conditions.trim(), goalAmountCents: draft.goal.trim() ? parseMoneyToCents(draft.goal) : null, requestId: requestId.current });
      onSent(sent.executorReady !== false, partner.name);
    } catch (reason) { setError(partnershipErrorMessage(reason, "Não foi possível enviar a oferta.")); setBusy(false); }
  };
  const destHint = !catalog.loaded ? (catalog.failed ? "Não foi possível carregar as empresas" : "Carregando as empresas ativas…")
    : !candidates.simulatorId ? "Simulador da sua empresa não identificado"
    : partner ? `Mesmo simulador · ${partner.simulatorLabel}` : `${candidates.list.length} ${candidates.list.length === 1 ? "empresa ativa" : "empresas ativas"} no ${candidates.simulatorLabel}`;
  return <>
    <PageHeader onBack={onBack} title="Nova oferta" eyebrow="Parcerias B2P" />
    <section className="b2p-group"><h2>Para quem</h2>
      <button type="button" className="b2p-dest" onClick={() => catalog.failed ? catalog.retry() : setPartnerOpen(true)} disabled={!catalog.loaded && !catalog.failed} aria-haspopup="dialog">
        <Logo name={partner?.name || ""} tone={partner ? "partner" : "ghost"} companyId={partner?.id} />
        <span><b>{partner?.name || (catalog.failed ? "Tentar carregar de novo" : "Escolher empresa parceira")}</b><small>{destHint}</small></span><ChevronRight size={18} aria-hidden="true" /></button></section>
    <section className="b2p-group"><h2>A operação</h2><div className="b2p-fg">
      <Row icon={<Handshake size={18} />} label="Nome"><input value={draft.operationName} maxLength={60} onChange={event => set({ operationName: event.target.value })} placeholder="Ex.: Operação 031" /></Row>
      <Row icon={<Repeat size={18} />} label="Viagens"><input inputMode="numeric" value={draft.totalTrips} onChange={event => set({ totalTrips: event.target.value.replace(/\D/g, "").slice(0, 3) })} placeholder="20" /></Row>
    </div></section>
    <section className="b2p-group"><h2>Exigências e prazo</h2><div className="b2p-fg">
      {!trailerless ? <PickRow icon={<Container size={18} />} label="Reboque" value={draft.trailerRequirement || ""} placeholder="Sem exigência" hint="Reboque exigido" onOpen={() => setTrailerOpen(true)} /> : null}
      <Row icon={<Calendar size={18} />} label="Prazo final"><input type="datetime-local" value={draft.deadlineAt} onChange={event => set({ deadlineAt: event.target.value })} /></Row>
    </div><small className="b2p-hint"><Truck size={13} aria-hidden="true" /> O veículo e o motorista são escolhidos pela empresa parceira, entre os da própria frota.</small></section>
    <section className="b2p-group"><h2>Condições</h2><div className="b2p-fg">
      <Row icon={<MessageSquare size={18} />} label="Acordo" tall><textarea value={draft.conditions} maxLength={MAX_CONDITIONS} rows={3} onChange={event => set({ conditions: event.target.value })} placeholder="Opcional · combinados entre as empresas" /></Row>
      <Row icon={<Target size={18} />} label="Meta (R$)"><input inputMode="decimal" value={draft.goal} onChange={event => set({ goal: event.target.value })} placeholder="Opcional · só acompanhamento" /></Row>
    </div><small className="b2p-hint">{draft.conditions.length}/{MAX_CONDITIONS} · A meta é só para acompanhar os ganhos. O NVU não cobra nem paga nada entre as empresas.</small></section>
    {error ? <p className="b2p-alert" role="alert">{error}</p> : null}
    <div className="b2p-bar"><button type="button" className="b2p-cta" disabled={busy} onClick={() => void submit()}>{busy ? "Enviando…" : "Enviar oferta"}<ArrowRight size={17} aria-hidden="true" /></button></div>
    <PartnerPicker open={partnerOpen} candidates={candidates} selectedId={draft.executorCompanyId} viewerId={viewerId} onClose={() => setPartnerOpen(false)} onPick={id => { set({ executorCompanyId: id }); setPartnerOpen(false); }} />
    <AssignmentOptionPicker open={trailerOpen} title="Escolher reboque" subtitle="Reboque que a parceira deve usar na operação." icon={<Container size={26} strokeWidth={1.65} />}
      searchPlaceholder="Buscar ou digitar o reboque..." options={trailerOptions} selectedId={draft.trailerRequirement} counter={{ one: "1 reboque selecionado", none: "Nenhum reboque selecionado" }} confirmLabel="Usar reboque"
      emptyText="Sua frota não tem reboques cadastrados. Digite o nome do reboque exigido." noneOption={{ title: "Sem exigência de reboque", description: "A parceira usa qualquer reboque (ou nenhum)." }}
      custom={{ label: text => `Exigir “${text}”` }} viewerId={viewerId} onClose={() => setTrailerOpen(false)} onSelect={choice => set({ trailerRequirement: choice.id })} />
  </>;
}

function OfferDetail({ p, busy, onBack, onAccept, onDecline }: { p: Partnership; busy: boolean; onBack: () => void; onAccept: () => void; onDecline: () => void }) {
  const open = p.status === "pending";
  return <>
    <PageHeader onBack={onBack} title="Oferta recebida" eyebrow="Parcerias B2P" />
    <article className="b2p-pact"><header><span className="b2p-role" data-role="executor">{p.contractorName}</span><span className="b2p-sub">{fmt(dayTime, p.createdAtMs)}</span></header>
      <div><h3>{p.operationName}</h3><p className="b2p-sub">{p.contractorName} convida a {p.executorName}</p></div>
      <Spec p={p} />
      {p.conditions ? <blockquote className="b2p-quote"><small>Condições do acordo</small>{p.conditions}</blockquote> : null}
    </article>
    <p className="b2p-rule"><Truck size={16} aria-hidden="true" /><span>Ao aceitar, <b>você escolhe o motorista e o veículo</b> da sua frota{p.trailerRequirement ? <> (o reboque precisa ser <b>{p.trailerRequirement}</b>)</> : null}.</span></p>
    <p className="b2p-rule"><Trophy size={16} aria-hidden="true" /><span>As viagens confirmadas pontuam para <b>{p.contractorName}</b> no ranking de empresas. Você acompanha o andamento e o motorista mantém o histórico dele.</span></p>
    {open ? <div className="b2p-bar"><button type="button" className="b2p-cta" disabled={busy} onClick={onAccept}>{busy ? "Enviando…" : "Aceitar oferta"}<Check size={17} aria-hidden="true" /></button>
      <button type="button" className="b2p-txt" data-tone="danger" disabled={busy} onClick={onDecline}>Recusar</button></div> : <p className="b2p-none">Esta oferta já foi respondida ({p.status === "declined" ? "recusada" : p.status === "cancelled" ? "cancelada" : "aceita"}).</p>}
  </>;
}

const usageText = (count: number | null | undefined) => count == null ? "Vínculos em consulta" : count === 0 ? "Sem motoristas vinculados" : `Em uso por ${count} motorista${count === 1 ? "" : "s"}`;

/**
 * Designar trabalho (executora): motorista da própria equipe, veículo da própria frota e, se a oferta exigir, o reboque.
 * Usa as listas da Central: lista de motoristas com foto e situação, e as janelas "Escolher veículo" / "Escolher reboque".
 */
function Designate({ p, me, ownCompany, users, members, membersReady, vehicles, trailers, sequences, jobs, contracts, simulators, onBack, onDone }: {
  p: Partnership; me: string; ownCompany: any; users: any[]; members: any[]; membersReady: boolean; vehicles: any[]; trailers: any[]; sequences: any[]; jobs: any[]; contracts: any[]; simulators: any[];
  onBack: () => void; onDone: () => void;
}) {
  const { viewerId } = useContext(LogoContext);
  const trailerless = isTrailerlessSimulator(ownCompany, simulators);
  const drivers = useMemo(() => users.filter(user => user.status === "active" && members?.some(member => member.userId === user.id && member.companyId === me && member.status === "active" && member.roles?.includes("driver")))
    .map(user => ({ user, open: jobs.filter(job => job.companyId === me && job.driverId === user.id && OPEN_JOB.includes(String(job.status))).length }))
    .sort((a, b) => String(a.user.name).localeCompare(String(b.user.name), "pt-BR", { sensitivity: "base" })), [users, members, jobs, me]);
  const ownVehicles = useMemo(() => vehicles.filter(item => !item.companyId || item.companyId === me), [vehicles, me]);
  const ownTrailers = useMemo(() => trailers.filter(item => !item.companyId || item.companyId === me), [trailers, me]);
  const vehicleUsage = useMemo(() => {
    const usage = new Map<string, number | null>();
    for (const vehicle of ownVehicles) usage.set(vehicle.id, membersReady ? countFleetAssetUsage({ jobs, members, contracts, assetId: vehicle.id, kind: "vehicle", companyId: me }) : null);
    return usage;
  }, [ownVehicles, jobs, members, membersReady, contracts, me]);
  const [driverId, setDriverId] = useState(""), [vehicleId, setVehicleId] = useState(""), [trailerId, setTrailerId] = useState("");
  const [driverSearch, setDriverSearch] = useState(""), [vehicleOpen, setVehicleOpen] = useState(false), [trailerOpen, setTrailerOpen] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const vehicle = ownVehicles.find(item => item.id === vehicleId), trailer = ownTrailers.find(item => item.id === trailerId);
  const needsTrailer = Boolean(p.trailerRequirement) && !trailerless;
  const trailerOptions = useMemo<PickerOption[]>(() => ownTrailers.map(item => {
    const fits = !p.trailerRequirement || matchesRequirement(p.trailerRequirement, String(item.name));
    return { id: item.id, title: String(item.name), avatar: { icon: <Container size={22} strokeWidth={1.65} /> }, disabled: !fits,
      description: p.trailerRequirement ? (fits ? "Atende a exigência da oferta" : undefined) : "Da sua frota", disabledReason: `Não atende a exigência: ${p.trailerRequirement}`,
      tag: p.trailerRequirement && fits ? { label: "Compatível", tone: "good" as const } : undefined };
  }).sort((a, b) => Number(Boolean(a.disabled)) - Number(Boolean(b.disabled)) || a.title.localeCompare(b.title, "pt-BR", { numeric: true })), [ownTrailers, p.trailerRequirement]);
  const query = driverSearch.trim().toLowerCase();
  const shownDrivers = drivers.filter(item => !query || String(item.user.name).toLowerCase().includes(query));
  const ready = Boolean(driverId && vehicleId && (!needsTrailer || trailerId));
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setError("");
    try { await partnershipService.designateDriver({ partnershipId: p.id, driverId, vehicleId, trailerId: trailerless ? null : trailerId || null }); onDone(); }
    catch (reason) { setError(partnershipErrorMessage(reason, "Não foi possível designar o motorista.")); setBusy(false); }
  };
  if (p.jobId) return <><PageHeader onBack={onBack} title="Designar trabalho" eyebrow="Parcerias B2P" /><p className="b2p-empty">O motorista <b>{p.driverName || "da equipe"}</b> já foi designado para esta operação.</p></>;
  return <>
    <PageHeader onBack={onBack} title="Designar trabalho" eyebrow="Parcerias B2P" />
    <article className="b2p-brief"><div><b>{p.operationName}</b><small>{p.contractorName} · {p.totalTrips} viagens · até {fmt(dateTime, p.deadlineMs)}</small></div>
      {p.trailerRequirement ? <span className="b2p-brief-chip"><Container size={14} aria-hidden="true" />{p.trailerRequirement}</span> : null}</article>
    <section className="b2p-group"><h2><UserRound size={15} aria-hidden="true" />Motorista da sua equipe <i>{shownDrivers.length}</i></h2>
      {drivers.length > 6 ? <label className="b2p-search"><Search size={17} aria-hidden="true" /><input type="search" value={driverSearch} onChange={event => setDriverSearch(event.target.value)} placeholder="Buscar motorista..." aria-label="Buscar motorista" autoComplete="off" /></label> : null}
      <div className="b2p-drivers" role="radiogroup" aria-label="Motorista">
        {shownDrivers.map(({ user, open }) => <button type="button" role="radio" aria-checked={driverId === user.id} key={user.id} className="b2p-driver" data-on={driverId === user.id ? "1" : "0"} onClick={() => setDriverId(user.id)}>
          <StableImage src={resolveDriverPhoto(user)} alt="" loading="lazy" decoding="async" wrapperClassName="b2p-driver-avatar" className="object-cover" referrerPolicy="no-referrer"
            persistentViewerId={viewerId} persistentAssetId={`designate-avatar:${me}:${user.id}`} fallback={<span>{String(user.name || "").slice(0, 2).toUpperCase()}</span>} />
          <span className="b2p-driver-copy"><b>{user.name}</b><small data-busy={open ? "1" : "0"}>{open ? `Tem ${open} trabalho${open === 1 ? "" : "s"} aberto${open === 1 ? "" : "s"}` : "Disponível"}</small></span>
          <i className="b2p-radio" aria-hidden="true">{driverId === user.id ? <Check size={13} /> : null}</i></button>)}
        {!shownDrivers.length ? <p className="b2p-none">{!membersReady ? "Consultando os motoristas da empresa…" : drivers.length ? "Nenhum motorista encontrado." : "Nenhum motorista ativo na sua equipe."}</p> : null}
      </div></section>
    <section className="b2p-group"><h2><KeyRound size={15} aria-hidden="true" />Veículo da sua frota</h2><div className="b2p-fg">
      <PickRow icon={<Truck size={18} />} label="Veículo" value={vehicle?.name} hint={vehicle ? usageText(vehicleUsage.get(vehicle.id)) : undefined} placeholder="Escolher veículo" onOpen={() => setVehicleOpen(true)} />
      {!trailerless ? <PickRow icon={<Container size={18} />} label="Reboque" value={trailer?.name} hint={trailer ? (p.trailerRequirement ? "Atende a exigência da oferta" : "Da sua frota") : undefined}
        placeholder={needsTrailer ? `Escolher reboque (${p.trailerRequirement})` : "Sem reboque"} onOpen={() => setTrailerOpen(true)} /> : null}
    </div>{!ownVehicles.length ? <small className="b2p-hint">Sua frota ainda não tem veículos. Cadastre em Frota.</small> : null}</section>
    <p className="b2p-rule"><Camera size={16} aria-hidden="true" /><span>Para iniciar, o motorista precisa anexar a foto do veículo. Ele continua vinculado à sua empresa.</span></p>
    {error ? <p className="b2p-alert" role="alert">{error}</p> : null}
    <div className="b2p-bar"><button type="button" className="b2p-cta" disabled={!ready || busy} onClick={() => void submit()}>{busy ? "Designando…" : "Designar motorista"}<ArrowRight size={17} aria-hidden="true" /></button></div>
    <AssignJobAssetPicker kind="vehicle" open={vehicleOpen} selectedId={vehicleId} vehicles={ownVehicles} sequences={sequences} vehicleUsageById={vehicleUsage} onClose={() => setVehicleOpen(false)} onSelect={setVehicleId} />
    <AssignmentOptionPicker open={trailerOpen} title="Escolher reboque" subtitle={p.trailerRequirement ? `A oferta exige: ${p.trailerRequirement}.` : "Reboque opcional para esta operação."} icon={<Container size={26} strokeWidth={1.65} />}
      searchPlaceholder="Buscar reboque..." options={trailerOptions} selectedId={trailerId} counter={{ one: "1 reboque selecionado", none: "Nenhum reboque selecionado" }} confirmLabel="Usar reboque"
      emptyText="Sua frota não tem reboques cadastrados. Cadastre em Frota." noneOption={needsTrailer ? undefined : { title: "Sem reboque", description: "A operação segue sem reboque." }}
      viewerId={viewerId} onClose={() => setTrailerOpen(false)} onSelect={choice => setTrailerId(choice.id)} />
  </>;
}

function Detail({ p, me, now, busy, onBack, onResults, onDesignate, onCancel, onRepeat }: {
  p: Partnership; me: string; now: number; busy: boolean; onBack: () => void; onResults: () => void; onDesignate: () => void; onCancel: () => void; onRepeat: () => void;
}) {
  const role = roleIn(p, me), results = resultsOf(p), pace = paceOf(p, now), done = p.status === "completed";
  const canCancel = role === "contractor" && p.status === "pending";
  return <>
    <PageHeader onBack={onBack} title={p.operationName} eyebrow={role === "contractor" ? "Você contratou" : "Você executa"} />
    <p className="b2p-state" data-status={p.status}>{statusText(p, role)}{pace.label && !done ? <span data-tone={pace.tone}>{pace.label}</span> : null}</p>
    <article className="b2p-pact">
      <div className="b2p-route"><Logo name={p.contractorName} tone="me" companyId={p.contractorCompanyId} /><div className="b2p-track"><Pips done={p.progress} total={p.totalTrips} /><div className="b2p-track-l"><span>{p.progress} de {p.totalTrips}</span><span>{Math.max(0, p.totalTrips - p.progress)} restantes</span></div></div><Logo name={p.executorName} tone="partner" companyId={p.executorCompanyId} /></div>
      <div className="b2p-parties"><div><small>Contratante</small><b>{p.contractorName}</b></div><div><small>Executora</small><b>{p.executorName}</b></div></div>
      <dl className="b2p-sts"><div><dt>Prazo</dt><dd>{done ? "Encerrado" : remainingText(p.deadlineMs, now) || "—"}</dd></div><div><dt>Ganhos</dt><dd>{formatMoney(results.earningsCents, p.currency)}</dd></div>
        {p.goalAmountCents ? <div><dt>Meta</dt><dd className="b2p-tq">{results.goalPercent ?? 0}%</dd></div> : <div><dt>Média</dt><dd>{formatMoney(results.averageCents, p.currency)}</dd></div>}</dl>
    </article>
    {p.driverName ? <div className="b2p-drv"><div className="b2p-drv-th">{p.startPhotoUrl ? <img src={p.startPhotoUrl} alt="Foto do veículo no início" loading="lazy" /> : <Truck size={20} aria-hidden="true" />}</div>
      <div><b>{p.driverName}</b><small>{[p.vehicleName, p.trailerName].filter(Boolean).join(" · ") || "Veículo designado"}</small></div>{p.vehiclePlate ? <span className="b2p-plate">{p.vehiclePlate}</span> : null}</div> : null}
    <Spec p={p} />
    {p.conditions ? <blockquote className="b2p-quote"><small>Condições do acordo</small>{p.conditions}</blockquote> : null}
    <section className="b2p-group"><h2>Viagens confirmadas <i>{results.trips}</i></h2>
      {results.bars.length ? <div className="b2p-ledger">{p.ledger.map(entry => <div key={entry.n}><span>{entry.n}</span><b>Viagem {entry.n}</b><small>{fmt(dayTime, entry.at)}</small><em>{formatMoney(entry.cents, p.currency)}</em></div>)}</div> : <p className="b2p-none">Nenhuma viagem confirmada ainda.</p>}
    </section>
    <div className="b2p-bar">
      {role === "executor" && p.status === "accepted" && !p.jobId ? <button type="button" className="b2p-cta" onClick={onDesignate}>Designar motorista<ArrowRight size={17} aria-hidden="true" /></button> : null}
      {results.trips > 0 || done ? <button type="button" className="b2p-ghost" onClick={onResults}><Trophy size={17} aria-hidden="true" />Ver resultados</button> : null}
      {done && role === "contractor" ? <button type="button" className="b2p-cta" onClick={onRepeat}>Repetir com a {p.executorName}<Repeat size={17} aria-hidden="true" /></button> : null}
      {canCancel ? <button type="button" className="b2p-txt" data-tone="danger" disabled={busy} onClick={onCancel}>Cancelar oferta</button> : null}
    </div>
  </>;
}

function Results({ p, me, onBack }: { p: Partnership; me: string; onBack: () => void }) {
  const r = resultsOf(p), pct = r.goalPercent;
  const radius = 44, circ = 2 * Math.PI * radius, shown = pct === null ? Math.min(100, Math.round(r.trips / Math.max(1, r.totalTrips) * 100)) : Math.min(100, pct);
  return <>
    <PageHeader onBack={onBack} title="Resultados" eyebrow={p.operationName} />
    <section className="b2p-gauge"><svg width="108" height="108" viewBox="0 0 108 108" role="img" aria-label={pct === null ? `${shown}% das viagens` : `${pct}% da meta`}>
      <circle cx="54" cy="54" r={radius} className="b2p-g-bg" /><circle cx="54" cy="54" r={radius} className="b2p-g-fg" strokeDasharray={`${circ * shown / 100} ${circ}`} transform="rotate(-90 54 54)" />
      <text x="54" y="59" textAnchor="middle">{pct === null ? `${shown}%` : `${pct}%`}</text></svg>
      <div><b className="b2p-hero">{formatMoney(r.earningsCents, p.currency)}</b><small>{pct === null ? "Ganhos totais" : `Ganhos totais · meta ${formatMoney(p.goalAmountCents || 0, p.currency)}`}</small></div></section>
    <div className="b2p-mini"><div><small>Média</small><b>{formatMoney(r.averageCents, p.currency)}</b></div><div><small>Melhor viagem</small><b>{formatMoney(r.bestCents, p.currency)}</b>{r.bestN ? <em>nº {r.bestN}</em> : null}</div><div><small>Viagens</small><b>{r.trips} de {r.totalTrips}</b></div></div>
    {r.bars.length ? <section className="b2p-group"><h2>Ganhos por viagem</h2><div className="b2p-bars" role="img" aria-label="Ganhos por viagem">{r.bars.map(bar => <i key={bar.n} style={{ height: `${bar.height}%` }} data-best={bar.n === r.bestN ? "1" : "0"} title={`Viagem ${bar.n}: ${formatMoney(bar.cents, p.currency)}`} />)}</div></section> : null}
    <section className="b2p-group"><h2>Viagens <i>{r.trips}</i></h2><div className="b2p-ledger">{p.ledger.map(entry => <div key={entry.n}><span>{entry.n}</span><b>Viagem {entry.n}</b><small>{fmt(dayTime, entry.at)}</small><em>{formatMoney(entry.cents, p.currency)}</em></div>)}</div></section>
    <p className="b2p-rule"><Trophy size={16} aria-hidden="true" /><span>{p.contractorCompanyId === me ? "Estas viagens pontuaram para a sua empresa no ranking." : `Estas viagens pontuaram para ${p.contractorName} no ranking.`} {p.goalAmountCents ? "A meta é só de acompanhamento." : ""}</span></p>
  </>;
}
