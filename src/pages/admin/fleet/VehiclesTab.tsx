import { AvailableVehiclesButton } from "../../../components/admin/OperationalQueuesManager";
import React, { useMemo, useState } from "react";
import { useOperationalStore } from "../../../context/AppContext";
import { useCompanyStore } from "../../../context/CompanyContext";
import { Card, CardContent } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import FleetAssetFolderManager from "../../../components/admin/FleetAssetFolderManager";
import {
  resolveCurrentFleetUsageJobs,
  resolveFleetJobAssetId,
  resolveFleetJobDriverId,
} from "../../../lib/fleetUsage";
import { KeyRound, X, Pencil, Trash2, Users } from "lucide-react";

function VehiclesTab() {
  const {
    vehicles,
    sequences,
    addVehicle,
    updateVehicle,
    deleteVehicle,
    createSequence,
    updateSequence,
    deleteSequence,
    jobs,
    contracts,
    users,
  } = useOperationalStore();
  const { activeCompanyId, allCompanyMembers, allCompanyMembersReady } = useCompanyStore();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [paintCode, setPaintCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const contractsById = useMemo(
    () => new Map(contracts.map((contract) => [String(contract.id), contract] as const)),
    [contracts],
  );

  const currentUsageJobs = useMemo(
    () =>
      allCompanyMembersReady
        ? resolveCurrentFleetUsageJobs({
            jobs,
            members: allCompanyMembers,
            contracts,
            companyId: activeCompanyId,
          })
        : [],
    [activeCompanyId, allCompanyMembers, allCompanyMembersReady, contracts, jobs],
  );

  const getUsageJobs = (vehicleId: string) =>
    currentUsageJobs.filter(
      (job) => resolveFleetJobAssetId(job, "vehicle", contractsById) === vehicleId,
    );

  const renderUsageDetails = (vehicleId: string) => {
    const usageJobs = getUsageJobs(vehicleId);
    if (usageJobs.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-center text-xs text-gray-500 dark:border-nvu-line dark:bg-nvu-surface dark:text-nvu-muted">
          Nenhum motorista está usando este veículo em uma operação atual.
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {usageJobs.map((job) => {
          const driverId = resolveFleetJobDriverId(job);
          const driver = users.find((user) => user.id === driverId);
          return (
            <div key={String(job.id)} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-nvu-line dark:bg-nvu-surface">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{driver?.name || driver?.email || "Motorista sem nome"}</p>
                <p className="truncate text-[11px] text-gray-500 dark:text-nvu-muted">Motorista ativo com operação atual</p>
              </div>
              <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Em uso</span>
            </div>
          );
        })}
      </div>
    );
  };

  const resetForm = () => {
    setIsAdding(false);
    setEditingId(null);
    setName("");
    setPaintCode("");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (editingId) {
        await updateVehicle(editingId, { name: name.trim(), paintCode });
      } else {
        await addVehicle({ name: name.trim(), paintCode });
      }
      resetForm();
    } catch {
      // Context already reports the precise permission/network error.
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (id: string, currentName: string, currentPaintCode?: string) => {
    setEditingId(id);
    setName(currentName);
    setPaintCode(currentPaintCode || "");
    setIsAdding(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteVehicle(id);
    } catch {
      // Context already reports the precise permission/network error.
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end"><AvailableVehiclesButton/></div>
      {isAdding && (
        <Card className="relative mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-nvu-line dark:bg-nvu-surface dark:shadow-none">
          <div className="absolute left-0 top-0 h-1 w-full bg-green-500" />
          <CardContent className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-nvu-text">{editingId ? "Editar Veículo" : "Novo Veículo"}</h2>
              <button type="button" onClick={resetForm} className="text-gray-400 hover:text-gray-900 dark:text-nvu-text dark:hover:text-nvu-text"><X size={20} /></button>
            </div>
            <form onSubmit={(event) => void handleSubmit(event)} className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-nvu-text-soft">Modelo do veículo</label>
                <input type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex: Scania R500" className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-nvu-line dark:bg-nvu-surface dark:text-nvu-text dark:focus:bg-nvu-strip" required />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-nvu-text-soft">Código da Pintura <span className="font-normal text-gray-400">(Opcional)</span></label>
                <input type="text" value={paintCode} onChange={(event) => setPaintCode(event.target.value)} placeholder="Ex: #FF0000 ou Vermelho Metálico" className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-nvu-line dark:bg-nvu-surface dark:text-nvu-text dark:focus:bg-nvu-strip" />
              </div>
              <div className="mt-4 flex justify-end gap-3 md:col-span-2">
                <Button type="button" variant="ghost" disabled={isSubmitting} onClick={resetForm} className="text-gray-600 dark:text-nvu-text-soft">Cancelar</Button>
                <Button type="submit" disabled={isSubmitting} className="border-none bg-green-600 text-white shadow-sm hover:bg-green-700">{editingId ? "Salvar Alterações" : "Salvar Veículo"}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <FleetAssetFolderManager
        assets={vehicles}
        companyId={activeCompanyId || ""}
        scope="vehicles"
        sequences={sequences}
        assetLabel="Veículos"
        assetSingularLabel="Veículo"
        managementHint="Crie pastas para organizar a frota. Use o cadastro de veículo para registrar novos recursos; o uso exibido considera apenas motoristas ativos com operação atual."
        createAssetLabel="Registrar veículo"
        onCreateAsset={() => setIsAdding(true)}
        emptyMessage="Registre um novo veículo para sua frota usando o botão acima."
        createSequence={createSequence}
        updateSequence={updateSequence}
        deleteSequence={deleteSequence}
        onUpdateAsset={updateVehicle}
        renderAssetDetails={(vehicle) => renderUsageDetails(vehicle.id)}
        renderAsset={(vehicle) => {
          const usageCount = allCompanyMembersReady ? getUsageJobs(vehicle.id).length : null;
          return (
            <Card className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white shadow-none transition-shadow hover:shadow-sm dark:border-nvu-line dark:bg-nvu-surface dark:shadow-none">
              <CardContent className="p-3 md:p-4">
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span data-nvu-fleet-vehicle-icon className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-50 text-slate-600 dark:bg-nvu-surface dark:text-nvu-text-soft" aria-hidden="true"><KeyRound size={20} /></span>
                    <div className="min-w-0">
                      <h3 className="mb-1 truncate text-[14px] font-semibold leading-tight text-gray-900 dark:text-nvu-text">{vehicle.name}</h3>
                      <div className="flex items-center gap-1.5 text-[12px] text-gray-500 dark:text-nvu-muted"><Users size={12} /><span>Em uso por {usageCount === null ? "—" : usageCount} motorista{usageCount !== null && usageCount !== 1 ? "s" : ""}</span></div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => handleEdit(vehicle.id, vehicle.name, vehicle.paintCode)} className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:bg-blue-500/10 dark:text-nvu-muted dark:hover:text-blue-400" title="Editar veículo"><Pencil size={16} /></button>
                    <button type="button" onClick={() => void handleDelete(vehicle.id)} className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:bg-red-500/10 dark:text-nvu-muted dark:hover:text-red-400" title="Excluir veículo"><Trash2 size={16} /></button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        }}
      />
    </div>
  );
}

export default React.memo(VehiclesTab);
