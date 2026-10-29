import { resolveDriverPhoto } from '../../lib/resolveDriverPhoto';
import React, { useState } from "react";
import { useOperationalStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { isTrailerlessSimulator } from "../../lib/resolveSimulator";
import { countFleetAssetUsage } from "../../lib/fleetUsage";
import AssignJobAssetPicker from "../../components/admin/AssignJobAssetPicker";
import { StableImage } from "../../components/common/StableImage";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { operationalRequestId } from "../../lib/operationalRequestId";
import { ClipboardList, X, Send, KeyRound, Users, CalendarClock, Search, Package, Truck } from "lucide-react";
import "../../components/admin/AssignmentWorkspace.css";

export default function AssignJob() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as {
    preselectedDriverId?: string;
    preselectedContractId?: string;
  } || {};

  const {
    preselectedDriverId,
    preselectedContractId,
  } = state;

  const { activeCompanyId, allCompanyMembers, allCompanyMembersReady } = useCompanyStore();
  const {
    contracts,
    sequences,
    users,
    vehicles,
    trailers,
    simulators,
    jobs,
    assignJob,
  } = useOperationalStore();

  const [selectedContract, setSelectedContract] = useState(preselectedContractId || "");
  const [selectedDrivers, setSelectedDrivers] = useState<string[]>(
    preselectedDriverId ? [preselectedDriverId] : [],
  );
  const [selectedVehicle, setSelectedVehicle] = useState("");
  const [isContractPickerOpen, setIsContractPickerOpen] = useState(false);
  const [isVehiclePickerOpen, setIsVehiclePickerOpen] = useState(false);

  const [customDeadlines, setCustomDeadlines] = useState<Record<string, number>>({});

  const activeContracts = [...contracts]
    .filter((c) => c.status !== "completed")
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );

  const activeDrivers = [...users].filter((u) => {
    if (u.status !== "active") return false;
    const member = allCompanyMembers?.find(
      (m) => m.userId === u.id && m.companyId === activeCompanyId,
    );
    if (!member) return false;
    return member.status === "active" && member.roles?.includes("driver");
  }).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );

  const availableVehicles = [...vehicles].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );

  const handleContractChange = (contractId: string) => {
    setSelectedContract(contractId);
  };

  const selectedContractData = contracts.find((c) => c.id === selectedContract);
  const trailerlessSimulator = isTrailerlessSimulator(
    selectedContractData?.simulator,
    simulators as unknown[],
  );

  const selectedTrailerData = selectedContractData?.trailerId
    ? trailers.find((trailer) => trailer.id === selectedContractData.trailerId)
    : undefined;
  const vehicleUsageById = React.useMemo(() => {
    const usage = new Map<string, number | null>();
    for (const vehicle of vehicles) {
      usage.set(
        vehicle.id,
        allCompanyMembersReady
          ? countFleetAssetUsage({
              jobs,
              members: allCompanyMembers,
              contracts,
              assetId: vehicle.id,
              kind: "vehicle",
              companyId: activeCompanyId,
            })
          : null,
      );
    }
    return usage;
  }, [activeCompanyId, allCompanyMembers, allCompanyMembersReady, contracts, jobs, vehicles]);

  const toggleDriver = (id: string) => {
    setSelectedDrivers((prev) =>
      prev.includes(id)
        ? prev.filter((disabledId) => disabledId !== id)
        : [...prev, id],
    );
  };

  const toggleAllDrivers = () => {
    if (selectedDrivers.length === activeDrivers.length) {
      setSelectedDrivers([]);
    } else {
      setSelectedDrivers(activeDrivers.map((d) => d.id));
    }
  };

  const handleCustomDeadlineChange = (driverId: string, value: string) => {
    const days = parseInt(value, 10);
    if (!isNaN(days) && days > 0) {
      setCustomDeadlines((prev) => ({
        ...prev,
        [driverId]: days,
      }));
    } else if (value === "") {
      setCustomDeadlines((prev) => {
        const next = { ...prev };
        delete next[driverId];
        return next;
      });
    }
  };

  const [isAssigning, setIsAssigning] = useState(false);
  const assignmentRequests = React.useRef(new Map<string, string>());

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !selectedContract ||
      selectedDrivers.length === 0 ||
      !selectedVehicle ||
      isAssigning
    )
      return;

    setIsAssigning(true);
    try {
      const results = await Promise.allSettled(
        selectedDrivers.map((driverId) =>
          assignJob(
            selectedContract,
            driverId,
            selectedVehicle,
            trailerlessSimulator ? undefined : selectedContractData?.trailerId || undefined,
            customDeadlines[driverId],
            (() => {
              const key = JSON.stringify([activeCompanyId, selectedContract, driverId, selectedVehicle, trailerlessSimulator ? null : selectedContractData?.trailerId || null, customDeadlines[driverId] ?? null]);
              if (!assignmentRequests.current.has(key)) assignmentRequests.current.set(key, operationalRequestId());
              return assignmentRequests.current.get(key)!;
            })(),
          ),
        ),
      );
      const failed = selectedDrivers.filter((_, index) => results[index].status === "rejected");
      if (failed.length) {
        setSelectedDrivers(failed);
        const successCount = results.length - failed.length;
        const firstError = results.find(result => result.status === "rejected") as PromiseRejectedResult;
        toast.error(`${successCount ? `${successCount} encaminhamento(s) confirmado(s). ` : ""}${firstError.reason?.message || "Não foi possível confirmar todos os encaminhamentos."} Tente novamente para os motoristas restantes.`);
        return;
      }
      navigate(-1); // go back
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Não foi possível confirmar o encaminhamento.");
    } finally {
      setIsAssigning(false);
    }
  };

  const selectedVehicleData = vehicles.find((vehicle) => vehicle.id === selectedVehicle);
  const usageCount = vehicleUsageById.get(selectedVehicle);
  const allDriversSelected = activeDrivers.length > 0 && activeDrivers.every((driver) => selectedDrivers.includes(driver.id));
  const canAssign = Boolean(selectedContract && selectedDrivers.length && selectedVehicle && !isAssigning);

  return (
    <div className="nvu-assignment-page">
      <section className="nvu-assignment-panel" aria-labelledby="assign-work-title" aria-busy={isAssigning}>
        <header className="nvu-assignment-heading">
          <button type="button" onClick={() => navigate(-1)} disabled={isAssigning}
            className="nvu-assignment-close" aria-label="Fechar encaminhamento"><X size={23} strokeWidth={1.7} /></button>
          <div className="nvu-assignment-hero" aria-hidden="true">
            <ClipboardList size={34} strokeWidth={1.65} /><Send size={23} strokeWidth={1.65} className="nvu-assignment-hero-send" />
          </div>
          <h1 id="assign-work-title">Encaminhar trabalho</h1>
          <p>Escolha a operação, o veículo e os motoristas.</p>
        </header>

        <form onSubmit={handleAssign}>
          <div className="nvu-assignment-content">
            <section className="nvu-assignment-field" aria-labelledby="assign-operation-label">
              <h2 id="assign-operation-label"><ClipboardList size={21} strokeWidth={1.7} />Operação <span className="nvu-assignment-required" aria-label="obrigatório">*</span></h2>
              <button type="button" onClick={() => setIsContractPickerOpen(true)} disabled={isAssigning}
                aria-label={selectedContractData ? "Alterar operação: " + selectedContractData.name : "Selecionar operação"}
                aria-haspopup="dialog" aria-expanded={isContractPickerOpen} className="nvu-assignment-select">
                <span className="nvu-assignment-select-copy">
                  {selectedContractData ? <>
                    <strong>{selectedContractData.name}</strong>
                    <small><Truck size={14} />{selectedTrailerData?.name || (trailerlessSimulator ? "Sem reboque" : "Qualquer reboque")}</small>
                    <small><Package size={14} />{selectedContractData.totalDeliveries} entregas<span aria-hidden="true">·</span>{selectedContractData.deadlineDays} dias</small>
                  </> : <span className="nvu-assignment-placeholder">Selecionar operação</span>}
                </span>
                <Search size={21} strokeWidth={1.7} aria-hidden="true" />
              </button>
            </section>

            <section className="nvu-assignment-field" aria-labelledby="assign-vehicle-label">
              <h2 id="assign-vehicle-label"><KeyRound size={22} strokeWidth={1.7} />Veículo <span className="nvu-assignment-required" aria-label="obrigatório">*</span></h2>
              <button type="button" onClick={() => setIsVehiclePickerOpen(true)} disabled={isAssigning}
                aria-label={selectedVehicleData ? "Alterar veículo: " + selectedVehicleData.name : "Selecionar veículo"}
                aria-haspopup="dialog" aria-expanded={isVehiclePickerOpen} className="nvu-assignment-select">
                <span className="nvu-assignment-select-copy">
                  {selectedVehicleData ? <>
                    <strong>{selectedVehicleData.name}</strong>
                    <small>{usageCount == null ? "Vínculos em consulta" : usageCount === 0 ? "Sem motoristas vinculados" : "Em uso por " + usageCount + " motorista" + (usageCount === 1 ? "" : "s")}</small>
                  </> : <span className="nvu-assignment-placeholder">Selecionar veículo</span>}
                </span>
                <Search size={21} strokeWidth={1.7} aria-hidden="true" />
              </button>
            </section>

            <section className="nvu-assignment-drivers" aria-labelledby="assign-drivers-label">
              <div className="nvu-assignment-drivers-heading">
                <h2 id="assign-drivers-label"><Users size={23} strokeWidth={1.7} />Motoristas</h2>
                <span className="nvu-assignment-selection-count" role="status">{selectedDrivers.length} {selectedDrivers.length === 1 ? "selecionado" : "selecionados"}</span>
                <button type="button" className="nvu-assignment-text-action" onClick={toggleAllDrivers}
                  disabled={!activeDrivers.length || isAssigning}>{allDriversSelected ? "Desmarcar todos" : "Selecionar todos"}</button>
              </div>
              <p className="nvu-assignment-help">Selecione quem receberá o trabalho.</p>
              <div className="nvu-assignment-driver-list">
                {activeDrivers.map((driver) => {
                  const isSelected = selectedDrivers.includes(driver.id);
                  return (
                    <label key={driver.id} className={"nvu-assignment-driver" + (isSelected ? " is-selected" : "")}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleDriver(driver.id)}
                        disabled={isAssigning} aria-label={"Selecionar " + driver.name} />
                      <StableImage src={resolveDriverPhoto(driver)} alt="" loading="lazy" decoding="async"
                        wrapperClassName="nvu-assignment-avatar" className="object-cover" referrerPolicy="no-referrer"
                        fallback={<span>{driver.name.substring(0, 2).toUpperCase()}</span>} />
                      <span className="nvu-assignment-driver-copy"><strong>{driver.name}</strong><small>Motorista</small></span>
                    </label>
                  );
                })}
                {!activeDrivers.length && <p className="nvu-assignment-empty" role="status">{allCompanyMembersReady ? "Nenhum motorista disponível para encaminhamento." : "Consultando os motoristas da empresa…"}</p>}
              </div>
            </section>

            {selectedDrivers.length > 0 && selectedContractData && (
              <details className="nvu-assignment-deadlines">
                <summary><CalendarClock size={19} strokeWidth={1.7} />Ajustar prazos por motorista</summary>
                <p className="nvu-assignment-help">Padrão da operação: {selectedContractData.deadlineDays} {selectedContractData.deadlineDays === 1 ? "dia" : "dias"}.</p>
                {selectedDrivers.map((driverId) => {
                  const driver = users.find((user) => user.id === driverId);
                  if (!driver) return null;
                  return <label key={driverId} className="nvu-assignment-deadline-row">
                    <span>{driver.name}</span>
                    <span><input type="number" min="1" step="1" inputMode="numeric"
                      disabled={isAssigning} aria-label={"Prazo em dias para " + driver.name}
                      value={customDeadlines[driverId] ?? ""} placeholder={String(selectedContractData.deadlineDays)}
                      onChange={(event) => handleCustomDeadlineChange(driver.id, event.target.value)} />dias</span>
                  </label>;
                })}
              </details>
            )}
          </div>

          <footer className="nvu-assignment-footer">
            <p role="status">{isAssigning ? "Confirmando o encaminhamento…" : canAssign ? "Tudo pronto para encaminhar o trabalho." : "Preencha os campos para continuar."}</p>
            <div className="nvu-assignment-footer-actions">
              <button type="button" onClick={() => navigate(-1)} disabled={isAssigning} className="nvu-assignment-button nvu-assignment-cancel">Cancelar</button>
              <button type="submit" disabled={!canAssign} className="nvu-assignment-button nvu-assignment-primary">
                <Send size={19} strokeWidth={1.7} aria-hidden="true" />
                <span>{isAssigning ? "Encaminhando…" : "Encaminhar trabalho"}</span>
              </button>
            </div>
          </footer>
        </form>
      </section>

      <AssignJobAssetPicker kind="contract" open={isContractPickerOpen} selectedId={selectedContract}
        contracts={activeContracts} sequences={sequences} trailers={trailers}
        onClose={() => setIsContractPickerOpen(false)} onSelect={handleContractChange} />
      <AssignJobAssetPicker kind="vehicle" open={isVehiclePickerOpen} selectedId={selectedVehicle}
        vehicles={availableVehicles} sequences={sequences} vehicleUsageById={vehicleUsageById}
        onClose={() => setIsVehiclePickerOpen(false)} onSelect={setSelectedVehicle} />
    </div>
  );
}
