import React, { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { Sequence } from "../../context/AppContext";
import { Button } from "../ui/Button";
import { Card, CardContent } from "../ui/Card";

type FolderScope = "operations" | "vehicles" | "trailers";

type FolderAsset = {
  id: string;
  name: string;
  sequenceId?: string | null;
  sequenceOrder?: number | null;
};

type AssetFolderManagerProps<T extends FolderAsset> = {
  assets: T[];
  companyId: string;
  scope: FolderScope;
  sequences: Sequence[];
  emptyMessage: string;
  assetLabel: string;
  assetSingularLabel: string;
  managementHint: string;
  createAssetLabel: string;
  onCreateAsset: () => void;
  renderAsset: (asset: T) => React.ReactNode;
  renderAssetDetails?: (asset: T) => React.ReactNode;
  onUpdateAsset: (
    id: string,
    updates: { sequenceId?: string | null; sequenceOrder?: number | null },
  ) => Promise<void>;
  createSequence: (
    sequence: Omit<Sequence, "id" | "createdAt">,
  ) => Promise<string | null>;
  updateSequence: (
    id: string,
    updates: Partial<Omit<Sequence, "id">>,
  ) => Promise<void>;
  deleteSequence: (id: string) => Promise<void>;
};

type FolderGroup<T extends FolderAsset> = {
  id: string;
  name: string;
  description?: string;
  assets: T[];
};

export function FleetAssetFolderManager<T extends FolderAsset>({
  assets,
  companyId,
  scope,
  sequences,
  emptyMessage,
  assetLabel,
  assetSingularLabel,
  managementHint,
  createAssetLabel,
  onCreateAsset,
  renderAsset,
  renderAssetDetails,
  onUpdateAsset,
  createSequence,
  updateSequence,
  deleteSequence,
}: AssetFolderManagerProps<T>) {
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [openFolderMenuId, setOpenFolderMenuId] = useState<string | null>(null);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [editFolderId, setEditFolderId] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderDescription, setFolderDescription] = useState("");
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);

  const activeSequences = useMemo(
    () => sequences.filter((sequence) => !sequence.deleted && (sequence.scope || "operations") === scope),
    [scope, sequences],
  );

  const groups = useMemo<FolderGroup<T>[]>(() => {
    const sortedAssets = [...assets].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    );
    const result: FolderGroup<T>[] = activeSequences.map((sequence) => ({
      id: sequence.id,
      name: sequence.name,
      description: sequence.description,
      assets: sortedAssets
        .filter((asset) => asset.sequenceId === sequence.id)
        .sort(
          (a, b) =>
            (Number(a.sequenceOrder ?? Number.MAX_SAFE_INTEGER) -
              Number(b.sequenceOrder ?? Number.MAX_SAFE_INTEGER)) ||
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
        ),
    }));
    const withoutFolder = sortedAssets.filter((asset) => !asset.sequenceId);
    result.push({ id: "none", name: "Sem pasta", assets: withoutFolder });
    return result;
  }, [activeSequences, assets]);

  const resetFolderForm = () => {
    setFolderModalOpen(false);
    setEditFolderId(null);
    setFolderName("");
    setFolderDescription("");
    setSelectedAssetIds([]);
  };

  const openCreateFolder = () => {
    setEditFolderId(null);
    setFolderName("");
    setFolderDescription("");
    setSelectedAssetIds([]);
    setFolderModalOpen(true);
  };

  const openEditFolder = (folderId: string) => {
    const sequence = activeSequences.find((item) => item.id === folderId);
    if (!sequence) return;
    setEditFolderId(folderId);
    setFolderName(sequence.name);
    setFolderDescription(sequence.description || "");
    setSelectedAssetIds(assets.filter((asset) => asset.sequenceId === folderId).map((asset) => asset.id));
    setOpenFolderMenuId(null);
    setFolderModalOpen(true);
  };

  const saveFolder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!folderName.trim()) return;
    setBusy(true);
    try {
      let folderId = editFolderId;
      if (folderId) {
        await updateSequence(folderId, {
          name: folderName.trim(),
          description: folderDescription.trim(),
        });
      } else {
        folderId = await createSequence({
          companyId,
          name: folderName.trim(),
          description: folderDescription.trim(),
          scope,
        });
      }
      if (folderId) {
        const previousAssets = assets.filter((asset) => asset.sequenceId === folderId);
        for (const asset of previousAssets) {
          if (!selectedAssetIds.includes(asset.id)) {
            await onUpdateAsset(asset.id, { sequenceId: null, sequenceOrder: null });
          }
        }
        for (let index = 0; index < selectedAssetIds.length; index += 1) {
          await onUpdateAsset(selectedAssetIds[index], {
            sequenceId: folderId,
            sequenceOrder: index,
          });
        }
      }
      resetFolderForm();
    } finally {
      setBusy(false);
    }
  };

  const moveAsset = async (assetId: string, sequenceId: string | null) => {
    setBusy(true);
    try {
      const targetGroup = groups.find((group) => group.id === sequenceId);
      const nextOrder = targetGroup ? targetGroup.assets.length : null;
      await onUpdateAsset(assetId, {
        sequenceId,
        sequenceOrder: sequenceId ? nextOrder : null,
      });
      setSelectedAsset(null);
    } finally {
      setBusy(false);
    }
  };

  const removeFolder = async (folderId: string) => {
    setBusy(true);
    try {
      await deleteSequence(folderId);
      setOpenFolderMenuId(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-3 text-[12px] leading-relaxed text-blue-900 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-100">
        {managementHint}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button
          type="button"
          onClick={openCreateFolder}
          className="h-10 justify-center gap-1.5 rounded-xl bg-blue-600 px-3 text-[13px] font-semibold text-white hover:bg-blue-700"
        >
          <FolderPlus size={15} />
          Criar pasta
        </Button>
        <Button
          type="button"
          onClick={onCreateAsset}
          className="h-10 justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-[13px] font-semibold text-white hover:bg-emerald-700"
        >
          <Plus size={15} />
          {createAssetLabel}
        </Button>
      </div>

      {assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-12 text-center dark:border-[#2A2F3A] dark:bg-[#1A1F26]">
          <p className="mx-auto max-w-sm text-gray-500 dark:text-[#a1a1aa]">{emptyMessage}</p>
        </div>
      ) : (
        groups.map((group) => {
          const collapsed = Boolean(collapsedFolders[group.id]);
          return (
            <section key={group.id} className="space-y-2">
              <div className="relative flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2.5 dark:border-[#2A2F3A] dark:bg-[#1A1F26]">
                <button
                  type="button"
                  onClick={() => setCollapsedFolders((current) => ({ ...current, [group.id]: !current[group.id] }))}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  aria-expanded={!collapsed}
                >
                  {collapsed ? <Folder size={17} className="shrink-0 text-blue-600" /> : <FolderOpen size={17} className="shrink-0 text-blue-600" />}
                  <span className="truncate text-sm font-bold text-gray-900 dark:text-white">{group.name}</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:bg-[#2A2F3A] dark:text-[#d4d4d8]">{group.assets.length}</span>
                  {collapsed ? <ChevronDown size={16} className="ml-auto shrink-0 text-gray-400" /> : <ChevronUp size={16} className="ml-auto shrink-0 text-gray-400" />}
                </button>
                {group.id !== "none" && (
                  <div className="relative ml-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setOpenFolderMenuId((current) => current === group.id ? null : group.id)}
                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-[#2A2F3A] dark:hover:text-white"
                      aria-label={`Gerenciar pasta ${group.name}`}
                    >
                      <MoreVertical size={17} />
                    </button>
                  </div>
                )}
              </div>
              {!collapsed && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {group.assets.map((asset) => (
                    <div
                      key={asset.id}
                      className={`relative ${renderAssetDetails ? "cursor-pointer" : ""}`}
                      onClick={(event) => {
                        if (!renderAssetDetails) return;
                        const target = event.target as HTMLElement;
                        if (target.closest("button, input, textarea, select, a")) return;
                        setSelectedAsset(asset);
                      }}
                    >
                      {renderAsset(asset)}

                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}

      {openFolderMenuId && (
        <div className="fixed inset-0 z-[1850] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpenFolderMenuId(null); }}>
          <Card className="w-full max-w-sm rounded-2xl bg-white shadow-2xl dark:bg-[#1A1F26]" role="dialog" aria-modal="true">
            <CardContent className="p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600">Pasta de {assetLabel.toLowerCase()}</p>
                  <h2 className="mt-1 text-lg font-bold text-gray-900 dark:text-white">{activeSequences.find((sequence) => sequence.id === openFolderMenuId)?.name}</h2>
                  <p className="mt-1 text-xs text-gray-500 dark:text-[#a1a1aa]">Escolha o que deseja editar nesta pasta administrativa.</p>
                </div>
                <button type="button" onClick={() => setOpenFolderMenuId(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-[#2A2F3A]" aria-label="Fechar ações da pasta"><X size={18} /></button>
              </div>
              <div className="grid grid-cols-1 gap-2">
                <Button type="button" onClick={() => openEditFolder(openFolderMenuId)} className="justify-start gap-2 bg-blue-600 text-white hover:bg-blue-700"><Pencil size={15} />Editar pasta</Button>
                <Button type="button" disabled={busy} onClick={() => void removeFolder(openFolderMenuId)} className="justify-start gap-2 bg-red-600 text-white hover:bg-red-700"><Trash2 size={15} />Excluir pasta</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {folderModalOpen && (
        <div className="fixed inset-0 z-[1800] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]">
          <Card className="max-h-[88vh] w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-[#1A1F26]">
            <CardContent className="max-h-[88vh] overflow-y-auto p-5 sm:p-6">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600">Gerenciamento administrativo</p>
                  <h2 className="mt-1 text-lg font-bold text-gray-900 dark:text-white">{editFolderId ? "Editar pasta" : "Criar pasta"}</h2>
                  <p className="mt-1 text-xs text-gray-500 dark:text-[#a1a1aa]">Esta pasta organiza somente {assetLabel.toLowerCase()}.</p>
                </div>
                <button type="button" onClick={resetFolderForm} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-[#2A2F3A]" aria-label="Fechar formulário de pasta"><X size={18} /></button>
              </div>
              <form onSubmit={(event) => void saveFolder(event)} className="space-y-4">
                <label className="block text-sm font-semibold text-gray-700 dark:text-[#d4d4d8]">Nome da pasta<input value={folderName} onChange={(event) => setFolderName(event.target.value)} autoFocus required className="mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-[#2A2F3A] dark:bg-[#121212] dark:text-white" /></label>
                <label className="block text-sm font-semibold text-gray-700 dark:text-[#d4d4d8]">Descrição <span className="font-normal text-gray-400">(opcional)</span><textarea value={folderDescription} onChange={(event) => setFolderDescription(event.target.value)} rows={2} className="mt-1.5 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-[#2A2F3A] dark:bg-[#121212] dark:text-white" /></label>
                <div>
                  <p className="mb-2 text-sm font-semibold text-gray-700 dark:text-[#d4d4d8]">{assetLabel} na pasta</p>
                  <div className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-gray-200 p-3 dark:border-[#2A2F3A]">
                    {assets.map((asset) => (
                      <label key={asset.id} className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-[#d4d4d8]">
                        <input type="checkbox" checked={selectedAssetIds.includes(asset.id)} onChange={(event) => setSelectedAssetIds((current) => event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))} />
                        <span className="truncate">{asset.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" onClick={resetFolderForm}>Cancelar</Button>
                  <Button type="submit" disabled={busy} className="bg-blue-600 text-white hover:bg-blue-700">{busy ? "Salvando…" : "Salvar pasta"}</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {selectedAsset && renderAssetDetails && (
        <div className="fixed inset-0 z-[1850] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedAsset(null); }}>
          <Card className="w-full max-w-md rounded-2xl bg-white shadow-2xl dark:bg-[#1A1F26]" role="dialog" aria-modal="true">
            <CardContent className="p-5 sm:p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Detalhes do {assetSingularLabel.toLowerCase()}</p>
                  <h2 className="mt-1 truncate text-lg font-bold text-gray-900 dark:text-white">{selectedAsset.name}</h2>
                  <p className="mt-1 text-xs text-gray-500 dark:text-[#a1a1aa]">Motoristas com operação atual vinculada a este recurso.</p>
                </div>
                <button type="button" onClick={() => setSelectedAsset(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-[#2A2F3A]" aria-label="Fechar detalhes"><X size={18} /></button>
              </div>
              {renderAssetDetails(selectedAsset)}
              <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/70 p-3 dark:border-blue-500/20 dark:bg-blue-500/10">
                <p className="text-xs font-bold text-blue-900 dark:text-blue-100">Editar pasta de {assetSingularLabel.toLowerCase()}: {selectedAsset.name}</p>
                <p className="mt-1 text-[11px] text-blue-800/80 dark:text-blue-100/80">Escolha uma pasta exclusiva de {assetLabel.toLowerCase()} para este recurso.</p>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button type="button" variant="outline" disabled={busy} onClick={() => void moveAsset(selectedAsset.id, null)} className="justify-center text-xs">Sem pasta</Button>
                  {activeSequences.map((sequence) => (
                    <Button key={sequence.id} type="button" disabled={busy} onClick={() => void moveAsset(selectedAsset.id, sequence.id)} className="justify-center truncate bg-blue-600 text-xs text-white hover:bg-blue-700">{sequence.name}</Button>
                  ))}
                </div>
              </div>
              <div className="mt-5 flex justify-end">
                <Button type="button" variant="outline" onClick={() => setSelectedAsset(null)}>Fechar</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default FleetAssetFolderManager;
