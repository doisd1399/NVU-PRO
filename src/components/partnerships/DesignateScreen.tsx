import React, { useContext, useMemo, useState } from "react";
import { Camera, Check, ChevronRight, Container, Truck } from "lucide-react";
import { AssignmentOptionPicker, type PickerOption } from "../admin/AssignmentOptionPicker";
import { StableImage } from "../common/StableImage";
import AssignJobAssetPicker from "../admin/AssignJobAssetPicker";
import { partnershipService } from "../../services/partnershipService";
import { isTrailerlessSimulator } from "../../lib/resolveSimulator";
import { resolveDriverPhoto } from "../../lib/resolveDriverPhoto";
import { countFleetAssetUsage } from "../../lib/fleetUsage";
import { formatDays, formatMoney, lastVehicleOf, matchesRequirement, partnershipErrorMessage, remainingText, type Partnership } from "../../lib/partnerships";
import { BackLink, LogoContext } from "./shared";

const OPEN_JOB = ["pending", "active", "delayed", "awaiting_completion"];
const usageText = (count: number | null | undefined) => count == null ? "Vínculos em consulta" : count === 0 ? "Sem motoristas vinculados" : `Em uso por ${count} motorista${count === 1 ? "" : "s"}`;

/** Designar trabalho (executora): motorista da própria equipe, veículo (lista da Central) e reboque (só se exigido ou desejado). */
export function DesignateScreen({ p, me, ownCompany, users, members, membersReady, vehicles, trailers, sequences, jobs, contracts, simulators, onBack, onDone }: {
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
  const [vehicleOpen, setVehicleOpen] = useState(false), [trailerOpen, setTrailerOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const vehicle = ownVehicles.find(item => item.id === vehicleId);
  const needsTrailer = Boolean(p.trailerRequirement) && !trailerless;
  const fits = (name: string) => !p.trailerRequirement || matchesRequirement(p.trailerRequirement, name);
  const trailerChoices = ownTrailers.filter(item => !needsTrailer || fits(String(item.name)));
  const trailer = ownTrailers.find(item => item.id === trailerId);
  const trailerOptions = useMemo<PickerOption[]>(() => ownTrailers.map(item => ({
    id: item.id, title: String(item.name), avatar: { icon: <Container size={22} strokeWidth={1.65} /> }, disabled: !fits(String(item.name)),
    description: p.trailerRequirement ? (fits(String(item.name)) ? "Atende a exigência da oferta" : undefined) : "Da sua frota", disabledReason: `Não atende a exigência: ${p.trailerRequirement}`,
    tag: p.trailerRequirement && fits(String(item.name)) ? { label: "Compatível", tone: "good" as const } : undefined,
  })).sort((a, b) => Number(Boolean(a.disabled)) - Number(Boolean(b.disabled)) || a.title.localeCompare(b.title, "pt-BR", { numeric: true })), [ownTrailers, p.trailerRequirement]); // eslint-disable-line react-hooks/exhaustive-deps
  const suggested = useMemo(() => {
    const id = driverId ? lastVehicleOf(jobs, driverId, new Set(ownVehicles.map(item => item.id))) : null;
    return id && id !== vehicleId ? ownVehicles.find(item => item.id === id) : undefined;
  }, [jobs, driverId, ownVehicles, vehicleId]);
  const ready = Boolean(driverId && vehicleId && (!needsTrailer || trailerId));
  const missing = !driverId ? "Escolha o motorista." : !vehicleId ? "Escolha o veículo." : needsTrailer && !trailerId ? `Escolha o reboque (${p.trailerRequirement}).` : "";

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setError("");
    try { await partnershipService.designateDriver({ partnershipId: p.id, driverId, vehicleId, trailerId: trailerless ? null : trailerId || null }); onDone(); }
    catch (reason) { setError(partnershipErrorMessage(reason, "Não foi possível designar o motorista.")); setBusy(false); }
  };

  if (p.jobId) return <><BackLink label="Parcerias" onClick={onBack} /><p className="b2p-empty">O motorista <b>{p.driverName || "da equipe"}</b> já foi designado para esta operação.</p></>;

  return <>
    <BackLink label="Parcerias" onClick={onBack} />
    <section className="nvu-central-section b2p-sec"><div className="b2p-form">
      <h2>Designar trabalho</h2>
      <div className="b2p-note-box"><b>{p.operationName}</b> · para {p.contractorName}<br />{p.totalTrips} viagens · {p.durationDays ? formatDays(p.durationDays) : "—"}{p.agreedAmountCents ? ` · ${formatMoney(p.agreedAmountCents, p.currency)}` : ""}
        {p.deadlineMs ? <><br />Prazo final: faltam {remainingText(p.deadlineMs, Date.now()) || "—"}</> : null}{p.conditions ? <><br />Condições: {p.conditions}</> : null}</div>

      <div className="b2p-field"><span className="b2p-label">Motorista da sua equipe</span>
        <div className="b2p-picklist" role="radiogroup" aria-label="Motorista">
          {drivers.map(({ user, open }) => <button type="button" role="radio" aria-checked={driverId === user.id} key={user.id} className="b2p-pick" data-on={driverId === user.id ? "1" : "0"} onClick={() => setDriverId(user.id)}>
            <StableImage src={resolveDriverPhoto(user)} alt="" loading="lazy" decoding="async" wrapperClassName="nvu-central-avatar" className="object-cover" referrerPolicy="no-referrer"
              persistentViewerId={viewerId} persistentAssetId={`designate-avatar:${me}:${user.id}`} fallback={<span>{String(user.name || "").slice(0, 2).toUpperCase()}</span>} />
            <span><b>{user.name}</b><small data-busy={open ? "1" : "0"}>{open ? `${open} trabalho${open === 1 ? "" : "s"} aberto${open === 1 ? "" : "s"}` : "Disponível"}</small></span>
            <i className="b2p-radio" aria-hidden="true">{driverId === user.id ? <Check size={12} /> : null}</i></button>)}
          {!drivers.length ? <p className="b2p-empty">{!membersReady ? "Consultando os motoristas da empresa…" : "Nenhum motorista ativo na sua equipe."}</p> : null}
        </div></div>

      <div className="b2p-field"><span className="b2p-label">Veículo da sua frota</span>
        <button type="button" className="b2p-input" onClick={() => setVehicleOpen(true)} aria-haspopup="dialog">
          <Truck size={18} aria-hidden="true" /><span style={{ flex: 1 }}>{vehicle ? vehicle.name : "Escolher veículo"}</span><ChevronRight size={18} aria-hidden="true" /></button>
        <span className="b2p-hint">{vehicle ? usageText(vehicleUsage.get(vehicle.id)) : ownVehicles.length ? "Quem escolhe o veículo é a sua empresa." : "Sua frota ainda não tem veículos (cadastre em Frota)."}</span>
        {suggested ? <button type="button" className="b2p-btn" data-v="text" data-size="sm" style={{ alignSelf: "flex-start" }} onClick={() => setVehicleId(suggested.id)}>Usar o último de {String(drivers.find(d => d.user.id === driverId)?.user.name || "").split(" ")[0]}: {suggested.name}</button> : null}
      </div>

      {!trailerless ? <div className="b2p-field"><span className="b2p-label">Reboque {needsTrailer ? <i>(exigido: {p.trailerRequirement})</i> : <i>(opcional)</i>}</span>
        <button type="button" className="b2p-input" onClick={() => setTrailerOpen(true)} aria-haspopup="dialog">
          <Container size={18} aria-hidden="true" /><span style={{ flex: 1, color: trailer ? undefined : "var(--central-muted)" }}>{trailer ? trailer.name : "Escolher reboque"}</span><ChevronRight size={18} aria-hidden="true" /></button>
        {needsTrailer && !trailerChoices.length ? <span className="b2p-hint">Sua frota não tem reboque “{p.trailerRequirement}”. Cadastre em Frota para poder aceitar esta operação.</span> : null}</div> : null}

      <p className="b2p-note-box"><Camera size={14} aria-hidden="true" style={{ verticalAlign: -2 }} /> Para iniciar, o motorista anexa a <b>foto do veículo</b>. Ele continua vinculado à sua empresa e a pontuação vai para {p.contractorName}.</p>
      {error ? <p className="b2p-alert" role="alert">{error}</p> : missing ? <p className="b2p-hint">{missing}</p> : null}
      <div className="b2p-actions">
        <button type="button" className="b2p-btn" data-v="primary" disabled={!ready || busy} onClick={() => void submit()}>{busy ? "Designando…" : "Designar motorista"}</button>
        <button type="button" className="b2p-btn" data-v="ghost" onClick={onBack}>Cancelar</button>
      </div>
    </div></section>
    <AssignmentOptionPicker open={trailerOpen} title="Escolher reboque" subtitle={p.trailerRequirement ? `A oferta exige: ${p.trailerRequirement}.` : "Reboque opcional para esta operação."} icon={<Container size={26} strokeWidth={1.65} />}
      searchPlaceholder="Buscar reboque..." options={trailerOptions} selectedId={trailerId} counter={{ one: "1 reboque selecionado", none: "Nenhum reboque selecionado" }} confirmLabel="Usar reboque"
      emptyText="Sua frota não tem reboques cadastrados. Cadastre em Frota." noneOption={needsTrailer ? undefined : { title: "Sem reboque", description: "A operação segue sem reboque." }}
      viewerId={viewerId} onClose={() => setTrailerOpen(false)} onSelect={choice => setTrailerId(choice.id)} />
    <AssignJobAssetPicker kind="vehicle" open={vehicleOpen} selectedId={vehicleId} vehicles={ownVehicles} sequences={sequences} vehicleUsageById={vehicleUsage} onClose={() => setVehicleOpen(false)} onSelect={setVehicleId} />
  </>;
}
