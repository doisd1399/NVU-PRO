import { resolveDriverPhoto } from '../../lib/resolveDriverPhoto';
import React, { useState } from "react";
import { useOperationalStore, useSessionStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { isTrailerlessSimulator } from "../../lib/resolveSimulator";
import { countFleetAssetUsage } from "../../lib/fleetUsage";
import AssignJobAssetPicker from "../../components/admin/AssignJobAssetPicker";
import { Button } from "../../components/ui/Button";
import { StableImage } from "../../components/common/StableImage";
import { useLocation, useNavigate } from "react-router-dom";
import {
  PackageOpen,
  X,
  PlayCircle,
  CheckSquare,
  Square,
  Truck,
  Users,
  CalendarClock,
  Briefcase,
  Search,
} from "lucide-react";

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

  const { currentUser } = useSessionStore();
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
      await Promise.all(
        selectedDrivers.map((driverId) =>
          assignJob(
            selectedContract,
            driverId,
            selectedVehicle,
            trailerlessSimulator ? undefined : selectedContractData?.trailerId || undefined,
            customDeadlines[driverId],
          ),
        ),
      );
      navigate(-1); // go back
    } catch (e) {
      console.error(e);
      setIsAssigning(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-50 dark:bg-[#09090b] font-sans pb-8 px-4 pt-4 sm:pt-6 w-full box-border">
      <div className="max-w-5xl mx-auto flex flex-col items-center justify-center">
        <div className="bg-white dark:bg-[#1A1F26] rounded-[16px] border border-gray-200 dark:border-[#2A2F3A] shadow-sm w-full flex flex-col relative overflow-hidden">
          <div className="h-1.5 w-full shrink-0 bg-green-500"></div>

          {/* Header */}
          <div className="shrink-0 p-4 sm:p-5 border-b border-gray-100 dark:border-[#2A2F3A] flex items-center justify-between bg-white dark:bg-[#1A1F26] z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-50 dark:bg-green-500/10 dark:border-green-500/20 text-green-600 dark:text-green-400 rounded-[12px] flex items-center justify-center shrink-0">
                <PackageOpen size={20} />
              </div>
              <h2 className="text-[19px] font-semibold tracking-tight text-gray-900 dark:text-[#fafafa]">
                Nova Operação
              </h2>
            </div>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="p-2 text-gray-400 hover:text-gray-900 dark:text-[#fafafa] transition-colors rounded-full shrink-0"
            >
              <X size={20} />
            </button>
          </div>

          <form onSubmit={handleAssign} className="flex flex-col flex-1">
            <div className="p-4 sm:p-5 bg-gray-50/50 dark:bg-[#121212]/50">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6">
                {/* Left Column: Contract & Vehicle */}
                <div className="lg:col-span-5 space-y-5">
                  {/* 1. Operação */}
                  <div className="bg-white dark:bg-[#1A1F26] p-4 rounded-[14px] border border-gray-200 dark:border-[#2A2F3A] shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Briefcase size={16} className="text-blue-500" />
                        <h3 className="font-semibold text-gray-900 dark:text-[#fafafa] text-[15px]">
                          1. Operação
                        </h3>
                      </div>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                        Obrigatório
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsContractPickerOpen(true)}
                      className="w-full rounded-2xl border border-gray-200 bg-gray-50 p-4 text-left transition-all hover:border-blue-400 hover:bg-blue-50/30 dark:border-[#2A2F3A] dark:bg-[#121212] dark:hover:border-blue-500/60"
                    >
                      {selectedContractData ? (
                        <>
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                              <Briefcase size={17} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="block line-clamp-2 text-[15px] font-bold text-gray-900 dark:text-white">
                                {selectedContractData.name}
                              </span>
                              <span className="mt-1 flex items-center gap-1.5 truncate text-[13px] font-medium text-gray-500 dark:text-[#a1a1aa]">
                                <Truck size={14} className="shrink-0 text-gray-400" />
                                {selectedTrailerData?.name || (trailerlessSimulator ? "Sem reboque — simulador trailerless" : "Qualquer reboque")}
                              </span>
                            </div>
                            <Search size={17} className="shrink-0 text-gray-400" />
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-white p-3 text-[12px] dark:bg-[#1A1F26]">
                            <span className="font-semibold text-gray-900 dark:text-white">{selectedContractData.totalDeliveries} entregas</span>
                            <span className="font-semibold text-gray-900 dark:text-white">{selectedContractData.deadlineDays} dias</span>
                          </div>
                          <div className="mt-2 text-[12px] font-medium text-gray-500 dark:text-[#a1a1aa]">
                            Modo: {selectedContractData.mode === "simple" ? "Livres" : "Planejadas"}
                          </div>
                        </>
                      ) : (
                        <span className="flex items-center justify-between gap-3 text-[14px] text-gray-500 dark:text-[#a1a1aa]">
                          <span>Selecione uma operação...</span>
                          <Search size={17} className="shrink-0 text-gray-400" />
                        </span>
                      )}
                    </button>
                  </div>

                  {/* 2. Veículo */}
                  <div className="bg-white dark:bg-[#1A1F26] p-4 rounded-[14px] border border-gray-200 dark:border-[#2A2F3A] shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Truck size={16} className="text-amber-500" />
                        <h3 className="font-semibold text-gray-900 dark:text-[#fafafa] text-[15px]">
                          2. Caminhão Vinculado
                        </h3>
                      </div>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                        Obrigatório
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsVehiclePickerOpen(true)}
                      className="w-full rounded-2xl border border-gray-200 bg-gray-50 p-4 text-left transition-all hover:border-amber-400 hover:bg-amber-50/30 dark:border-[#2A2F3A] dark:bg-[#121212] dark:hover:border-amber-500/60"
                    >
                      {selectedVehicle ? (
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600 dark:bg-[#1A1F26] dark:text-[#d4d4d8]">
                            <Truck size={18} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="block line-clamp-2 text-[15px] font-bold text-gray-900 dark:text-white">
                              {vehicles.find((vehicle) => vehicle.id === selectedVehicle)?.name}
                            </span>
                            <span className="mt-1 block text-[12px] text-gray-500 dark:text-[#a1a1aa]">
                              Em uso por {vehicleUsageById.get(selectedVehicle) == null ? "—" : vehicleUsageById.get(selectedVehicle)} motorista{vehicleUsageById.get(selectedVehicle) !== 1 ? "s" : ""}
                            </span>
                          </div>
                          <Search size={17} className="shrink-0 text-gray-400" />
                        </div>
                      ) : (
                        <span className="flex items-center justify-between gap-3 text-[14px] text-gray-500 dark:text-[#a1a1aa]">
                          <span>Selecione um veículo...</span>
                          <Search size={17} className="shrink-0 text-gray-400" />
                        </span>
                      )}
                    </button>
                  </div>
                </div>

                {/* Right Column: Drivers & Deadlines */}
                <div className="lg:col-span-7 flex flex-col gap-5">
                  {/* 4. Motoristas */}
                  <div className="bg-white dark:bg-[#1A1F26] flex flex-col rounded-[14px] border border-gray-200 dark:border-[#2A2F3A] shadow-sm overflow-hidden h-[280px]">
                    <div className="p-3 px-4 border-b border-gray-100 dark:border-[#2A2F3A] flex items-center justify-between bg-gray-50/80 dark:bg-[#1A1F26]">
                      <div className="flex items-center gap-2">
                        <Users size={16} className="text-green-500" />
                        <div>
                          <h3 className="text-[14px] font-semibold text-gray-900 dark:text-[#fafafa]">
                            3. Seleção de Motoristas
                          </h3>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[12px] text-gray-500 hidden sm:inline">{selectedDrivers.length} {selectedDrivers.length === 1 ? 'selecionado' : 'selecionados'}</span>
                        <button
                          type="button"
                          onClick={toggleAllDrivers}
                          className="text-[12px] font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-2.5 py-1 rounded-md hover:bg-green-100 dark:hover:bg-green-500/20 transition-colors"
                        >
                          {selectedDrivers.length === activeDrivers.length ? "Desmarcar Todos" : "Selecionar Todos"}
                        </button>
                      </div>
                    </div>

                    <div className="overflow-y-auto flex-1 p-2 bg-white dark:bg-[#121212]">
                      {activeDrivers.map((d) => {
                        const isSelected = selectedDrivers.includes(d.id);
                        return (
                          <div
                            key={d.id}
                            onClick={() => toggleDriver(d.id)}
                            className={`flex items-center gap-3 px-3 py-2 rounded-[10px] cursor-pointer transition-colors mb-1 select-none ${isSelected ? "bg-green-50 dark:bg-green-500/5 object-cover border border-green-100 dark:border-green-500/10" : "hover:bg-gray-50 dark:hover:bg-[#1A1F26] border border-transparent"}`}
                          >
                            <div className={`shrink-0 flex items-center justify-center ${isSelected ? 'text-green-600 dark:text-green-500' : 'text-gray-300 dark:text-gray-600'}`}>
                              {isSelected ? <CheckSquare size={16} fill="currentColor" stroke="white" /> : <Square size={16} />}
                            </div>
                            <div className="flex-1 flex items-center gap-3 min-w-0">
                              {resolveDriverPhoto(d) ? (
                                <StableImage
                                  src={resolveDriverPhoto(d)}
                                  alt={d.name}
                                  loading="lazy"
                                  decoding="async"
                                  wrapperClassName="w-7 h-7 rounded-full bg-white shrink-0"
                                  className="object-cover"
                                  referrerPolicy="no-referrer"
                                  fallback={
                                    <span className="h-full w-full bg-gray-100 dark:bg-[#1A1F26] flex items-center justify-center text-[11px] font-bold">
                                      {d.name.substring(0, 2).toUpperCase()}
                                    </span>
                                  }
                                />
                              ) : (
                                <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-[#1A1F26] flex items-center justify-center text-[11px] font-bold shrink-0">
                                  {d.name.substring(0, 2).toUpperCase()}
                                </div>
                              )}
                              <div className="truncate flex-1 flex flex-col">
                                <span className={`text-[13px] font-medium truncate flex items-center gap-1.5 ${isSelected ? "text-gray-900 dark:text-[#fafafa]" : "text-gray-700 dark:text-[#d4d4d8]"}`}>
                                  {d.name}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 4. Prazos Individuais */}
                  {selectedDrivers.length > 0 && selectedContractData && (
                    <div className="bg-white dark:bg-[#1A1F26] flex flex-col rounded-[14px] border border-gray-200 dark:border-[#2A2F3A] shadow-sm overflow-hidden flex-1 min-h-[160px]">
                      <div className="p-3 px-4 border-b border-gray-100 dark:border-[#2A2F3A] bg-gray-50/80 dark:bg-[#1A1F26]">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                           <div className="flex items-center gap-2">
                            <CalendarClock size={16} className="text-purple-500" />
                            <h3 className="text-[14px] font-semibold text-gray-900 dark:text-[#fafafa]">
                              5. Ajuste de Prazos
                            </h3>
                          </div>
                          <span className="text-[12px] text-gray-500 whitespace-nowrap hidden sm:inline">
                             Padrão do contrato: {selectedContractData.deadlineDays} {selectedContractData.deadlineDays === 1 ? "dia" : "dias"}
                          </span>
                        </div>
                      </div>

                      <div className="overflow-y-auto p-3 space-y-2 bg-white dark:bg-[#121212] flex-1">
                        {selectedDrivers.map((driverId) => {
                          const d = users.find((u) => u.id === driverId);
                          if (!d) return null;

                          const currentDays = customDeadlines[driverId] || selectedContractData.deadlineDays;
                          const expectedDate = new Date();
                          expectedDate.setDate(expectedDate.getDate() + currentDays);
                          const isCustom = customDeadlines[driverId] !== undefined;

                          return (
                            <div
                              key={driverId}
                              className={`flex items-center justify-between p-2.5 px-3 rounded-[10px] border transition-colors gap-3 ${isCustom ? "bg-purple-50/40 border-purple-100 dark:border-purple-500/20" : "bg-gray-50/50 dark:bg-[#1A1F26] border-gray-100 dark:border-[#2A2F3A]"}`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="font-medium text-[13px] text-gray-900 dark:text-[#fafafa] truncate">
                                  {d.name}
                                </span>
                              </div>

                              <div className="flex items-center gap-3 shrink-0">
                                <div className="relative">
                                  <input
                                    type="number"
                                    min="1"
                                    value={customDeadlines[driverId] || ""}
                                    placeholder={String(selectedContractData.deadlineDays)}
                                    onChange={(e) => handleCustomDeadlineChange(d.id, e.target.value)}
                                    className="w-20 bg-white dark:bg-[#121212] border border-gray-200 dark:border-[#2A2F3A] text-[13px] font-medium text-center text-gray-900 dark:text-[#fafafa] rounded-md py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-shadow"
                                  />
                                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-gray-400 font-medium bg-white dark:bg-[#121212]">
                                    dias
                                  </span>
                                </div>
                                <div className="hidden md:flex text-[11px] text-gray-500 bg-white dark:bg-[#121212] border border-gray-100 dark:border-[#2A2F3A] px-2.5 py-1.5 rounded-md min-w-[100px] justify-center items-center">
                                  <span>
                                    Entrega <strong className={isCustom ? "text-purple-600 font-semibold" : "font-medium"}>{expectedDate.toLocaleDateString("pt-BR", {day: "2-digit", month: "short"})}</strong>
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer (Actions) */}
            <div className="shrink-0 p-4 border-t border-gray-100 dark:border-[#2A2F3A] bg-white dark:bg-[#1A1F26] flex flex-col sm:flex-row justify-end gap-3 z-10">
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate(-1)}
                className="w-full sm:w-auto h-10 px-5 text-[14px]"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto bg-green-500 hover:bg-green-600 text-white h-10 px-6 gap-2 font-medium text-[14px] shadow-sm"
                disabled={
                  !selectedContract ||
                  selectedDrivers.length === 0 ||
                  !selectedVehicle ||
                  isAssigning
                }
              >
                <PlayCircle size={16} />
                {isAssigning ? "Processando..." : `Designar (${selectedDrivers.length})`}
              </Button>
            </div>
          </form>
        </div>
      </div>

      <AssignJobAssetPicker
        kind="contract"
        open={isContractPickerOpen}
        selectedId={selectedContract}
        contracts={activeContracts}
        sequences={sequences}
        trailers={trailers}
        onClose={() => setIsContractPickerOpen(false)}
        onSelect={handleContractChange}
      />
      <AssignJobAssetPicker
        kind="vehicle"
        open={isVehiclePickerOpen}
        selectedId={selectedVehicle}
        vehicles={availableVehicles}
        sequences={sequences}
        vehicleUsageById={vehicleUsageById}
        onClose={() => setIsVehiclePickerOpen(false)}
        onSelect={setSelectedVehicle}
      />
    </div>
  );
}