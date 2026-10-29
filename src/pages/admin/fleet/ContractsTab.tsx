import { ModalSelect } from "../../../components/ui/ModalSelect";
import { OperationalQueuesManager } from "../../../components/admin/OperationalQueuesManager";
import { OperationalQueueGuide } from "../../../components/admin/OperationalQueueGuide";
import { useOptionalAutomaticOperations } from "../../../contexts/AutomaticOperationsProvider";
import { orderOperationalContracts, orderOperationalFolders } from "../../../lib/operationalQueueOrder";
import React, { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useOperationalStore } from "../../../context/AppContext";
import { useCompanyStore } from "../../../context/CompanyContext";
import { Card, CardContent } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import {
  FileText,
  Plus,
  X,
  MapPin,
  Trash2,
  Pencil,
  Search,
  MoreVertical,
  PlayCircle,
  Edit2,
  Trash,
  Truck,
  Filter,
  FolderPlus,
  Folder,
  FolderOpen,
  FolderTree,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Contract } from "../../../context/AppContext";

interface ContractsTabProps {
  editContractId?: string | null;
  onEditComplete?: () => void;
}

function ContractsTab({
  editContractId,
  onEditComplete,
}: ContractsTabProps = {}) {
  const { companies, activeCompanyId, allCompanyMembers } = useCompanyStore();
  const {
    contracts,
    sequences,
    createSequence,
    updateSequence,
    deleteSequence,
    updateContract,
    deleteContract,
    trailers,
    jobs,
    users,
  } = useOperationalStore();
  const activeCompany = companies.find((c) => c.id === activeCompanyId);
  const navigate = useNavigate();
  const automatic=useOptionalAutomaticOperations();
  const [queueManager,setQueueManager]=useState<{folderId?:string}|null>(null);
  const [search, setSearch] = useState("");
  const [trailerFilter, setTrailerFilter] = useState("all");
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [openFolderDropdownId, setOpenFolderDropdownId] = useState<string | null>(null);
  const [contractToDelete, setContractToDelete] = useState<string | null>(null);
  const [sequenceToDelete, setSequenceToDelete] = useState<string | null>(null);


  // Sequence Modal
  const [isSequenceModalOpen, setIsSequenceModalOpen] = useState(false);
  const [editSequenceId, setEditSequenceId] = useState<string | null>(null);
  const [sequenceName, setSequenceName] = useState("");
  const [sequenceDesc, setSequenceDesc] = useState("");
  const [selectedContracts, setSelectedContracts] = useState<string[]>([]);
  
  // Move Modal
  const [moveContractId, setMoveContractId] = useState<string | null>(null);
  
  const [successMsg, setSuccessMsg] = useState("");
  
  const [collapsedSequences, setCollapsedSequences] = useState<Record<string, boolean>>({});
  const [selectedContractForDrivers, setSelectedContractForDrivers] = useState<Contract | null>(null);

  const toggleSequence = (id: string) => {
    setCollapsedSequences(prev => ({...prev, [id]: !prev[id]}));
  };

  const filteredContracts = contracts.filter((c) => {
    const matchesSearch =
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.simulator.toLowerCase().includes(search.toLowerCase());
    const matchesTrailer =
      trailerFilter === "all" ||
      (trailerFilter === "none" && !c.trailerId) ||
      c.trailerId === trailerFilter;

    return matchesSearch && matchesTrailer;
  });

  const getGroupedContracts = () => {
    const groups: { seq: any, contracts: Contract[] }[] = [];
    
    // Pastas de Operações; pastas de Veículos/Reboques não pertencem a esta página.
    orderOperationalFolders(sequences,automatic?.settings)
      .filter((seq) => !seq.deleted && (seq.scope || "operations") === "operations")
      .forEach(seq => {
      groups.push({
        seq: seq,
        contracts: orderOperationalContracts(filteredContracts.filter(c => c.sequenceId === seq.id),automatic?.settings)
      });
      });
    
    // Sem sequencia
    groups.push({
      seq: { id: "none", name: "Sem pasta" },
      contracts: orderOperationalContracts(filteredContracts.filter(c => !c.sequenceId),automatic?.settings)
    });
    
    return groups;
  };

  const groupedContracts = getGroupedContracts();

  const getAssignedDrivers = (contractId: string) => {
    const activeDriverIds = new Set(
      allCompanyMembers
        .filter((member) => member.status === "active" && member.roles.includes("driver"))
        .map((member) => member.userId),
    );
    const seen = new Set<string>();
    return jobs
      .filter((job) => {
        const driverId = String(job.driverId || job.motoristaId || "").trim();
        return job.contractId === contractId && Boolean(driverId) && activeDriverIds.has(driverId) && !["completed", "cancelled"].includes(String(job.status || "").toLowerCase());
      })
      .filter((job) => {
        const driverId = String(job.driverId || job.motoristaId || "").trim();
        if (seen.has(driverId)) return false;
        seen.add(driverId);
        return true;
      });
  };

  const handleCreateSequence = async () => {
    if (!sequenceName.trim() || !activeCompanyId) return;
    
    if (editSequenceId) {
      await updateSequence(editSequenceId, { name: sequenceName, description: sequenceDesc });
      // Update contracts order and association
      // 1. Remove from all existing not selected
      const currentContracts = contracts.filter(c => c.sequenceId === editSequenceId);
      for (const c of currentContracts) {
         if (!selectedContracts.includes(c.id)) {
             await updateContract(c.id, { sequenceId: null, sequenceOrder: null });
         }
      }
      // 2. Add selected with new order
      for (let i = 0; i < selectedContracts.length; i++) {
         await updateContract(selectedContracts[i], { sequenceId: editSequenceId, sequenceOrder: i });
      }
      
    } else {
      await createSequence({
        companyId: activeCompanyId,
        name: sequenceName,
        description: sequenceDesc,
        scope: "operations",
      });
      // We would ideally get the new ID and link them, but without returned ID we might just create empty.
      // Firebase addDoc doesn't return ID directly in our store unless we modify it, so we'll just skip assigning immediately or let user assign later.
      // Or we can modify createSequence to return string. Since we can't do that now easily, we just create empty.
    }
    closeSequenceModal();
  };
  
  const closeSequenceModal = () => {
    setIsSequenceModalOpen(false);
    setEditSequenceId(null);
    setSequenceName("");
    setSequenceDesc("");
    setSelectedContracts([]);
  };

  return (
      <div className="flex flex-col gap-4 pb-20 sm:gap-6">
      {queueManager&&<OperationalQueuesManager key={automatic?.scopeKey} initialFolderId={queueManager.folderId} onClose={()=>setQueueManager(null)}
        onCreateOperation={() => { setQueueManager(null); navigate("/admin/contract/new"); }}
        onCreateFolder={() => { setQueueManager(null); setIsSequenceModalOpen(true); }} />}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-nvu-line dark:bg-nvu-surface" aria-label="Envio automático de operações">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-nvu-text">Envio automático de operações</h2>
          <Button size="sm" variant="outline" onClick={()=>setQueueManager({})}>Filas operacionais</Button>
        </div>
        <p className="mb-3 mt-2 text-xs leading-relaxed text-slate-500 dark:text-nvu-muted">Crie as operações, organize em pastas e ative uma fila. O NVU libera os trabalhos na ordem definida para cada motorista.</p>
        <OperationalQueueGuide />
      </section>
            {successMsg && (
        <div className="bg-green-50 text-green-700 p-3 rounded-xl border border-green-200 text-sm font-medium animate-in fade-in">
          {successMsg}
        </div>
      )}

      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-center justify-between">
        <div className="flex gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              placeholder="Buscar operação..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-4 rounded-lg bg-white dark:bg-nvu-surface border border-gray-200 dark:border-nvu-line text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all dark:text-white"
            />
          </div>
          <div className="relative group shrink-0">
            <ModalSelect title="Filtrar por reboque" showChevron={false}
              value={trailerFilter}
              onChange={(e) => setTrailerFilter(e.target.value)}
              className="h-9 pl-9 pr-8 rounded-lg bg-white dark:bg-nvu-surface border border-gray-200 dark:border-nvu-line text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 appearance-none cursor-pointer transition-all dark:text-white hover:bg-gray-50 dark:hover:bg-nvu-strip"
            >
              <option value="all">Todos reboques</option>
              <option value="none">Sem reboque (Truck)</option>
              {trailers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </ModalSelect>
            <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <Filter size={16} className="text-gray-400" />
            </div>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                className="text-gray-400"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          </div>
        </div>
        
        <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2">
          <Button
            onClick={() => setIsSequenceModalOpen(true)}
            className="h-10 justify-center gap-1.5 rounded-xl bg-blue-600 px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <FolderPlus size={16} />
            Criar pasta
          </Button>
          <Button
            onClick={() => navigate("/admin/contract/new")}
            className="h-10 justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            <Plus size={16} />
            Criar operação
          </Button>
        </div>
      </div>

      {filteredContracts.length === 0 && sequences.length === 0 && search === "" && trailerFilter === "all" ? (
        <div className="text-center py-12 bg-white dark:bg-nvu-surface rounded-2xl border border-gray-200 dark:border-nvu-line border-dashed">
          <div className="mx-auto w-16 h-16 bg-gray-50 dark:bg-nvu-surface rounded-full flex items-center justify-center text-gray-400 mb-4">
            <FileText size={24} />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-nvu-text">
            Nenhuma operação encontrada
          </h3>
          <p className="text-gray-500 dark:text-nvu-muted mt-1 max-w-sm mx-auto">
            Crie sua primeira operação para começar.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groupedContracts.map(group => {
             const isCollapsed = collapsedSequences[group.seq.id];
             if (group.contracts.length === 0 && group.seq.id === "none") return null;
             
             return (
               <div key={group.seq.id} className="flex flex-col gap-3">
                 {/* Group Header */}
                 <div 
                   className="flex items-center justify-between group/header cursor-pointer py-2 px-3 hover:bg-gray-50 dark:hover:bg-nvu-surface rounded-lg transition-colors border border-transparent hover:border-gray-200 dark:hover:border-nvu-line mb-2"
                   onClick={() => toggleSequence(group.seq.id)}
                 >
                   <div className="flex items-center gap-3">
                     <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-500">
                       {!isCollapsed ? <FolderOpen size={16} className={group.seq.id === "none" ? "text-gray-400" : "fill-blue-500/20 text-blue-600"} /> : <Folder size={16} className={group.seq.id === "none" ? "text-gray-400" : "fill-blue-500/20 text-blue-600"} />}
                     </div>
                     <h3 className="font-semibold text-[15px] text-gray-900 dark:text-nvu-text">
                       {group.seq.name}
                     </h3>
                     <span className="text-[12px] font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-nvu-strip text-gray-600 dark:text-nvu-muted">
                       {group.contracts.length}
                     </span>
                   </div>
                   
                   {group.seq.id !== "none" && (
                     <div className="relative" onClick={e => e.stopPropagation()}>
                       <button
                         onClick={() => setOpenFolderDropdownId(openFolderDropdownId === group.seq.id ? null : group.seq.id)}
                         className="p-1.5 text-gray-400 hover:text-gray-700 dark:text-nvu-text-soft dark:hover:text-nvu-text-soft rounded-lg hover:bg-gray-100 dark:bg-transparent dark:hover:bg-nvu-strip transition-colors"
                       >
                         <MoreVertical size={18} />
                       </button>

                     </div>
                   )}
                 </div>
                 
                 {/* Group Grid */}
                 {!isCollapsed && (
                   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 lg:gap-6 pl-2 sm:pl-4 border-l-2 border-gray-100 dark:border-nvu-line ml-2">
                    {group.contracts.length === 0 ? (
                       <div className="col-span-full text-[13px] text-gray-400 italic py-2">
                         Nenhuma operação encontrada
                       </div>
                    ) : (
                      group.contracts.map((contract) => {
                        const contractTrailer = trailers.find(
                          (t) => t.id === contract.trailerId,
                        );

                        return (
                          <Card
                            key={contract.id}
                            className="rounded-2xl border border-gray-200 dark:border-nvu-line/80 shadow-sm dark:shadow-none relative overflow-visible bg-white dark:bg-nvu-surface hover:border-gray-300 dark:border-nvu-line hover:shadow-md dark:shadow-none transition-all cursor-pointer group/card"
                            onClick={() => setSelectedContractForDrivers(contract)}
                          >
                            <CardContent className="p-4 sm:p-5">
                              <div className="flex justify-between items-start mb-3">
                                <div className="pr-8">
                                  <h3 className="font-bold text-gray-900 dark:text-nvu-text text-[15px] sm:text-[16px] leading-tight mb-1 line-clamp-2">
                                    {contract.name}
                                  </h3>
                                  <p className="text-[13px] font-medium text-gray-500 dark:text-nvu-muted truncate flex items-center gap-1.5">
                                    <Truck size={14} className="text-gray-400" />
                                    {contractTrailer
                                      ? contractTrailer.name
                                      : "Qualquer reboque"}
                                  </p>
                                </div>
                                <div
                                  className="absolute top-3 right-3"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    onClick={() =>
                                      setOpenDropdownId(
                                        openDropdownId === contract.id ? null : contract.id,
                                      )
                                    }
                                    className="p-1.5 text-gray-400 hover:text-gray-700 dark:text-nvu-text-soft dark:hover:text-nvu-text-soft hover:bg-gray-100 dark:bg-nvu-strip dark:hover:bg-nvu-strip/50 rounded-full transition-colors"
                                  >
                                    <MoreVertical size={18} />
                                  </button>
                                  {openDropdownId === contract.id && (
                                    <>
                                      <div
                                        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px] transition-opacity"
                                        onClick={() => setOpenDropdownId(null)}
                                      ></div>
                                      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[85vw] max-w-[300px] bg-white dark:bg-nvu-surface border border-gray-200 dark:border-nvu-line rounded-2xl shadow-2xl dark:shadow-none z-50 py-2 origin-center animate-in fade-in zoom-in-95 duration-200">
                                        <button
                                          onClick={() => {
                                            setOpenDropdownId(null);
                                            navigate(`/admin/contract/${contract.id}`);
                                          }}
                                          className="w-full text-left px-5 py-3.5 text-[15px] font-medium text-gray-700 dark:text-nvu-text-soft hover:bg-gray-50 dark:bg-nvu-surface dark:hover:bg-nvu-strip flex items-center gap-3"
                                        >
                                          <FileText size={14} className="text-gray-500" />
                                          Ver detalhes da operação
                                        </button>
                                        <button
                                          onClick={() => {
                                            setOpenDropdownId(null);
                                            navigate(`/admin/contract/${contract.id}/edit`);
                                          }}
                                          className="w-full text-left px-5 py-3.5 text-[15px] font-medium text-gray-700 dark:text-nvu-text-soft hover:bg-gray-50 dark:bg-nvu-surface dark:hover:bg-nvu-strip flex items-center gap-3"
                                        >
                                          <Edit2
                                            size={14}
                                            className="text-gray-500 dark:text-nvu-muted"
                                          />
                                          Editar Operação
                                        </button>
                                        <button
                                          onClick={() => {
                                            setOpenDropdownId(null);
                                            setMoveContractId(contract.id);
                                          }}
                                          className="w-full text-left px-5 py-3.5 text-[15px] font-medium text-gray-700 dark:text-nvu-text-soft hover:bg-gray-50 dark:bg-nvu-surface dark:hover:bg-nvu-strip flex items-center gap-3"
                                        >
                                          <Folder
                                            size={14}
                                            className="text-gray-500 dark:text-nvu-muted"
                                          />
                                          Mover para pasta
                                        </button>
                                        
                                        {contract.sequenceId && (
                                           <button
                                            onClick={async () => {
                                              setOpenDropdownId(null);
                                              try {
                                                await updateContract(contract.id, { sequenceId: null, sequenceOrder: null });
                                              } catch {
                                                // Context already reports the precise error.
                                              }
                                            }}
                                            className="w-full text-left px-5 py-3.5 text-[15px] font-medium text-gray-700 dark:text-nvu-text-soft hover:bg-gray-50 dark:bg-nvu-surface dark:hover:bg-nvu-strip flex items-center gap-3"
                                          >
                                            <X
                                              size={14}
                                              className="text-gray-500 dark:text-nvu-muted"
                                            />
                                            Remover da pasta
                                          </button>
                                        )}
                                        
                                        <div className="h-px w-full bg-gray-100 dark:bg-nvu-line my-1"></div>
                                        <button
                                          onClick={() => {
                                            setOpenDropdownId(null);
                                            setContractToDelete(contract.id);
                                          }}
                                          className="w-full text-left px-5 py-3.5 text-[15px] font-medium text-red-600 hover:bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 flex items-center gap-3"
                                        >
                                          <Trash size={14} className="text-red-500" />
                                          Excluir Operação
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-900 dark:text-nvu-text bg-gray-50 dark:bg-nvu-surface/80 p-2.5 rounded-lg border border-gray-100 dark:border-nvu-line">
                                <span>{contract.totalDeliveries} entregas</span>
                                <span className="text-gray-300">•</span>
                                <span>{contract.deadlineDays} dias</span>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })
                    )}
                   </div>
                 )}
               </div>
             );
          })}
        </div>
      )}
      
      {selectedContractForDrivers && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedContractForDrivers(null); }}>
          <Card className="w-full max-w-md rounded-2xl bg-white shadow-2xl dark:bg-nvu-surface" role="dialog" aria-modal="true">
            <CardContent className="p-5 sm:p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600">Motoristas atribuídos</p>
                  <h2 className="mt-1 truncate text-lg font-bold text-gray-900 dark:text-white">{selectedContractForDrivers.name}</h2>
                  <p className="mt-1 text-xs text-gray-500 dark:text-nvu-muted">Somente motoristas ativos da empresa com esta operação designada.</p>
                </div>
                <button type="button" onClick={() => setSelectedContractForDrivers(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-nvu-strip" aria-label="Fechar lista de motoristas"><X size={18} /></button>
              </div>
              {getAssignedDrivers(selectedContractForDrivers.id).length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-center text-xs text-gray-500 dark:border-nvu-line dark:bg-nvu-surface dark:text-nvu-muted">Nenhum motorista ativo recebeu esta operação.</div>
              ) : (
                <div className="space-y-2">
                  {getAssignedDrivers(selectedContractForDrivers.id).map((job) => {
                    const driverId = String(job.driverId || job.motoristaId || "").trim();
                    const driver = users.find((user) => user.id === driverId);
                    return (
                      <div key={String(job.id)} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-nvu-line dark:bg-nvu-surface">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{driver?.name || driver?.email || "Motorista sem nome"}</p>
                          <p className="truncate text-[11px] text-gray-500 dark:text-nvu-muted">Status: {String(job.status || "atribuída")}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-blue-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">Designado</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-5 flex justify-end"><Button type="button" variant="outline" onClick={() => setSelectedContractForDrivers(null)}>Fechar</Button></div>
            </CardContent>
          </Card>
        </div>
      )}

      {openFolderDropdownId && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpenFolderDropdownId(null); }}>
          <Card className="w-full max-w-sm rounded-2xl bg-white shadow-2xl dark:bg-nvu-surface" role="dialog" aria-modal="true">
            <CardContent className="p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600">Pasta de operações</p>
                  <h2 className="mt-1 text-lg font-bold text-gray-900 dark:text-white">{sequences.find((sequence) => sequence.id === openFolderDropdownId)?.name}</h2>
                  <p className="mt-1 text-xs text-gray-500 dark:text-nvu-muted">Escolha o que deseja editar nesta pasta administrativa.</p>
                </div>
                <button type="button" onClick={() => setOpenFolderDropdownId(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-nvu-strip" aria-label="Fechar ações da pasta"><X size={18} /></button>
              </div>
              <div className="grid gap-2">
                <Button type="button" variant="outline" onClick={()=>{setQueueManager({folderId:openFolderDropdownId});setOpenFolderDropdownId(null);}}>Configurar fila operacional</Button>
                <Button type="button" onClick={() => { const sequence = sequences.find((item) => item.id === openFolderDropdownId); if (!sequence) return; setOpenFolderDropdownId(null); setEditSequenceId(sequence.id); setSequenceName(sequence.name); setSequenceDesc(sequence.description || ""); setSelectedContracts(groupedContracts.find((group) => group.seq.id === sequence.id)?.contracts.map((contract) => contract.id) || []); setIsSequenceModalOpen(true); }} className="justify-start gap-2 bg-blue-600 text-white hover:bg-blue-700"><Edit2 size={15} />Editar pasta</Button>
                <Button type="button" onClick={() => { setOpenFolderDropdownId(null); setSequenceToDelete(openFolderDropdownId); }} className="justify-start gap-2 bg-red-600 text-white hover:bg-red-700"><Trash2 size={15} />Excluir pasta</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Sequence Modal */}
      {isSequenceModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-nvu-surface rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
             <div className="flex items-center justify-between p-5 sm:p-6 border-b border-gray-100 dark:border-nvu-line">
                <h3 className="text-lg font-bold text-gray-900 dark:text-nvu-text">
                  {editSequenceId ? "Editar Pasta" : "Nova Pasta"}
                </h3>
                <button
                  onClick={closeSequenceModal}
                  className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-nvu-text-soft rounded-full hover:bg-gray-100 dark:hover:bg-nvu-strip transition-colors"
                >
                  <X size={20} />
                </button>
             </div>
             <div className="p-5 sm:p-6 flex-1 overflow-y-auto">
               <div className="space-y-4">
                 <div>
                   <label className="block text-sm font-medium text-gray-700 dark:text-nvu-text-soft mb-1">
                     Nome da pasta *
                   </label>
                   <input
                     type="text"
                     placeholder="Ex: Operações Noturnas"
                     value={sequenceName}
                     onChange={e => setSequenceName(e.target.value)}
                     className="w-full h-10 px-3 rounded-lg border border-gray-200 dark:border-nvu-line bg-white dark:bg-nvu-page text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all dark:text-white"
                   />
                 </div>
                 <div>
                   <label className="block text-sm font-medium text-gray-700 dark:text-nvu-text-soft mb-1">
                     Descrição (opcional)
                   </label>
                   <textarea
                     placeholder="Detalhes sobre a pasta"
                     value={sequenceDesc}
                     onChange={e => setSequenceDesc(e.target.value)}
                     className="w-full h-20 p-3 rounded-lg border border-gray-200 dark:border-nvu-line bg-white dark:bg-nvu-page text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all dark:text-white resize-none"
                   />
                 </div>
                 
                 {editSequenceId && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-nvu-text-soft mb-2 mt-4">
                        Operações na pasta
                      </label>
                      {automatic?.settings?.queues.some(q=>q.folderId===editSequenceId&&q.state!=="archived")&&<p className="mb-2 text-xs text-gray-500 dark:text-nvu-muted">A sequência dos trabalhos é organizada em Filas operacionais. Novas operações entram ao final da fila.</p>}
                      <div className="flex flex-col gap-2 max-h-48 overflow-y-auto bg-gray-50 dark:bg-nvu-page p-3 rounded-xl border border-gray-100 dark:border-nvu-line">
                        {contracts.length === 0 ? (
                           <p className="text-xs text-gray-500">Nenhuma operação criada.</p>
                        ) : (
                          contracts.map(c => (
                            <label key={c.id} className="flex items-center gap-3 p-2 hover:bg-white dark:hover:bg-nvu-surface rounded-lg cursor-pointer transition-colors border border-transparent hover:border-gray-200 dark:hover:border-nvu-line">
                              <input 
                                type="checkbox" 
                                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500" 
                                checked={selectedContracts.includes(c.id)}
                                onChange={(e) => {
                                  if (e.target.checked) setSelectedContracts(prev => [...prev, c.id]);
                                  else setSelectedContracts(prev => prev.filter(id => id !== c.id));
                                }}
                              />
                              <div className="flex flex-col">
                                <span className="text-sm font-medium text-gray-900 dark:text-nvu-text">{c.name}</span>
                                <span className="text-[11px] text-gray-500">{c.simulator}</span>
                              </div>
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                 )}
               </div>
             </div>
             <div className="p-5 sm:p-6 border-t border-gray-100 dark:border-nvu-line bg-gray-50/50 dark:bg-nvu-surface flex justify-end gap-3 rounded-b-2xl">
               <Button
                 variant="outline"
                 onClick={closeSequenceModal}
                 className="px-5 text-sm"
               >
                 Cancelar
               </Button>
               <Button
                 onClick={handleCreateSequence}
                 disabled={!sequenceName.trim()}
                 className="px-6 bg-blue-600 hover:bg-blue-700 text-white text-sm"
               >
                 Salvar
               </Button>
             </div>
          </div>
         </div>
      )}
      
      {/* Move to sequence modal */}
      {moveContractId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-nvu-surface rounded-2xl shadow-xl w-full max-w-[340px] flex flex-col overflow-hidden">
             <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-nvu-line">
                <h3 className="text-[15px] font-bold text-gray-900 dark:text-nvu-text">
                  Mover para Pasta
                </h3>
                <button
                  onClick={() => setMoveContractId(null)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-nvu-text-soft rounded-full hover:bg-gray-100 dark:hover:bg-nvu-strip transition-colors"
                >
                  <X size={18} />
                </button>
             </div>
             <div className="p-2 max-h-60 overflow-y-auto">
               <div className="flex flex-col">
                 <button
                   onClick={async () => {
                     await updateContract(moveContractId, { sequenceId: null, sequenceOrder: null });
                     setMoveContractId(null);
                     setSuccessMsg("Operação removida da pasta.");
                     setTimeout(() => setSuccessMsg(""), 3000);
                   }}
                   className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 dark:text-nvu-text-soft hover:bg-gray-50 dark:hover:bg-nvu-strip rounded-lg transition-colors flex items-center gap-2"
                 >
                   <Folder size={16} className="text-gray-400" />
                   Sem pasta
                 </button>
                 {sequences.map(seq => (
                   <button
                     key={seq.id}
                     onClick={async () => {
                       await updateContract(moveContractId, { sequenceId: seq.id, sequenceOrder: 999 });
                       setMoveContractId(null);
                       setSuccessMsg("Operação movida com sucesso.");
                       setTimeout(() => setSuccessMsg(""), 3000);
                     }}
                     className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 dark:text-nvu-text-soft hover:bg-gray-50 dark:hover:bg-nvu-strip rounded-lg transition-colors flex items-center gap-2"
                   >
                     <FolderPlus size={16} className="text-blue-500" />
                     {seq.name}
                   </button>
                 ))}
               </div>
             </div>
          </div>
        </div>
      )}

      {/* Delete Sequence Modal */}
      {sequenceToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-nvu-surface rounded-2xl shadow-xl w-full max-w-[320px] p-6 flex flex-col items-center text-center">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-500/20 text-red-600 rounded-full flex items-center justify-center mb-4">
              <Trash2 size={24} />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-nvu-text mb-2">Excluir Pasta?</h3>
            <p className="text-[13px] text-gray-500 dark:text-nvu-muted mb-6">
              As operações dentro desta pasta <strong>NÃO</strong> serão excluídas, apenas voltarão para "Sem pasta".
            </p>
            <div className="flex items-center gap-3 w-full">
              <Button
                variant="outline"
                className="flex-1 h-10 border-gray-200 dark:border-nvu-line hover:bg-gray-50 dark:hover:bg-nvu-strip text-gray-700 dark:text-nvu-text-soft font-semibold text-[13px]"
                onClick={() => setSequenceToDelete(null)}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 h-10 bg-red-600 hover:bg-red-700 text-white font-semibold text-[13px]"
                onClick={async () => {
                  try {
                    await deleteSequence(sequenceToDelete);
                    setSequenceToDelete(null);
                    setSuccessMsg("Pasta excluída com sucesso.");
                    setTimeout(() => setSuccessMsg(""), 3000);
                  } catch {
                    // Context already reports the precise error.
                  }
                }}
              >
                Excluir
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Contract Modal */}
      {contractToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-nvu-surface rounded-2xl shadow-xl w-full max-w-[320px] p-6 flex flex-col items-center text-center">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-500/20 text-red-600 rounded-full flex items-center justify-center mb-4">
              <Trash2 size={24} />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-nvu-text mb-2">Excluir Operação?</h3>
            <p className="text-[13px] text-gray-500 dark:text-nvu-muted mb-6">
              Esta ação não pode ser desfeita e todas as informações vinculadas serão removidas.
            </p>
            <div className="flex items-center gap-3 w-full">
              <Button
                variant="outline"
                className="flex-1 h-10 border-gray-200 dark:border-nvu-line hover:bg-gray-50 dark:hover:bg-nvu-strip text-gray-700 dark:text-nvu-text-soft font-semibold text-[13px]"
                onClick={() => setContractToDelete(null)}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 h-10 bg-red-600 hover:bg-red-700 text-white font-semibold text-[13px]"
                onClick={async () => {
                  try {
                    await deleteContract(contractToDelete);
                    setContractToDelete(null);
                    setSuccessMsg("Operação excluída com sucesso.");
                    setTimeout(() => setSuccessMsg(""), 3000);
                  } catch {
                    // Context already reports the precise error.
                  }
                }}
              >
                Excluir
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(ContractsTab);
