import React, { useMemo, useState } from "react";
import {
  BriefcaseBusiness,
  ChevronDown,
  ChevronUp,
  Folder,
  FolderOpen,
  Search,
  Truck,
  Users,
  X,
} from "lucide-react";

type PickerKind = "contract" | "vehicle";

type PickerContract = {
  id: string;
  name: string;
  deadlineDays?: number;
  totalDeliveries?: number;
  mode?: string;
  trailerId?: string | null;
  sequenceId?: string | null;
};

type PickerSequence = {
  id: string;
  name: string;
  scope?: "operations" | "vehicles" | "trailers";
};

type PickerVehicle = {
  id: string;
  name: string;
  paintCode?: string;
  sequenceId?: string | null;
  sequenceOrder?: number | null;
};

type PickerTrailer = {
  id: string;
  name: string;
};

type Props = {
  kind: PickerKind;
  open: boolean;
  selectedId: string;
  contracts?: PickerContract[];
  sequences?: PickerSequence[];
  vehicles?: PickerVehicle[];
  trailers?: PickerTrailer[];
  vehicleUsageById?: Map<string, number | null>;
  onClose: () => void;
  onSelect: (id: string) => void;
};

const normalizeText = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();

export function AssignJobAssetPicker({
  kind,
  open,
  selectedId,
  contracts = [],
  sequences = [],
  vehicles = [],
  trailers = [],
  vehicleUsageById,
  onClose,
  onSelect,
}: Props) {
  const [search, setSearch] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});

  const title = kind === "contract" ? "Selecionar operação" : "Selecionar veículo";
  const selectedName = kind === "contract"
    ? contracts.find((contract) => contract.id === selectedId)?.name
    : vehicles.find((vehicle) => vehicle.id === selectedId)?.name;
  const subtitle = selectedName
    ? `Selecionado para editar: ${selectedName}. Toque em outro card para substituir.`
    : kind === "contract"
      ? "Escolha uma operação organizada pelas mesmas pastas de Operações."
      : "Escolha um veículo organizado pelas mesmas pastas da Frota.";

  const filteredContracts = useMemo(() => {
    const query = normalizeText(search);
    return [...contracts]
      .filter((contract) => !query || normalizeText(contract.name).includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  }, [contracts, search]);

  const contractGroups = useMemo(() => {
    if (kind !== "contract") return [];
    const operationSequences = sequences.filter((sequence) => (sequence.scope || "operations") === "operations");
    const groups = operationSequences
      .map((sequence) => ({
        id: sequence.id,
        name: sequence.name,
        contracts: filteredContracts.filter((contract) => contract.sequenceId === sequence.id),
      }))
      .filter((group) => group.contracts.length > 0);
    const withoutFolder = filteredContracts.filter((contract) => !contract.sequenceId);
    if (withoutFolder.length > 0) {
      groups.push({ id: "none", name: "Sem pasta", contracts: withoutFolder });
    }
    return groups;
  }, [filteredContracts, kind, sequences]);

  const filteredVehicles = useMemo(() => {
    const query = normalizeText(search);
    return [...vehicles]
      .filter((vehicle) => !query || normalizeText(vehicle.name).includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  }, [vehicles, search]);

  const vehicleGroups = useMemo(() => {
    if (kind !== "vehicle") return [];
    const vehicleSequences = sequences.filter((sequence) => sequence.scope === "vehicles");
    const groups = vehicleSequences
      .map((sequence) => ({
        id: sequence.id,
        name: sequence.name,
        vehicles: filteredVehicles
          .filter((vehicle) => vehicle.sequenceId === sequence.id)
          .sort(
            (a, b) =>
              (Number(a.sequenceOrder ?? Number.MAX_SAFE_INTEGER) - Number(b.sequenceOrder ?? Number.MAX_SAFE_INTEGER)) ||
              a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
          ),
      }))
      .filter((group) => group.vehicles.length > 0);
    const withoutFolder = filteredVehicles.filter((vehicle) => !vehicle.sequenceId);
    if (withoutFolder.length > 0) groups.push({ id: "none", name: "Sem pasta", vehicles: withoutFolder });
    return groups;
  }, [filteredVehicles, kind, sequences]);

  if (!open) return null;

  const selectAndClose = (id: string) => {
    onSelect(id);
    setSearch("");
    onClose();
  };

  const toggleFolder = (id: string) => {
    setCollapsedFolders((current) => ({ ...current, [id]: !current[id] }));
  };

  const renderContractCard = (contract: PickerContract) => {
    const trailer = trailers.find((item) => item.id === contract.trailerId);
    const selected = selectedId === contract.id;
    return (
      <button
        type="button"
        key={contract.id}
        onClick={() => selectAndClose(contract.id)}
        className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md dark:bg-[#1A1F26] ${selected ? "border-blue-500 ring-2 ring-blue-500/15 dark:border-blue-400" : "border-gray-200 dark:border-[#2A2F3A]"}`}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
            <BriefcaseBusiness size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-[15px] font-bold text-gray-900 dark:text-white">{contract.name}</h3>
            <p className="mt-1 flex items-center gap-1.5 truncate text-[13px] font-medium text-gray-500 dark:text-[#a1a1aa]">
              <Truck size={14} className="shrink-0 text-gray-400" />
              {trailer?.name || "Qualquer reboque"}
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-3 text-[12px] dark:bg-[#121212]">
          <span className="font-semibold text-gray-900 dark:text-white">{contract.totalDeliveries ?? 0} entregas</span>
          <span className="font-semibold text-gray-900 dark:text-white">{contract.deadlineDays ?? 0} dias</span>
        </div>
      </button>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[1500] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[24px] bg-white shadow-2xl dark:bg-[#1A1F26] sm:rounded-[24px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-job-picker-title"
      >
        <header className="flex items-start justify-between gap-4 border-b border-gray-100 p-4 sm:p-5 dark:border-[#2A2F3A]">
          <div className="min-w-0">
            <h2 id="assign-job-picker-title" className="text-[18px] font-bold text-gray-900 dark:text-white">{title}</h2>
            <p className="mt-1 text-[13px] text-gray-500 dark:text-[#a1a1aa]">{subtitle}</p>
            <div className={`mt-3 inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold ${selectedName ? "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" : "bg-gray-100 text-gray-600 dark:bg-[#2A2F3A] dark:text-[#d4d4d8]"}`}>
              {selectedName ? `${kind === "contract" ? "Operação" : "Veículo"}: ${selectedName}` : `Nenhum ${kind === "contract" ? "operação" : "veículo"} selecionado`}
            </div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-[#2A2F3A] dark:hover:text-white" aria-label="Fechar seleção">
            <X size={20} />
          </button>
        </header>

        <div className="border-b border-gray-100 p-4 dark:border-[#2A2F3A]">
          <label className="relative block">
            <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder={kind === "contract" ? "Buscar operação..." : "Buscar veículo..."} className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-3 text-[14px] text-gray-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-[#2A2F3A] dark:bg-[#121212] dark:text-white" />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {kind === "contract" ? (
            <div className="space-y-5">
              {contractGroups.map((group) => {
                const collapsed = Boolean(collapsedFolders[group.id]);
                return (
                  <section key={group.id} aria-labelledby={`assign-folder-${group.id}`}>
                    <button type="button" onClick={() => toggleFolder(group.id)} className="mb-3 flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-[#121212]">
                      <span className="flex min-w-0 items-center gap-3">
                        {collapsed ? <Folder size={18} className="shrink-0 text-blue-600 dark:text-blue-400" /> : <FolderOpen size={18} className="shrink-0 text-blue-600 dark:text-blue-400" />}
                        <span id={`assign-folder-${group.id}`} className="truncate text-[15px] font-bold text-gray-900 dark:text-white">{group.name}</span>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:bg-[#2A2F3A] dark:text-[#d4d4d8]">{group.contracts.length}</span>
                      </span>
                      {collapsed ? <ChevronDown size={17} className="shrink-0 text-gray-400" /> : <ChevronUp size={17} className="shrink-0 text-gray-400" />}
                    </button>
                    {!collapsed && <div className="grid grid-cols-1 gap-3 border-l-2 border-gray-100 pl-3 dark:border-[#2A2F3A] md:grid-cols-2 md:pl-4">{group.contracts.map(renderContractCard)}</div>}
                  </section>
                );
              })}
              {contractGroups.length === 0 && <div className="rounded-2xl border border-dashed border-gray-200 p-8 text-center text-[14px] text-gray-500 dark:border-[#2A2F3A] dark:text-[#a1a1aa]">Nenhuma operação encontrada.</div>}
            </div>
          ) : (
            <div className="space-y-5">
              {vehicleGroups.map((group) => {
                const collapsed = Boolean(collapsedFolders[group.id]);
                return (
                  <section key={group.id} aria-labelledby={`assign-vehicle-folder-${group.id}`}>
                    <button type="button" onClick={() => toggleFolder(group.id)} className="mb-3 flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-[#121212]">
                      <span className="flex min-w-0 items-center gap-3">
                        {collapsed ? <Folder size={18} className="shrink-0 text-green-600 dark:text-green-400" /> : <FolderOpen size={18} className="shrink-0 text-green-600 dark:text-green-400" />}
                        <span id={`assign-vehicle-folder-${group.id}`} className="truncate text-[15px] font-bold text-gray-900 dark:text-white">{group.name}</span>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:bg-[#2A2F3A] dark:text-[#d4d4d8]">{group.vehicles.length}</span>
                      </span>
                      {collapsed ? <ChevronDown size={17} className="shrink-0 text-gray-400" /> : <ChevronUp size={17} className="shrink-0 text-gray-400" />}
                    </button>
                    {!collapsed && (
                      <div className="grid grid-cols-1 gap-3 border-l-2 border-gray-100 pl-3 dark:border-[#2A2F3A] md:grid-cols-2 md:pl-4">
                        {group.vehicles.map((vehicle) => {
                          const selected = selectedId === vehicle.id;
                          const usageCount = vehicleUsageById?.get(vehicle.id);
                          return (
                            <button type="button" key={vehicle.id} onClick={() => selectAndClose(vehicle.id)} className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-green-300 hover:shadow-md dark:bg-[#1A1F26] ${selected ? "border-green-500 ring-2 ring-green-500/15 dark:border-green-400" : "border-gray-200 dark:border-[#2A2F3A]"}`}>
                              <div className="flex items-start gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-gray-600 dark:bg-[#121212] dark:text-[#d4d4d8]"><Truck size={20} /></div>
                                <div className="min-w-0 flex-1">
                                  <h3 className="line-clamp-2 text-[15px] font-bold text-gray-900 dark:text-white">{vehicle.name}</h3>
                                  <p className="mt-1 flex items-center gap-1.5 text-[12px] text-gray-500 dark:text-[#a1a1aa]"><Users size={13} />Em uso por {usageCount == null ? "—" : usageCount} motorista{usageCount !== 1 ? "s" : ""}</p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
              {vehicleGroups.length === 0 && <div className="rounded-2xl border border-dashed border-gray-200 p-8 text-center text-[14px] text-gray-500 dark:border-[#2A2F3A] dark:text-[#a1a1aa]">Nenhum veículo encontrado.</div>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default AssignJobAssetPicker;
