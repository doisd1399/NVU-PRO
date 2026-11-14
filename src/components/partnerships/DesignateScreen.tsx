import React, { useContext, useMemo, useState } from "react";
import { Camera, Check, ChevronRight, Truck } from "lucide-react";
import { StableImage } from "../common/StableImage";
import AssignJobAssetPicker from "../admin/AssignJobAssetPicker";
import { partnershipService } from "../../services/partnershipService";
import { resolveDriverPhoto } from "../../lib/resolveDriverPhoto";
import { countFleetAssetUsage } from "../../lib/fleetUsage";
import { formatDays, formatMoney, lastVehicleOf, partnershipErrorMessage, remainingText, shortName, type Partnership } from "../../lib/partnerships";
import { BackLink, LogoContext } from "./shared";

const OPEN_JOB = ["pending", "active", "delayed", "awaiting_completion"];
const RUNNING_JOB = ["active", "delayed", "awaiting_completion"];
const usageText = (count: number | null | undefined) => count == null ? "Vínculos em consulta" : count === 0 ? "Sem motoristas vinculados" : `Em uso por ${count} motorista${count === 1 ? "" : "s"}`;

/**
 * Designar trabalho (executora): motorista da própria equipe e veículo da própria frota. O reboque é da CONTRATANTE (definido na oferta):
 * a executora não escolhe. Se o motorista já tem operação em andamento, a executora decide: manter (a parceria entra na fila) ou cancelar
 * a atual para a da parceria entrar (as viagens já registradas ficam preservadas).
 */
export function DesignateScreen({ p, me, users, members, membersReady, vehicles, sequences, jobs, contracts, onBack, onDone }: {
  p: Partnership; me: string; ownCompany?: any; users: any[]; members: any[]; membersReady: boolean; vehicles: any[]; trailers?: any[]; sequences: any[]; jobs: any[]; contracts: any[]; simulators?: any[];
  onBack: () => void; onDone: () => void;
}) {
  const { viewerId } = useContext(LogoContext);
  const drivers = useMemo(() => users.filter(user => user.status === "active" && members?.some(member => member.userId === user.id && member.companyId === me && member.status === "active" && member.roles?.includes("driver")))
    .map(user => ({ user, open: jobs.filter(job => job.companyId === me && job.driverId === user.id && OPEN_JOB.includes(String(job.status))).length }))
    .sort((a, b) => String(a.user.name).localeCompare(String(b.user.name), "pt-BR", { sensitivity: "base" })), [users, members, jobs, me]);
  const ownVehicles = useMemo(() => vehicles.filter(item => !item.companyId || item.companyId === me), [vehicles, me]);
  const vehicleUsage = useMemo(() => {
    const usage = new Map<string, number | null>();
    for (const vehicle of ownVehicles) usage.set(vehicle.id, membersReady ? countFleetAssetUsage({ jobs, members, contracts, assetId: vehicle.id, kind: "vehicle", companyId: me }) : null);
    return usage;
  }, [ownVehicles, jobs, members, membersReady, contracts, me]);

  const [driverId, setDriverId] = useState(""), [vehicleId, setVehicleId] = useState(""), [runningChoice, setRunningChoice] = useState<"" | "keep" | "cancel">("");
  const [vehicleOpen, setVehicleOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const vehicle = ownVehicles.find(item => item.id === vehicleId);
  const running = useMemo(() => driverId ? jobs.filter(job => job.companyId === me && job.driverId === driverId && RUNNING_JOB.includes(String(job.status))) : [], [jobs, driverId, me]);
  const runningName = running[0] ? String(running[0].contractNameSnapshot || running[0].contractName || "Operação atual") : "";
  const suggested = useMemo(() => {
    const id = driverId ? lastVehicleOf(jobs, driverId, new Set(ownVehicles.map(item => item.id))) : null;
    return id && id !== vehicleId ? ownVehicles.find(item => item.id === id) : undefined;
  }, [jobs, driverId, ownVehicles, vehicleId]);
  const ready = Boolean(driverId && vehicleId && (!running.length || runningChoice));
  const missing = !driverId ? "Escolha o motorista." : !vehicleId ? "Escolha o veículo." : running.length && !runningChoice ? "Escolha o que fazer com a operação em andamento." : "";

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setError("");
    try { await partnershipService.designateDriver({ partnershipId: p.id, driverId, vehicleId, cancelRunning: runningChoice === "cancel" }); onDone(); }
    catch (reason) { setError(partnershipErrorMessage(reason, "Não foi possível designar o motorista.")); setBusy(false); }
  };

  if (p.jobId) return <><BackLink label="Parcerias" onClick={onBack} /><p className="b2p-empty">O motorista <b>{p.driverName || "da equipe"}</b> já foi designado para esta operação.</p></>;

  return <>
    <BackLink label="Parcerias" onClick={onBack} />
    <section className="nvu-central-section b2p-sec"><div className="b2p-form">
      <div className="b2p-note-box"><b>{p.operationName}</b> · para {shortName(p.contractorName)}<br />{p.totalTrips} viagens · {p.durationDays ? formatDays(p.durationDays) : "—"}{p.agreedAmountCents ? ` · ${formatMoney(p.agreedAmountCents, p.currency)}` : ""}
        {p.trailerRequirement ? <><br />Reboque (definido pela contratante): {p.trailerRequirement}</> : null}
        {p.deadlineMs ? <><br />Prazo final: faltam {remainingText(p.deadlineMs, Date.now()) || "—"}</> : null}{p.conditions ? <><br />Condições: {p.conditions}</> : null}</div>

      <div className="b2p-field"><span className="b2p-label">Motorista da sua equipe</span>
        <div className="b2p-picklist" role="radiogroup" aria-label="Motorista">
          {drivers.map(({ user, open }) => <button type="button" role="radio" aria-checked={driverId === user.id} key={user.id} className="b2p-pick" data-on={driverId === user.id ? "1" : "0"} onClick={() => { setDriverId(user.id); setRunningChoice(""); }}>
            <StableImage src={resolveDriverPhoto(user)} alt="" loading="lazy" decoding="async" wrapperClassName="nvu-central-avatar" className="object-cover" referrerPolicy="no-referrer"
              persistentViewerId={viewerId} persistentAssetId={`designate-avatar:${me}:${user.id}`} fallback={<span>{String(user.name || "").slice(0, 2).toUpperCase()}</span>} />
            <span><b>{user.name}</b><small data-busy={open ? "1" : "0"}>{open ? `${open} trabalho${open === 1 ? "" : "s"} aberto${open === 1 ? "" : "s"}` : "Disponível"}</small></span>
            <i className="b2p-radio" aria-hidden="true">{driverId === user.id ? <Check size={12} /> : null}</i></button>)}
          {!drivers.length ? <p className="b2p-empty">{!membersReady ? "Consultando os motoristas da empresa…" : "Nenhum motorista ativo na sua equipe."}</p> : null}
        </div></div>

      {running.length ? <div className="b2p-field"><span className="b2p-label">Operação em andamento: {runningName}</span>
        <div className="b2p-picklist" role="radiogroup" aria-label="Operação em andamento">
          <button type="button" role="radio" aria-checked={runningChoice === "cancel"} className="b2p-pick" data-on={runningChoice === "cancel" ? "1" : "0"} onClick={() => setRunningChoice("cancel")}>
            <span><b>Cancelar a atual e iniciar esta</b><small>A operação em andamento é cancelada para a da parceria entrar. As viagens já registradas são preservadas.</small></span>
            <i className="b2p-radio" aria-hidden="true">{runningChoice === "cancel" ? <Check size={12} /> : null}</i></button>
          <button type="button" role="radio" aria-checked={runningChoice === "keep"} className="b2p-pick" data-on={runningChoice === "keep" ? "1" : "0"} onClick={() => setRunningChoice("keep")}>
            <span><b>Manter a operação atual</b><small>A parceria entra na fila do motorista e inicia depois que ele finalizar a atual.</small></span>
            <i className="b2p-radio" aria-hidden="true">{runningChoice === "keep" ? <Check size={12} /> : null}</i></button>
        </div></div> : null}

      <div className="b2p-field"><span className="b2p-label">Veículo da sua frota</span>
        <button type="button" className="b2p-input" onClick={() => setVehicleOpen(true)} aria-haspopup="dialog">
          <Truck size={18} aria-hidden="true" /><span style={{ flex: 1 }}>{vehicle ? vehicle.name : "Escolher veículo"}</span><ChevronRight size={18} aria-hidden="true" /></button>
        <span className="b2p-hint">{vehicle ? usageText(vehicleUsage.get(vehicle.id)) : ownVehicles.length ? "Quem escolhe o veículo é a sua empresa." : "Sua frota ainda não tem veículos (cadastre em Frota)."}</span>
        {suggested ? <button type="button" className="b2p-btn" data-v="text" data-size="sm" style={{ alignSelf: "flex-start" }} onClick={() => setVehicleId(suggested.id)}>Usar o último de {String(drivers.find(d => d.user.id === driverId)?.user.name || "").split(" ")[0]}: {suggested.name}</button> : null}
      </div>

      <p className="b2p-note-box"><Camera size={14} aria-hidden="true" style={{ verticalAlign: -2 }} /> Para iniciar, o motorista escolhe na galeria a <b>foto do veículo</b>. Ele continua vinculado à sua empresa e a pontuação vai para {shortName(p.contractorName)}.</p>
      {error ? <p className="b2p-alert" role="alert">{error}</p> : missing ? <p className="b2p-hint">{missing}</p> : null}
      <div className="b2p-actions">
        <button type="button" className="b2p-btn" data-v="primary" disabled={!ready || busy} onClick={() => void submit()}>{busy ? "Designando…" : "Designar motorista"}</button>
        <button type="button" className="b2p-btn" data-v="ghost" onClick={onBack}>Cancelar</button>
      </div>
    </div></section>
    <AssignJobAssetPicker kind="vehicle" open={vehicleOpen} selectedId={vehicleId} vehicles={ownVehicles} sequences={sequences} vehicleUsageById={vehicleUsage} onClose={() => setVehicleOpen(false)} onSelect={setVehicleId} />
  </>;
}
