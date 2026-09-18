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
import { Container, Plus, X, Pencil, Trash2, Users } from "lucide-react";

function TrailersTab() {
  const {
    trailers,
    sequences,
    addTrailer,
    updateTrailer,
    deleteTrailer,
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

  const getUsageJobs = (trailerId: string) =>
    currentUsageJobs.filter(
      (job) => resolveFleetJobAssetId(job, "trailer", contractsById) === trailerId,
    );

  const renderUsageDetails = (trailerId: string) => {
    const usageJobs = getUsageJobs(trailerId);
    if (usageJobs.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-center text-xs text-gray-500 dark:border-[#2A2F3A] dark:bg-[#121212] dark:text-[#a1a1aa]">
          Nenhum motorista está usando este reboque em uma operação atual.
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {usageJobs.map((job) => {
          const driverId = resolveFleetJobDriverId(job);
          const driver = users.find((user) => user.id === driverId);
          return (
            <div key={String(job.id)} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-[#2A2F3A] dark:bg-[#121212]">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{driver?.name || driver?.email || "Motorista sem nome"}</p>
                <p className="truncate text-[11px] text-gray-500 dark:text-[#a1a1aa]">Motorista ativo com operação atual</p>
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
    if (!name.trim()) return;
    try {
      if (editingId) {
        await updateTrailer(editingId, { name: name.trim(), paintCode });
      } else {
        await addTrailer({ name: name.trim(), paintCode });
      }
      resetForm();
    } catch {
      // Context already reports the precise permission/network error.
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
      await deleteTrailer(id);
    } catch {
      // Context already reports the precise permission/network error.
    }
  };

  return (
    <div className="space-y-6">
      {isAdding && (
        <Card className="relative mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-[#2A2F3A] dark:bg-[#1A1F26] dark:shadow-none">
          <div className="absolute left-0 top-0 h-1 w-full bg-green-500" />
          <CardContent className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-[#fafafa]">{editingId ? "Editar Reboque" : "Novo Reboque"}</h2>
              <button type="button" onClick={resetForm} className="text-gray-400 hover:text-gray-900 dark:text-[#fafafa] dark:hover:text-[#f4f4f5]"><X size={20} /></button>
            </div>
            <form onSubmit={(event) => void handleSubmit(event)} className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-[#d4d4d8]">Tipo / Nome do Reboque</label>
                <input type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex: Baú Seco 30m³" className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-[#2A2F3A] dark:bg-[#1A1F26] dark:text-[#fafafa] dark:focus:bg-[#0a0a0b]" required />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-[#d4d4d8]">Código da Pintura <span className="font-normal text-gray-400">(Opcional)</span></label>
                <input type="text" value={paintCode} onChange={(event) => setPaintCode(event.target.value)} placeholder="Ex: #00FF00 ou Verde Folha" className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-[#2A2F3A] dark:bg-[#1A1F26] dark:text-[#fafafa] dark:focus:bg-[#0a0a0b]" />
              </div>
              <div className="mt-4 flex justify-end gap-3 md:col-span-2">
                <Button type="button" variant="ghost" onClick={resetForm} className="text-gray-600 dark:text-[#d4d4d8]">Cancelar</Button>
                <Button type="submit" className="border-none bg-green-600 text-white shadow-sm hover:bg-green-700">{editingId ? "Salvar Alterações" : "Salvar Reboque"}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <FleetAssetFolderManager
        assets={trailers}
        companyId={activeCompanyId || ""}
        scope="trailers"
        sequences={sequences}
        assetLabel="Reboques"
        assetSingularLabel="Reboque"
        managementHint="Crie pastas para organizar os reboques. Use o cadastro de reboque para registrar novos recursos; o uso exibido considera apenas motoristas ativos com operação atual."
        createAssetLabel="Registrar reboque"
        onCreateAsset={() => setIsAdding(true)}
        emptyMessage="Registre um novo reboque para sua frota usando o botão acima."
        createSequence={createSequence}
        updateSequence={updateSequence}
        deleteSequence={deleteSequence}
        onUpdateAsset={updateTrailer}
        renderAssetDetails={(trailer) => renderUsageDetails(trailer.id)}
        renderAsset={(trailer) => {
          const usageCount = allCompanyMembersReady ? getUsageJobs(trailer.id).length : null;
          return (
            <Card className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white shadow-none transition-shadow hover:shadow-sm dark:border-[#2A2F3A] dark:bg-[#1A1F26] dark:shadow-none">
              <CardContent className="p-3 md:p-4">
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-600 dark:bg-[#1A1F26] dark:text-[#d4d4d8]"><Container size={20} /></div>
                    <div className="min-w-0">
                      <h3 className="mb-1 truncate text-[14px] font-semibold leading-tight text-gray-900 dark:text-[#fafafa]">{trailer.name}</h3>
                      <div className="flex items-center gap-1.5 text-[12px] text-gray-500 dark:text-[#a1a1aa]"><Users size={12} /><span>Em uso por {usageCount === null ? "—" : usageCount} motorista{usageCount !== null && usageCount !== 1 ? "s" : ""}</span></div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => handleEdit(trailer.id, trailer.name, trailer.paintCode)} className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:bg-blue-500/10 dark:text-gray-400 dark:hover:text-blue-400" title="Editar reboque"><Pencil size={16} /></button>
                    <button type="button" onClick={() => void handleDelete(trailer.id)} className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:bg-red-500/10 dark:text-gray-400 dark:hover:text-red-400" title="Excluir reboque"><Trash2 size={16} /></button>
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

export default React.memo(TrailersTab);
