import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowRight, Calendar, Camera, Check, ChevronRight, Container, Handshake, MessageSquare, Plus, Repeat, Search, Target, Trophy, Truck, UserRound, X,
} from "lucide-react";
import { useOperationalStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { usePartnerships } from "../../hooks/usePartnerships";
import { partnershipService } from "../../services/partnershipService";
import { operationalRequestId } from "../../lib/operationalRequestId";
import { isTrailerlessSimulator } from "../../lib/resolveSimulator";
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

function Logo({ name, tone }: { name: string; tone: "me" | "partner" | "muted" | "ghost" }) {
  return <span className="b2p-nd" data-tone={tone} aria-hidden="true">{tone === "ghost" ? <Plus size={18} /> : initialsOf(name)}</span>;
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

function PactCard({ p, me, now, onOpen, onRepeat, onResults }: { p: Partnership; me: string; now: number; onOpen: () => void; onRepeat?: () => void; onResults?: () => void }) {
  const role = roleIn(p, me), done = p.status === "completed";
  const pace = paceOf(p, now), results = resultsOf(p);
  const mine = role === "contractor" ? p.contractorName : p.executorName, other = role === "contractor" ? p.executorName : p.contractorName;
  return <article className="b2p-pact">
    <header>
      <span className="b2p-role" data-role={role}>{role === "contractor" ? "Você contratou" : "Você executa"}</span>
      {done ? <span className="b2p-chip" data-solid="1"><Check size={13} aria-hidden="true" />Concluída</span> : <button type="button" className="b2p-go" onClick={onOpen} aria-label={`Abrir ${p.operationName}`}><ChevronRight size={18} aria-hidden="true" /></button>}
    </header>
    {done ? <div><h3>{p.operationName}</h3><p className="b2p-sub">{other}{p.driverName ? ` · ${p.driverName}` : ""}{p.updatedAtMs ? ` · ${fmt(dayTime, p.updatedAtMs)}` : ""}</p></div>
      : <><div className="b2p-route"><Logo name={mine} tone="me" /><div className="b2p-track"><Pips done={p.progress} total={p.totalTrips} />
        <div className="b2p-track-l"><span>{p.progress} de {p.totalTrips}</span><span>{Math.max(0, p.totalTrips - p.progress)} restantes</span></div></div><Logo name={other} tone="partner" /></div>
        <div className="b2p-parties"><div><small>{role === "contractor" ? "Contratante" : "Executora"}</small><b>{mine}</b></div><div><small>{role === "contractor" ? "Executora" : "Contratante"}</small><b>{other}</b></div></div>
        <h3 className="b2p-opname">{p.operationName}</h3></>}
    <dl className="b2p-sts">
      <div><dt>Viagens</dt><dd>{p.progress}{done ? " de " : " / "}{p.totalTrips}</dd></div>
      {done ? <div><dt>Ganhos</dt><dd>{formatMoney(results.earningsCents, p.currency)}</dd></div> : <div><dt>Prazo</dt><dd>{remainingText(p.deadlineMs, now) || "—"}</dd></div>}
      {p.goalAmountCents ? <div><dt>Meta</dt><dd className="b2p-tq">{results.goalPercent ?? 0}%</dd></div> : <div><dt>Ritmo</dt><dd data-tone={pace.tone}>{pace.label || "—"}</dd></div>}
    </dl>
    {!done && pace.label && p.goalAmountCents ? <p className="b2p-pace" data-tone={pace.tone}>{pace.label}</p> : null}
    {done && role === "contractor" && onRepeat ? <button type="button" className="b2p-repeat" onClick={onRepeat}>
      <span className="b2p-lrt"><Logo name={mine} tone="me" /><span className="b2p-cn" /><Logo name={other} tone="partner" /></span>
      <span className="b2p-ltx"><b>Repetir com a {other}</b><small>Mesmas {p.totalTrips} viagens, {p.vehicleRequirement}{p.trailerRequirement ? ` e ${p.trailerRequirement}` : ""}</small></span><span className="b2p-go" data-solid="1"><ArrowRight size={16} aria-hidden="true" /></span></button> : null}
    {done && onResults ? <button type="button" className="b2p-ghost" onClick={onResults}><Trophy size={17} aria-hidden="true" />Ver resultados</button> : null}
  </article>;
}

function Ticket({ p, me, mode, onOpen, onDecline, onCancel, busy }: { p: Partnership; me: string; mode: "invite" | "sent" | "designate"; onOpen: () => void; onDecline?: () => void; onCancel?: () => void; busy: boolean }) {
  const invite = mode === "invite", designate = mode === "designate";
  const goal = p.goalAmountCents ? formatMoney(p.goalAmountCents, p.currency) : "";
  return <article className="b2p-tk" data-mode={mode}>
    <div className="b2p-tk-a">
      <div className="b2p-who"><Logo name={invite || designate ? p.contractorName : p.executorName} tone={invite || designate ? "me" : "partner"} />
        <div><span className="b2p-eyebrow" data-amber={invite || designate ? "1" : "0"}>{invite ? "Convite de parceria" : designate ? "Oferta aceita" : "Oferta enviada"}</span>
          <small>{invite || designate ? `recebido em ${fmt(dayTime, p.createdAtMs)}` : `enviada em ${fmt(dayTime, p.createdAtMs)}`}</small></div></div>
      <p className="b2p-inv">{invite || designate ? <><em>{p.contractorName}</em> convida a {p.executorName} para {p.operationName}</> : <>Você convidou a <em>{p.executorName}</em> para {p.operationName}</>}</p>
    </div>
    <div className="b2p-perf" />
    <div className="b2p-tk-b">
      <dl className="b2p-spec"><div><dt>Viagens</dt><dd>{p.totalTrips}</dd></div><div><dt>Prazo final</dt><dd>{fmt(dateTime, p.deadlineMs)}</dd></div>
        <div><dt>Veículo</dt><dd>{p.vehicleRequirement}</dd></div>{p.trailerRequirement ? <div><dt>Reboque</dt><dd>{p.trailerRequirement}</dd></div> : null}</dl>
      <p className="b2p-pt"><Target size={14} aria-hidden="true" />{goal ? <>Meta <b>{goal}</b> · </> : null}Pontua para <b>{p.contractorName}</b></p>
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
  const { activeCompanyId, companies, loadCompanyCatalog, allCompanyMembers } = useCompanyStore();
  const { vehicles, trailers, users, simulators } = useOperationalStore();
  const { rows, ready, error } = usePartnerships(activeCompanyId);
  const me = activeCompanyId || "";
  const company = companies.find(item => item.id === me);
  const [view, setView] = useState<View>({ name: "list" });
  const [tab, setTab] = useState<Tab>("all");
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const now = useMemo(() => Date.now(), [rows, view]);
  const openedFromState = useRef(false);
  useEffect(() => { void loadCompanyCatalog().catch(() => []); }, [loadCompanyCatalog]);
  useEffect(() => {
    const id = (location.state as { openId?: string } | null)?.openId;
    if (id && !openedFromState.current && rows.some(row => row.id === id)) { openedFromState.current = true; setView({ name: "detail", id }); }
  }, [location.state, rows]);

  const byId = useMemo(() => new Map(rows.map(row => [row.id, row])), [rows]);
  const visible = rows.filter(row => tab === "all" || roleIn(row, me) === tab);
  const sections = useMemo(() => {
    const groups: Record<string, Partnership[]> = { action: [], running: [], waiting: [], done: [] };
    visible.forEach(row => { const key = sectionFor(row, me); if (groups[key]) groups[key].push(row); });
    return groups;
  }, [visible, me]);
  const toAnswer = rows.filter(row => sectionFor(row, me) === "action").length;
  const active = rows.filter(row => sectionFor(row, me) === "running").length;
  const back = () => { if (view.name === "list") navigate("/admin/fleet"); else setView({ name: "list" }); };

  const partners = useMemo(() => {
    const seen = new Map<string, number>();
    rows.forEach(row => { const other = row.contractorCompanyId === me ? row.executorCompanyId : row.contractorCompanyId; seen.set(other, Math.max(seen.get(other) || 0, row.updatedAtMs)); });
    const mySim = String(company?.simulatorId || "");
    const sameSim = (item: any) => !mySim || !item.simulatorId || String(item.simulatorId) === mySim;
    const recent = [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => companies.find(item => item.id === id)).filter(Boolean) as typeof companies;
    const others = companies.filter(item => item.id !== me && sameSim(item) && !seen.has(item.id));
    return { recent, all: [...recent, ...others].filter(item => item.id !== me && sameSim(item)) };
  }, [companies, company?.simulatorId, me, rows]);

  const run = async (task: () => Promise<void>, failure: string) => {
    if (busy) return;
    setBusy(true);
    try { await task(); } catch (reason) { toast.error(partnershipErrorMessage(reason, failure)); } finally { setBusy(false); }
  };
  const respond = (p: Partnership, decision: "accept" | "decline") => run(async () => {
    await partnershipService.respond(p.id, decision);
    if (decision === "accept") { toast.success("Oferta aceita. Agora designe um motorista."); setView({ name: "designate", id: p.id }); }
    else { toast.message("Oferta recusada."); setView({ name: "list" }); }
  }, "Não foi possível responder a oferta.");
  const cancel = (p: Partnership) => run(async () => { await partnershipService.cancel(p.id); toast.message("Oferta cancelada."); setView({ name: "list" }); }, "Não foi possível cancelar a oferta.");

  if (!me) return <div className="nvu-b2p"><PageHeader onBack={() => navigate("/admin/fleet")} /><p className="b2p-empty">Selecione uma empresa para ver as parcerias.</p></div>;
  const current = "id" in view ? byId.get(view.id) : undefined;

  if (view.name === "new") return <div className="nvu-b2p"><NewOffer key={view.from?.id || view.partnerId || "new"} me={me} company={company} partners={partners.all} initial={view} vehicles={vehicles as any[]} trailers={trailers as any[]} simulators={simulators as any[]}
    onBack={() => setView({ name: "list" })} onSent={() => { toast.success("Oferta enviada."); setView({ name: "list" }); }} /></div>;
  if ("id" in view && !current) return <div className="nvu-b2p"><PageHeader onBack={() => setView({ name: "list" })} />{ready ? <p className="b2p-empty">Esta parceria não está mais disponível.</p> : <p className="b2p-empty">Carregando…</p>}</div>;
  if (view.name === "offer" && current) return <div className="nvu-b2p"><OfferDetail p={current} busy={busy} onBack={() => setView({ name: "list" })} onAccept={() => respond(current, "accept")} onDecline={() => respond(current, "decline")} /></div>;
  if (view.name === "designate" && current) return <div className="nvu-b2p"><Designate p={current} me={me} users={users as any[]} members={allCompanyMembers as any[]} vehicles={vehicles as any[]} trailers={trailers as any[]}
    onBack={() => setView({ name: "list" })} onDone={() => { toast.success("Motorista designado. A operação já aparece para ele."); setView({ name: "detail", id: current.id }); }} /></div>;
  if (view.name === "results" && current) return <div className="nvu-b2p"><Results p={current} me={me} onBack={() => setView({ name: "detail", id: current.id })} /></div>;
  if (view.name === "detail" && current) return <div className="nvu-b2p"><Detail p={current} me={me} now={now} busy={busy} onBack={() => setView({ name: "list" })}
    onResults={() => setView({ name: "results", id: current.id })} onDesignate={() => setView({ name: "designate", id: current.id })} onCancel={() => cancel(current)}
    onRepeat={() => setView({ name: "new", from: current })} /></div>;

  const empty = ready && rows.length === 0;
  return <div className="nvu-b2p">
    <PageHeader onBack={back} />
    {error ? <p className="b2p-alert" role="alert">Não foi possível atualizar as parcerias agora. Os dados podem estar desatualizados.</p> : null}
    <button type="button" className="b2p-launch" data-slim={rows.length > 1 ? "1" : "0"} onClick={() => setView({ name: "new" })}>
      <span className="b2p-lrt"><Logo name={company?.companyName || "Eu"} tone="me" /><span className="b2p-cn" /><Logo name="" tone="ghost" /></span>
      <span className="b2p-ltx"><b>Propor operação</b>{rows.length <= 1 ? <small>Convide uma empresa parceira para executar viagens por você</small> : null}</span>
      <span className="b2p-go" data-solid="1"><ArrowRight size={18} aria-hidden="true" /></span>
    </button>
    {partners.all.length ? <section aria-label="Enviar rápido">
      <div className="b2p-line"><span data-on="1">Enviar rápido para</span><div /></div>
      <div className="b2p-rail">
        {(partners.recent.length ? partners.recent : partners.all).slice(0, 3).map(item => <button type="button" className="b2p-rail-it" key={item.id} onClick={() => setView({ name: "new", partnerId: item.id })}>
          <Logo name={item.companyName} tone={partners.recent.some(r => r.id === item.id) ? "partner" : "muted"} /><b>{item.companyName}</b><small>{item.simulatorName}</small></button>)}
        <button type="button" className="b2p-rail-it" onClick={() => setPicker(true)}><Logo name="" tone="ghost" /><b>Ver todas</b></button>
      </div></section> : null}
    {rows.length ? <>
      {toAnswer || active ? <p className="b2p-strip">{toAnswer ? <><b data-amber="1">{toAnswer}</b>&nbsp;{toAnswer === 1 ? "para responder" : "para responder"}<span className="b2p-sep" /></> : null}<b>{active}</b>&nbsp;{active === 1 ? "ativa" : "ativas"}</p> : null}
      <div className="b2p-tabs" role="tablist">{([["all", "Todas"], ["contractor", "Contratei"], ["executor", "Executo"]] as const).map(([key, label]) =>
        <button type="button" role="tab" aria-selected={tab === key} data-on={tab === key ? "1" : "0"} key={key} onClick={() => setTab(key)}>{label}</button>)}</div>
      {sections.action.length ? <><SectionLine label="Precisa da sua ação" count={sections.action.length} tone="warn" />
        {sections.action.map(p => p.status === "pending" ? <Ticket key={p.id} p={p} me={me} mode="invite" busy={busy} onOpen={() => setView({ name: "offer", id: p.id })} onDecline={() => respond(p, "decline")} />
          : <Ticket key={p.id} p={p} me={me} mode="designate" busy={busy} onOpen={() => setView({ name: "designate", id: p.id })} />)}</> : null}
      <SectionLine label="Em andamento" count={sections.running.length} />
      {sections.running.length ? sections.running.map(p => <PactCard key={p.id} p={p} me={me} now={now} onOpen={() => setView({ name: "detail", id: p.id })} />) : <p className="b2p-none">Nenhuma operação em andamento.</p>}
      {sections.waiting.length ? <><SectionLine label="Aguardando resposta" count={sections.waiting.length} />
        {sections.waiting.map(p => <Ticket key={p.id} p={p} me={me} mode="sent" busy={busy} onOpen={() => setView({ name: "detail", id: p.id })} onCancel={p.status === "pending" && p.contractorCompanyId === me ? () => cancel(p) : undefined} />)}</> : null}
      {sections.done.length ? <><SectionLine label="Concluídas" count={sections.done.length} />
        {sections.done.map(p => <PactCard key={p.id} p={p} me={me} now={now} onOpen={() => setView({ name: "detail", id: p.id })} onResults={() => setView({ name: "results", id: p.id })}
          onRepeat={() => setView({ name: "new", from: p })} />)}</> : null}
    </> : empty ? <p className="b2p-empty">Nenhuma parceria ainda. Toque em <b>Propor operação</b> para convidar uma empresa parceira.</p> : !ready ? <p className="b2p-empty">Carregando parcerias…</p> : null}
    {picker ? <PartnerPicker partners={partners.all} onClose={() => setPicker(false)} onPick={id => { setPicker(false); setView({ name: "new", partnerId: id }); }} /> : null}
  </div>;
}

function PartnerPicker({ partners, onClose, onPick, selectedId }: { partners: any[]; onClose: () => void; onPick: (id: string) => void; selectedId?: string }) {
  const [query, setQuery] = useState("");
  const list = partners.filter(item => !query.trim() || String(item.companyName).toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="b2p-sheet-bd" role="presentation" onClick={onClose}>
    <section className="b2p-sheet" role="dialog" aria-modal="true" aria-label="Escolher empresa parceira" onClick={event => event.stopPropagation()}>
      <div className="b2p-grab" aria-hidden="true" />
      <label className="b2p-srch"><Search size={17} aria-hidden="true" /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar empresa" /></label>
      <div className="b2p-plist">{list.length ? list.map(item => <button type="button" key={item.id} className="b2p-cp" data-on={item.id === selectedId ? "1" : "0"} onClick={() => onPick(item.id)}>
        <Logo name={item.companyName} tone="partner" /><span><b>{item.companyName}</b><small>{item.simulatorName}</small></span>{item.id === selectedId ? <Check size={16} aria-hidden="true" /> : null}</button>)
        : <p className="b2p-none">Nenhuma empresa encontrada.</p>}</div>
    </section></div>;
}

function Row({ icon, label, children, tall }: { icon: React.ReactNode; label: string; children: React.ReactNode; tall?: boolean }) {
  return <label className="b2p-fr" data-tall={tall ? "1" : "0"}><span className="b2p-fr-ic" aria-hidden="true">{icon}</span><span className="b2p-fr-k">{label}</span><span className="b2p-fr-v">{children}</span></label>;
}

function NewOffer({ me, company, partners, initial, vehicles, trailers, simulators, onBack, onSent }: {
  me: string; company: any; partners: any[]; initial: { partnerId?: string; from?: Partnership }; vehicles: any[]; trailers: any[]; simulators: any[]; onBack: () => void; onSent: () => void;
}) {
  const from = initial.from;
  const [draft, setDraft] = useState<OfferDraft>(() => from ? { ...emptyDraft(from.executorCompanyId), operationName: from.operationName, totalTrips: String(from.totalTrips),
    vehicleRequirement: from.vehicleRequirement, trailerRequirement: from.trailerRequirement || "", conditions: from.conditions, goal: from.goalAmountCents ? String(from.goalAmountCents / 100).replace(".", ",") : "" } : emptyDraft(initial.partnerId || ""));
  const [picker, setPicker] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const requestId = useRef(operationalRequestId());
  const partner = partners.find(item => item.id === draft.executorCompanyId);
  const trailerless = isTrailerlessSimulator(company, simulators as unknown[]);
  const set = (patch: Partial<OfferDraft>) => { setDraft(current => ({ ...current, ...patch })); setError(""); };
  const submit = async () => {
    const message = validateDraft(draft, Date.now(), trailerless);
    if (message) { setError(message); return; }
    setBusy(true); setError("");
    try {
      await partnershipService.createOffer({ contractorCompanyId: me, executorCompanyId: draft.executorCompanyId, operationName: draft.operationName.trim(), totalTrips: Number(draft.totalTrips),
        vehicleRequirement: draft.vehicleRequirement.trim(), trailerRequirement: trailerless ? null : draft.trailerRequirement.trim() || null,
        deadlineAt: new Date(draft.deadlineAt).toISOString(), conditions: draft.conditions.trim(), goalAmountCents: draft.goal.trim() ? parseMoneyToCents(draft.goal) : null, requestId: requestId.current });
      onSent();
    } catch (reason) { setError(partnershipErrorMessage(reason, "Não foi possível enviar a oferta.")); setBusy(false); }
  };
  return <>
    <PageHeader onBack={onBack} title="Nova oferta" eyebrow="Parcerias B2P" />
    <section className="b2p-group"><h2>Para quem</h2>
      <button type="button" className="b2p-dest" onClick={() => setPicker(true)}>
        <Logo name={partner?.companyName || ""} tone={partner ? "partner" : "ghost"} />
        <span><b>{partner?.companyName || "Escolher empresa parceira"}</b><small>{partner ? `Mesmo simulador · ${partner.simulatorName}` : "Só aparecem empresas do mesmo simulador"}</small></span><ChevronRight size={18} aria-hidden="true" /></button></section>
    <section className="b2p-group"><h2>A operação</h2><div className="b2p-fg">
      <Row icon={<Handshake size={18} />} label="Nome"><input value={draft.operationName} maxLength={60} onChange={event => set({ operationName: event.target.value })} placeholder="Ex.: Operação 031" /></Row>
      <Row icon={<Repeat size={18} />} label="Viagens"><input inputMode="numeric" value={draft.totalTrips} onChange={event => set({ totalTrips: event.target.value.replace(/\D/g, "").slice(0, 3) })} placeholder="20" /></Row>
    </div></section>
    <section className="b2p-group"><h2>Exigências e prazo</h2><div className="b2p-fg">
      <Row icon={<Truck size={18} />} label="Veículo"><input list="b2p-vehicles" value={draft.vehicleRequirement} maxLength={80} onChange={event => set({ vehicleRequirement: event.target.value })} placeholder="Ex.: Volvo FH" /></Row>
      {!trailerless ? <Row icon={<Container size={18} />} label="Reboque"><input list="b2p-trailers" value={draft.trailerRequirement} maxLength={80} onChange={event => set({ trailerRequirement: event.target.value })} placeholder="Opcional" /></Row> : null}
      <Row icon={<Calendar size={18} />} label="Prazo final"><input type="datetime-local" value={draft.deadlineAt} onChange={event => set({ deadlineAt: event.target.value })} /></Row>
    </div>
    <datalist id="b2p-vehicles">{[...new Set(vehicles.map(item => String(item.name)))].map(name => <option key={name} value={name} />)}</datalist>
    <datalist id="b2p-trailers">{[...new Set(trailers.map(item => String(item.name)))].map(name => <option key={name} value={name} />)}</datalist></section>
    <section className="b2p-group"><h2>Condições</h2><div className="b2p-fg">
      <Row icon={<MessageSquare size={18} />} label="Acordo" tall><textarea value={draft.conditions} maxLength={MAX_CONDITIONS} rows={3} onChange={event => set({ conditions: event.target.value })} placeholder="Opcional · combinados entre as empresas" /></Row>
      <Row icon={<Target size={18} />} label={`Meta (${(company?.currency || "R$") === "BRL" ? "R$" : "R$"})`}><input inputMode="decimal" value={draft.goal} onChange={event => set({ goal: event.target.value })} placeholder="Opcional · só acompanhamento" /></Row>
    </div><small className="b2p-hint">{draft.conditions.length}/{MAX_CONDITIONS} · A meta é só para acompanhar os ganhos. O NVU não cobra nem paga nada entre as empresas.</small></section>
    {error ? <p className="b2p-alert" role="alert">{error}</p> : null}
    <div className="b2p-bar"><button type="button" className="b2p-cta" disabled={busy} onClick={() => void submit()}>{busy ? "Enviando…" : "Enviar oferta"}<ArrowRight size={17} aria-hidden="true" /></button></div>
    {picker ? <PartnerPicker partners={partners} selectedId={draft.executorCompanyId} onClose={() => setPicker(false)} onPick={id => { set({ executorCompanyId: id }); setPicker(false); }} /> : null}
  </>;
}

function OfferDetail({ p, busy, onBack, onAccept, onDecline }: { p: Partnership; busy: boolean; onBack: () => void; onAccept: () => void; onDecline: () => void }) {
  const open = p.status === "pending";
  return <>
    <PageHeader onBack={onBack} title="Oferta recebida" eyebrow="Parcerias B2P" />
    <article className="b2p-pact"><header><span className="b2p-role" data-role="executor">{p.contractorName}</span><span className="b2p-sub">{fmt(dayTime, p.createdAtMs)}</span></header>
      <div><h3>{p.operationName}</h3><p className="b2p-sub">{p.contractorName} convida a {p.executorName}</p></div>
      <dl className="b2p-spec"><div><dt>Viagens</dt><dd>{p.totalTrips}</dd></div><div><dt>Prazo final</dt><dd>{fmt(dateTime, p.deadlineMs)}</dd></div>
        <div><dt>Veículo</dt><dd>{p.vehicleRequirement}</dd></div>{p.trailerRequirement ? <div><dt>Reboque</dt><dd>{p.trailerRequirement}</dd></div> : null}
        {p.goalAmountCents ? <div><dt>Meta de ganhos</dt><dd>{formatMoney(p.goalAmountCents, p.currency)}</dd></div> : null}</dl>
      {p.conditions ? <blockquote className="b2p-quote"><small>Condições do acordo</small>{p.conditions}</blockquote> : null}
    </article>
    <p className="b2p-rule"><Trophy size={16} aria-hidden="true" /><span>As viagens confirmadas pontuam para <b>{p.contractorName}</b> no ranking de empresas. Você acompanha o andamento e o motorista mantém o histórico dele.</span></p>
    {open ? <div className="b2p-bar"><button type="button" className="b2p-cta" disabled={busy} onClick={onAccept}>{busy ? "Enviando…" : "Aceitar oferta"}<Check size={17} aria-hidden="true" /></button>
      <button type="button" className="b2p-txt" data-tone="danger" disabled={busy} onClick={onDecline}>Recusar</button></div> : <p className="b2p-none">Esta oferta já foi respondida ({p.status === "declined" ? "recusada" : p.status === "cancelled" ? "cancelada" : "aceita"}).</p>}
  </>;
}

function Designate({ p, me, users, members, vehicles, trailers, onBack, onDone }: { p: Partnership; me: string; users: any[]; members: any[]; vehicles: any[]; trailers: any[]; onBack: () => void; onDone: () => void }) {
  const drivers = useMemo(() => users.filter(user => user.status === "active" && members?.some(member => member.userId === user.id && member.companyId === me && member.status === "active" && member.roles?.includes("driver")))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" })), [users, members, me]);
  const ownVehicles = vehicles.filter(item => !item.companyId || item.companyId === me), ownTrailers = trailers.filter(item => !item.companyId || item.companyId === me);
  const [driverId, setDriverId] = useState(""), [vehicleId, setVehicleId] = useState(""), [trailerId, setTrailerId] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const vehicleOk = ownVehicles.filter(item => matchesRequirement(p.vehicleRequirement, String(item.name)));
  const trailerOk = p.trailerRequirement ? ownTrailers.filter(item => matchesRequirement(p.trailerRequirement, String(item.name))) : [];
  const ready = Boolean(driverId && vehicleId && (!p.trailerRequirement || trailerId));
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setError("");
    try { await partnershipService.designateDriver({ partnershipId: p.id, driverId, vehicleId, trailerId: p.trailerRequirement ? trailerId : null }); onDone(); }
    catch (reason) { setError(partnershipErrorMessage(reason, "Não foi possível designar o motorista.")); setBusy(false); }
  };
  if (p.jobId) return <><PageHeader onBack={onBack} title="Designar trabalho" eyebrow="Parcerias B2P" /><p className="b2p-empty">O motorista <b>{p.driverName || "da equipe"}</b> já foi designado para esta operação.</p></>;
  return <>
    <PageHeader onBack={onBack} title="Designar trabalho" eyebrow="Parcerias B2P" />
    <p className="b2p-sub">{p.operationName} · {p.totalTrips} viagens · até {fmt(dateTime, p.deadlineMs)}</p>
    <section className="b2p-group"><h2>Motorista da sua equipe</h2><div className="b2p-opts">
      {drivers.length ? drivers.map(user => <button type="button" key={user.id} className="b2p-opt" data-on={driverId === user.id ? "1" : "0"} onClick={() => setDriverId(user.id)}>
        <UserRound size={18} aria-hidden="true" /><span><b>{user.name}</b></span><i aria-hidden="true">{driverId === user.id ? <Check size={14} /> : null}</i></button>) : <p className="b2p-none">Nenhum motorista ativo na equipe.</p>}
    </div></section>
    <section className="b2p-group"><h2>Veículo · exigido: {p.vehicleRequirement}</h2><div className="b2p-opts">
      {vehicleOk.length ? vehicleOk.map(item => <button type="button" key={item.id} className="b2p-opt" data-on={vehicleId === item.id ? "1" : "0"} onClick={() => setVehicleId(item.id)}>
        <Truck size={18} aria-hidden="true" /><span><b>{item.name}</b></span><i aria-hidden="true">{vehicleId === item.id ? <Check size={14} /> : null}</i></button>) : <p className="b2p-none">Sua frota não tem “{p.vehicleRequirement}”. Cadastre o veículo em Frota.</p>}
    </div></section>
    {p.trailerRequirement ? <section className="b2p-group"><h2>Reboque · exigido: {p.trailerRequirement}</h2><div className="b2p-opts">
      {trailerOk.length ? trailerOk.map(item => <button type="button" key={item.id} className="b2p-opt" data-on={trailerId === item.id ? "1" : "0"} onClick={() => setTrailerId(item.id)}>
        <Container size={18} aria-hidden="true" /><span><b>{item.name}</b></span><i aria-hidden="true">{trailerId === item.id ? <Check size={14} /> : null}</i></button>) : <p className="b2p-none">Sua frota não tem “{p.trailerRequirement}”. Cadastre o reboque em Frota.</p>}
    </div></section> : null}
    <p className="b2p-rule"><Camera size={16} aria-hidden="true" /><span>Para iniciar, o motorista precisa anexar a foto do veículo. Ele continua vinculado à sua empresa.</span></p>
    {error ? <p className="b2p-alert" role="alert">{error}</p> : null}
    <div className="b2p-bar"><button type="button" className="b2p-cta" disabled={!ready || busy} onClick={() => void submit()}>{busy ? "Designando…" : "Designar motorista"}<ArrowRight size={17} aria-hidden="true" /></button></div>
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
      <div className="b2p-route"><Logo name={p.contractorName} tone="me" /><div className="b2p-track"><Pips done={p.progress} total={p.totalTrips} /><div className="b2p-track-l"><span>{p.progress} de {p.totalTrips}</span><span>{Math.max(0, p.totalTrips - p.progress)} restantes</span></div></div><Logo name={p.executorName} tone="partner" /></div>
      <div className="b2p-parties"><div><small>Contratante</small><b>{p.contractorName}</b></div><div><small>Executora</small><b>{p.executorName}</b></div></div>
      <dl className="b2p-sts"><div><dt>Prazo</dt><dd>{done ? "Encerrado" : remainingText(p.deadlineMs, now) || "—"}</dd></div><div><dt>Ganhos</dt><dd>{formatMoney(results.earningsCents, p.currency)}</dd></div>
        {p.goalAmountCents ? <div><dt>Meta</dt><dd className="b2p-tq">{results.goalPercent ?? 0}%</dd></div> : <div><dt>Média</dt><dd>{formatMoney(results.averageCents, p.currency)}</dd></div>}</dl>
    </article>
    {p.driverName ? <div className="b2p-drv"><div className="b2p-drv-th">{p.startPhotoUrl ? <img src={p.startPhotoUrl} alt="Foto do veículo no início" loading="lazy" /> : <Truck size={20} aria-hidden="true" />}</div>
      <div><b>{p.driverName}</b><small>{[p.vehicleName, p.trailerName].filter(Boolean).join(" · ") || "Veículo designado"}</small></div>{p.vehiclePlate ? <span className="b2p-plate">{p.vehiclePlate}</span> : null}</div> : null}
    <dl className="b2p-spec"><div><dt>Veículo exigido</dt><dd>{p.vehicleRequirement}</dd></div>{p.trailerRequirement ? <div><dt>Reboque exigido</dt><dd>{p.trailerRequirement}</dd></div> : null}
      <div><dt>Prazo final</dt><dd>{fmt(dateTime, p.deadlineMs)}</dd></div>{p.goalAmountCents ? <div><dt>Meta de ganhos</dt><dd>{formatMoney(p.goalAmountCents, p.currency)}</dd></div> : null}</dl>
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
