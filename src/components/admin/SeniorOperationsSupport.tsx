import React, { useMemo, useState } from "react";
import { ArrowLeftRight, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ManagementDialog } from "./management/ManagementDialog";
import { listOpenSupportJobs, supportJobName, supportStatusLabel, type SupportJob } from "../../lib/seniorOperationSupport";
import { seniorCancelOperation, seniorChangeOperationVehicle, supportFailureMessage } from "../../services/seniorOperationSupportService";
import "./management/ManagementDashboard.css";
import "./management/OperationInfoSheet.css";
import "./management/SeniorSheets.css";

type Person = { id: string; firstName?: string; lastName?: string; name?: string };
type Vehicle = { id: string; companyId?: string; name?: string; plate?: string; status?: string; deleted?: boolean };

const personName = (person?: Person) => person ? (`${person.firstName || ""} ${person.lastName || ""}`.trim() || person.name || "Motorista") : "Motorista desconhecido";

/**
 * Painel Sênior › empresa › Trabalhos em aberto. Lista TODOS os trabalhos pendentes ou em execução da empresa (inclusive os
 * antigos que a tela do motorista não mostra) e permite ao Sênior cancelar ou trocar o veículo, como suporte direto.
 */
export function SeniorOperationsSupport({ company, jobs, users, vehicles, onChanged }: {
  company: { id: string; companyName?: string; operationalCommandVersion?: unknown };
  jobs: SupportJob[]; users: Person[]; vehicles: Vehicle[];
  onChanged: (jobId: string, patch: Partial<SupportJob>) => void;
}) {
  const open = useMemo(() => listOpenSupportJobs(jobs, company.id), [jobs, company.id]);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cancelJob = open.find(job => job.id === cancelId) || null;
  const vehicleJob = open.find(job => job.id === vehicleId) || null;
  const vehicleChoices = useMemo(() => vehicleJob ? vehicles.filter(vehicle => vehicle.companyId === company.id && vehicle.deleted !== true && vehicle.status !== "maintenance" && vehicle.id !== vehicleJob.vehicleId) : [], [vehicleJob, vehicles, company.id]);
  const driverOf = (job: SupportJob) => personName(users.find(user => user.id === (job.driverId || job.motoristaId)));
  const vehicleOf = (job: SupportJob) => vehicles.find(vehicle => vehicle.id === job.vehicleId)?.name || job.vehicleName || "Veículo não confirmado";

  const close = () => { if (!busy) { setCancelId(null); setVehicleId(null); setError(""); } };
  const confirmCancel = async () => {
    if (!cancelJob || busy) return;
    setBusy(true); setError("");
    try {
      await seniorCancelOperation(company, cancelJob, jobs);
      onChanged(cancelJob.id, { status: "cancelled" });
      toast.success("Trabalho cancelado.");
      setBusy(false); setCancelId(null);
    } catch (failure) { setError(supportFailureMessage(failure, "Não foi possível cancelar o trabalho. Tente novamente.")); setBusy(false); }
  };
  const chooseVehicle = async (vehicle: Vehicle) => {
    if (!vehicleJob || busy) return;
    setBusy(true); setError("");
    try {
      await seniorChangeOperationVehicle(company.id, vehicleJob.id, vehicle.id);
      onChanged(vehicleJob.id, { vehicleId: vehicle.id, vehicleName: vehicle.name });
      toast.success("Veículo da operação atualizado.");
      setBusy(false); setVehicleId(null);
    } catch (failure) { setError(supportFailureMessage(failure, "Não foi possível trocar o veículo. Tente novamente.")); setBusy(false); }
  };

  return (
    <div className="mt-10 space-y-4" data-testid="senior-operations-support">
      <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase px-1 border-b border-gray-100 dark:border-nvu-line pb-2">Trabalhos em aberto (suporte)</h3>
      <div className="nvu-central-palette nvu-senior-jobs">
        {!open.length && <p className="nvu-senior-empty">Nenhum trabalho pendente ou em andamento nesta empresa.</p>}
        {open.map(job => (
          <div className="nvu-senior-job" key={job.id} data-job-id={job.id} data-status={job.status}>
            <div className="nvu-senior-job-main">
              <strong>{supportJobName(job)}</strong>
              <small>{driverOf(job)} · {vehicleOf(job)}</small>
              <small>{Number(job.progress || 0)}/{Number(job.totalDeliveries || 0)} entregas · <span className="nvu-senior-job-id">{job.id.slice(0, 8)}</span></small>
            </div>
            <span className="nvu-senior-chip" data-tone={job.status === "delayed" ? "warn" : job.status === "pending" ? undefined : "ok"}><i />{supportStatusLabel(job.status)}</span>
            <div className="nvu-senior-guide-actions">
              <button type="button" className="nvu-senior-mini" data-action="vehicle" onClick={() => { setError(""); setVehicleId(job.id); }}><ArrowLeftRight size={15} aria-hidden="true" />Trocar veículo</button>
              <button type="button" className="nvu-senior-mini" data-tone="danger" data-action="cancel" onClick={() => { setError(""); setCancelId(job.id); }}><Trash2 size={15} aria-hidden="true" />Cancelar</button>
            </div>
          </div>
        ))}
      </div>

      {cancelJob && (
        <ManagementDialog title="Cancelar trabalho" variant="sheet" busy={busy} onClose={close}>
          <div className="nvu-senior-sheet" data-testid="senior-cancel-sheet">
            <div className="nvu-senior-form">
              <div><h3>{supportJobName(cancelJob)}</h3><p>{driverOf(cancelJob)} · {supportStatusLabel(cancelJob.status)}. As viagens já registradas são preservadas e o veículo é liberado.</p></div>
              {error && <p role="alert" className="nvu-senior-error">{error}</p>}
              <div className="nvu-central-dialog-actions">
                <button type="button" disabled={busy} onClick={close}>Voltar</button>
                <button type="button" data-orange="true" disabled={busy} onClick={() => void confirmCancel()}>{busy ? <><Loader2 className="animate-spin" size={16} aria-hidden="true" />Cancelando...</> : "Cancelar trabalho"}</button>
              </div>
            </div>
          </div>
        </ManagementDialog>
      )}

      {vehicleJob && (
        <ManagementDialog title="Trocar veículo" variant="sheet" busy={busy} onClose={close}>
          <div className="nvu-senior-sheet" data-testid="senior-vehicle-sheet">
            <div className="nvu-senior-form"><div><h3>{supportJobName(vehicleJob)}</h3><p>Atual: {vehicleOf(vehicleJob)}. Escolha o novo veículo da empresa.</p></div></div>
            {error && <p role="alert" className="nvu-senior-error">{error}</p>}
            <section className="nvu-senior-group" aria-label="Veículos da empresa">
              {!vehicleChoices.length && <p className="nvu-senior-empty">Nenhum outro veículo disponível nesta empresa.</p>}
              {vehicleChoices.map(vehicle => (
                <button type="button" key={vehicle.id} className="nvu-senior-action" data-vehicle-id={vehicle.id} disabled={busy} onClick={() => void chooseVehicle(vehicle)}>
                  <ArrowLeftRight aria-hidden="true" strokeWidth={1.7} />
                  <span><strong>{vehicle.name || "Veículo"}</strong><small>{[vehicle.plate, vehicle.status === "in_use" ? "Em uso" : "Disponível"].filter(Boolean).join(" · ")}</small></span>
                </button>
              ))}
            </section>
          </div>
        </ManagementDialog>
      )}
    </div>
  );
}
