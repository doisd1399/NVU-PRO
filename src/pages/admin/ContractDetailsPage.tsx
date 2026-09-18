import React, { useState } from "react";
import { useOperationalStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { Button } from "../../components/ui/Button";
import {
  X,
  MapPin,
  Truck,
  Calendar,
  Users,
  ListTodo,
  FileText,
  CheckCircle2,
  AlertTriangle,
  PlayCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  User,
  Rocket,
  Pencil,
  Trash2,
  MoreVertical,
  ArrowLeft,
} from "lucide-react";
import { differenceInDays, format } from "date-fns";
import { cn } from "../../lib/utils";
import { isTrailerlessSimulator } from "../../lib/resolveSimulator";

import { useNavigate, useParams, useLocation } from "react-router-dom";

export default function ContractDetailsPage() {
  const { id: contractId } = useParams<{ id: string }>();
  const { companies } = useCompanyStore();
  const {
    contracts,
    trailers,
    simulators,
    jobs,
    users,
    vehicles,
    deleteContract,
    cancelJob,
  } = useOperationalStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [jobToCancel, setJobToCancel] = useState<string | null>(null);

  const contract = contracts.find((c) => c.id === contractId);
  const companyProfile = companies.find((c) => c.id === contract?.companyId);
  
  if (!contractId || !contract) {
    return (
      <div className="p-6">
        <Button onClick={() => navigate("/admin/fleet", { state: { activeTab: "contracts" } })} variant="outline">Voltar</Button>
        <p className="mt-4 text-gray-500">Operação não encontrada.</p>
      </div>
    );
  }

  const trailerlessSimulator = isTrailerlessSimulator(
    contract,
    simulators as unknown[],
  );
  const trailer = !trailerlessSimulator && contract.trailerId
    ? trailers.find((t) => t.id === contract.trailerId)
    : null;
  const operatingStatuses = [
    "active",
    "assigned",
    "in_progress",
    "em_andamento",
    "em_operacao",
    "started",
  ];

  const motoristasEmOperacao = jobs
    .filter((trabalho) => {
      const trabalhoContratoId = trabalho.contractId || (trabalho as any).contratoId;

      const motoristaId =
        trabalho.driverId ||
        (trabalho as any).assignedDriverId ||
        (trabalho as any).motoristaId ||
        (trabalho as any).userId;

      return (
        trabalhoContratoId === contractId &&
        operatingStatuses.includes(trabalho.status) &&
        Boolean(motoristaId)
      );
    })
    .map((trabalho) => {
      const motoristaId =
        trabalho.driverId ||
        (trabalho as any).assignedDriverId ||
        (trabalho as any).motoristaId ||
        (trabalho as any).userId;

      const motorista = users.find((m) => m.id === motoristaId);

      if (!motorista) return null;

      return { motorista, trabalho };
    })
    .filter(Boolean) as { motorista: any; trabalho: any }[];

  const uniqueMotoristasEmOperacao = [];
  const seenDrivers = new Set();
  
  for (const item of motoristasEmOperacao) {
    if (!seenDrivers.has(item.motorista.id)) {
      seenDrivers.add(item.motorista.id);
      uniqueMotoristasEmOperacao.push(item);
    }
  }

  const handleAssign = () => {
    navigate("/admin/assign", {
      state: { preselectedContractId: contractId },
    });
  };

  const getJobStatusDetails = (job: any) => {
    if (job.status === "completed") {
      let isLegacyCompleted = false;
      let wasOnTime = false;

      if (job.completionStatus) {
        wasOnTime = job.completionStatus === "on_time";
      } else {
        const completedAt = job.completedAt ? new Date(job.completedAt) : null;
        if (completedAt && !isNaN(completedAt.getTime())) {
          const deadlineStr = job.dueAt || job.deadlineDate;
          const deadline = deadlineStr ? new Date(deadlineStr) : null;
          const isValidDeadline = deadline && !isNaN(deadline.getTime());
          wasOnTime = !isValidDeadline || (completedAt <= deadline);
        } else {
          isLegacyCompleted = true;
        }
      }
      
      if (isLegacyCompleted) {
        return {
          text: "Concluído",
          color: "bg-green-500",
          bg: "bg-green-100 dark:bg-green-500/20",
          icon: CheckCircle2,
        };
      }
      
      return {
        text: wasOnTime ? "Concluído no prazo" : "Concluído com atraso",
        color: wasOnTime ? "bg-green-500" : "bg-orange-500",
        bg: wasOnTime ? "bg-green-100 dark:bg-green-500/20" : "bg-orange-100 dark:bg-orange-500/20",
        icon: wasOnTime ? CheckCircle2 : AlertTriangle,
      };
    }
    if (job.status === "cancelled")
      return {
        text: "Cancelado",
        color: "bg-rose-500",
        bg: "bg-red-100 dark:bg-red-500/20",
        icon: X,
      };

    const targetDate = new Date(job.dueAt || job.deadlineDate);
    const now = new Date();
    // Replaces differenceInDays to check exact precise milliseconds if it is expired
    if (now > targetDate) {
      return {
        text: "Atrasado",
        color: "bg-rose-500",
        bg: "bg-red-100 dark:bg-red-500/20",
        icon: AlertTriangle,
      };
    }
    
    // Difference in days for warning
    const daysLeft = Math.ceil((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysLeft <= 2)
      return {
        text: "Atenção",
        color: "bg-amber-50 dark:bg-amber-500/100",
        bg: "bg-amber-100 dark:bg-amber-500/20",
        icon: AlertTriangle,
      };
    if (job.status === "active")
      return {
        text: "Em Andamento",
        color: "bg-blue-50 dark:bg-blue-500/100",
        bg: "bg-blue-100 dark:bg-blue-500/20",
        icon: PlayCircle,
      };

    return {
      text: "Não Iniciado",
      color: "bg-gray-400",
      bg: "bg-gray-100 dark:bg-[#18181b]",
      icon: Clock,
    };
  };

  const handleDelete = () => {
    setIsDeleting(true);
  };

  const usersMap = React.useMemo(() => new Map(users.map(u => [u.id, u])), [users]);
  const trailersMap = React.useMemo(() => new Map(trailers.map(t => [t.id, t])), [trailers]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#09090b] flex flex-col pb-20">
      {/* Top Header */}
      <div className="bg-white dark:bg-[#1A1F26] border-b border-gray-100 dark:border-[#2A2F3A] sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/admin/fleet", { state: { activeTab: "contracts" } })}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-[#2A2F3A] transition-colors"
            >
              <ArrowLeft size={20} className="text-gray-600 dark:text-[#d4d4d8]" />
            </button>
            <h1 className="text-xl font-bold text-gray-900 dark:text-[#fafafa]">Detalhes da Operação</h1>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              onClick={handleAssign}
              className="hidden sm:inline-flex bg-gray-900 hover:bg-gray-800 text-white h-9 px-4 text-[13px] font-semibold rounded-xl shadow-sm dark:shadow-none"
            >
              Designar Trabalho
            </Button>
            <Button
              onClick={handleAssign}
              className="sm:hidden bg-gray-900 hover:bg-gray-800 text-white h-9 px-4 text-[13px] font-semibold rounded-xl shadow-sm dark:shadow-none"
            >
              Designar
            </Button>

            <div className="relative">
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center justify-center w-9 h-9 text-gray-600 dark:text-[#d4d4d8] bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] hover:bg-gray-50 dark:hover:bg-[#3f3f46] rounded-xl shadow-sm dark:shadow-none transition-colors"
              >
                <MoreVertical size={16} />
              </button>

              {showDropdown && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowDropdown(false)}
                  ></div>
                  <div className="absolute right-0 top-11 w-48 bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] shadow-xl rounded-xl z-50 py-2 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                    <button
                      onClick={() => {
                        setShowDropdown(false);
                        navigate(`/admin/contract/${contractId}/edit`);
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-[13px] font-medium text-gray-700 dark:text-[#d4d4d8] hover:bg-gray-50 dark:hover:bg-[#3f3f46] transition-colors"
                    >
                      <Pencil size={14} className="text-gray-400" />
                      Editar Operação
                    </button>
                    <div className="h-px w-full bg-gray-100 dark:bg-[#18181b]"></div>
                    <button
                      onClick={() => {
                        setShowDropdown(false);
                        handleDelete();
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-[13px] font-medium text-red-600 hover:bg-red-50 dark:bg-red-500/10 transition-colors"
                    >
                      <Trash2 size={14} className="text-red-500" />
                      Excluir Operação
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto w-full px-4 py-6 flex-1 space-y-6">
        {/* Header Summary */}
        <div className="bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] rounded-2xl p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="px-2 py-0.5 bg-gray-100 dark:bg-[#18181b] text-gray-600 dark:text-[#d4d4d8] rounded text-[10px] uppercase font-bold tracking-wider shrink-0 flex items-center gap-1.5">
              <Rocket size={12} className="text-gray-400" />
              {contract.simulator}
            </span>
            {companyProfile && (
              <span className="px-2 py-0.5 bg-gray-100 dark:bg-[#18181b] text-gray-600 dark:text-[#d4d4d8] rounded text-[10px] uppercase font-bold tracking-wider shrink-0 flex items-center gap-1.5">
                <Truck size={12} className="text-gray-400" />
                Empresa: {companyProfile.companyName}
              </span>
            )}
          </div>

          <div className="flex flex-col mb-4">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-[#fafafa] leading-tight mb-1">
              {contract.name}
            </h2>
            {!trailerlessSimulator && (
              <span className="text-[13px] font-medium text-gray-500 dark:text-[#a1a1aa] flex items-center gap-1.5">
                <Truck size={14} className="text-gray-400" />
                {trailer ? trailer.name : "Qualquer Reboque"}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[13px] font-medium text-gray-600 dark:text-[#d4d4d8]">
            <div className="flex items-center gap-1.5 border border-gray-200 dark:border-[#2A2F3A] bg-gray-50 dark:bg-[#18181b] px-3 py-1.5 rounded-lg">
              <ListTodo size={14} className="text-gray-400" />
              <span>{contract.totalDeliveries} entregas</span>
            </div>
            <div className="flex items-center gap-1.5 border border-gray-200 dark:border-[#2A2F3A] bg-gray-50 dark:bg-[#18181b] px-3 py-1.5 rounded-lg">
              <Calendar size={14} className="text-gray-400" />
              <span>{contract.deadlineDays} dias</span>
            </div>
          </div>
        </div>

        {/* Rotas */}
        {contract.mode === "detailed" && contract.deliveries && contract.deliveries.length > 0 && (
          <section>
            <h3 className="text-[15px] font-bold text-gray-900 dark:text-[#fafafa] mb-3 ml-1">
              Rotas Planejadas
            </h3>
            <div className="bg-white dark:bg-[#1A1F26] rounded-2xl border border-gray-200 dark:border-[#2A2F3A] p-2 sm:p-3 space-y-2 shadow-sm">
              {contract.deliveries.map((del, i) => (
                <div
                  key={del.id}
                  className="bg-gray-50 dark:bg-[#18181b] border border-gray-100 dark:border-[#2A2F3A]/60 rounded-xl p-3 flex items-center gap-3 sm:gap-4 transition-shadow"
                >
                  <div className="w-7 h-7 rounded-full bg-white dark:bg-[#2A2F3A] shadow-sm text-gray-600 dark:text-[#a1a1aa] flex items-center justify-center font-bold text-[12px] shrink-0 border border-gray-200 dark:border-[#3f3f46]">
                    {i + 1}
                  </div>
                  <div className="flex-1 flex flex-col sm:flex-row sm:items-center text-[14px] gap-1 sm:gap-3">
                    <span className="font-semibold text-gray-900 dark:text-[#fafafa]">
                      {del.origin}
                    </span>
                    <span className="text-gray-400 hidden sm:inline">→</span>
                    <span className="font-semibold text-gray-900 dark:text-[#fafafa]">
                      {del.destination}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Motoristas em Operação */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <h3 className="text-[15px] font-bold text-gray-900 dark:text-[#fafafa] ml-1">
              Motoristas em Operação
            </h3>
            {uniqueMotoristasEmOperacao.length > 0 && (
              <span className="text-[11px] font-bold text-gray-500 dark:text-[#a1a1aa] bg-gray-200 dark:bg-[#2A2F3A] px-2 py-0.5 rounded-full">
                {uniqueMotoristasEmOperacao.length}
              </span>
            )}
          </div>

          {uniqueMotoristasEmOperacao.length === 0 ? (
            <div className="bg-white dark:bg-[#1A1F26] rounded-2xl border border-gray-200 dark:border-[#2A2F3A] p-6 text-center text-[14px] text-gray-500 dark:text-gray-400 shadow-sm">
              Nenhum motorista em operação nesta operação no momento.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {uniqueMotoristasEmOperacao.map(({ motorista: driver, trabalho: job }) => {
                const statusDetails = getJobStatusDetails(job);
                const progressPct = Math.round(
                  (job.progress / Math.max(1, contract.totalDeliveries)) * 100,
                );
                const deliveriesLeft = contract.totalDeliveries - job.progress;
                const effectiveTrailerId = trailerlessSimulator
                  ? ""
                  : job.trailerId || contract.trailerId;
                const currentTrailer = effectiveTrailerId
                  ? trailersMap.get(effectiveTrailerId)
                  : undefined;
                const isExpanded = expandedJobId === job.id;
                const isOverdue =
                  differenceInDays(new Date(job.deadlineDate), new Date()) < 0;

                return (
                  <div
                    key={job.id}
                    className={cn(
                      "relative flex flex-col border rounded-2xl transition-all overflow-hidden bg-white dark:bg-[#1A1F26]",
                      isExpanded
                        ? "border-blue-500 shadow-md dark:shadow-none ring-1 ring-blue-500/20"
                        : "border-gray-200 dark:border-[#2A2F3A] shadow-sm hover:border-gray-300",
                    )}
                  >
                    <button
                      onClick={() =>
                        setExpandedJobId(isExpanded ? null : job.id)
                      }
                      className="w-full text-left p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-6"
                    >
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 dark:text-[#fafafa] text-[17px] sm:text-[18px] truncate tracking-tight">
                          {driver?.name || "Desconhecido"}
                        </h3>
                        {!trailerlessSimulator && (
                          <div className="flex items-center gap-2 text-[13px] text-gray-500 dark:text-[#a1a1aa] whitespace-nowrap overflow-x-auto scrollbar-hide mt-1 sm:mb-0">
                            <span className="flex items-center gap-1.5">
                              <Truck size={14} className="shrink-0" />
                              {currentTrailer?.name || "S/ Reboque"}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="w-full sm:w-[280px] shrink-0 border border-gray-100 dark:border-[#2A2F3A] bg-gray-50 dark:bg-[#18181b] rounded-xl p-3 flex flex-col gap-2.5 mt-1 sm:mt-0">
                        <div className="flex justify-between items-start">
                          <div className="flex flex-col items-start leading-tight">
                            <span className="text-[14px] text-blue-600 dark:text-blue-400 font-bold tracking-tight">
                              {job.progress}/{contract.totalDeliveries}
                            </span>
                          </div>
                          <div className="flex flex-col items-end leading-tight">
                            <span className="text-[14px] text-blue-600 dark:text-blue-400 font-bold tracking-tight">
                              {deliveriesLeft} <span className="text-[11px] text-gray-500 uppercase font-medium">faltam</span>
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="flex-1 bg-gray-200 dark:bg-[#27272a] rounded-full h-1.5 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500 bg-[#00D1FF] shadow-[0_0_10px_rgba(0,209,255,0.4)]"
                              style={{ width: `${Math.max(3, progressPct)}%` }}
                            ></div>
                          </div>
                          <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 shrink-0 text-right">
                            {progressPct}%
                          </span>
                        </div>
                      </div>

                      <div className="shrink-0 text-gray-400 absolute sm:static right-4 top-5">
                        {isExpanded ? (
                          <ChevronUp size={20} strokeWidth={2} />
                        ) : (
                          <ChevronDown size={20} strokeWidth={2} />
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-gray-100 dark:border-[#2A2F3A] bg-gray-50/50 dark:bg-[#1A1F26] p-4 flex flex-col">
                        <div className="grid grid-cols-2 gap-3 text-[13px] mb-4">
                          <div className="min-w-0">
                            <span className="block text-[10px] font-bold text-gray-500 dark:text-[#a1a1aa] uppercase tracking-widest mb-1.5">
                              Prazo
                            </span>
                            <span
                              className={cn(
                                "font-medium flex items-center gap-1.5",
                                isOverdue && job.status === "active"
                                  ? "text-red-600 font-bold"
                                  : "text-gray-900 dark:text-[#fafafa]",
                              )}
                            >
                              <Clock
                                size={14}
                                className={cn(
                                  isOverdue && job.status === "active"
                                    ? "text-red-500"
                                    : "text-gray-400",
                                )}
                              />
                              {format(
                                new Date(job.deadlineDate),
                                "dd/MM/yyyy",
                              )}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <span className="block text-[10px] font-bold text-gray-500 dark:text-[#a1a1aa] uppercase tracking-widest mb-1.5">
                              Veículo
                            </span>
                            <span className="font-medium text-gray-900 dark:text-[#fafafa] truncate flex items-center gap-1.5">
                              <Truck size={14} className="text-gray-400" />
                              {vehicles.find((v) => v.id === job.vehicleId)
                                ?.name || "Nenhum"}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row items-center gap-2 pt-3 border-t border-gray-200 dark:border-[#2A2F3A]">
                          <Button
                            onClick={() => navigate(`/admin/driver/${job.driverId}`, { state: { returnUrl: location.pathname, companyId: job.companyId } })}
                            className="w-full sm:flex-1 h-9 text-[12px] font-semibold text-gray-700 dark:text-[#d4d4d8] bg-white dark:bg-[#1A1F26] hover:bg-gray-50 dark:hover:bg-[#3f3f46] border border-gray-200 dark:border-[#2A2F3A] shadow-sm"
                          >
                            <User size={14} className="mr-1.5" /> Perfil
                          </Button>

                          {job.status !== "completed" && job.status !== "cancelled" && (
                            <Button
                              className="w-full sm:flex-1 h-9 px-4 text-[12px] font-semibold text-red-600 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 border border-red-100 dark:border-red-500/20 shadow-sm"
                              onClick={() => setJobToCancel(job.id)}
                            >
                              Cancelar Trabalho
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {isDeleting && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#1A1F26] rounded-2xl shadow-xl w-full max-w-[320px] p-6 flex flex-col items-center text-center">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-500/20 text-red-600 rounded-full flex items-center justify-center mb-4">
              <Trash2 size={24} />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-[#fafafa] mb-2">Excluir Operação?</h3>
            <p className="text-[13px] text-gray-500 dark:text-[#a1a1aa] mb-6">
              Esta ação não pode ser desfeita e todas as informações vinculadas serão removidas.
            </p>
            <div className="flex items-center gap-3 w-full">
              <Button
                variant="outline"
                className="flex-1 h-10 border-gray-200 dark:border-[#2A2F3A] hover:bg-gray-50 dark:hover:bg-[#3f3f46] text-gray-700 dark:text-[#d4d4d8] font-semibold text-[13px]"
                onClick={() => setIsDeleting(false)}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 h-10 bg-red-600 hover:bg-red-700 text-white font-semibold text-[13px]"
                onClick={async () => {
                  try {
                    await deleteContract(contractId);
                    setIsDeleting(false);
                    navigate("/admin/fleet", { state: { activeTab: "contracts" } });
                  } catch {
                    // AppContext already reports the precise permission/network error.
                  }
                }}
              >
                Excluir
              </Button>
            </div>
          </div>
        </div>
      )}

      {jobToCancel && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#1A1F26] rounded-2xl shadow-xl w-full max-w-[320px] p-6 flex flex-col items-center text-center">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-500/20 text-red-600 rounded-full flex items-center justify-center mb-4">
              <AlertTriangle size={24} />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-[#fafafa] mb-2">Cancelar Operação?</h3>
            <p className="text-[13px] text-gray-500 dark:text-[#a1a1aa] mb-6">
              Esta operação será cancelado e o motorista perderá o acesso de sua finalização.
            </p>
            <div className="flex items-center gap-3 w-full">
              <Button
                variant="outline"
                className="flex-1 h-10 border-gray-200 dark:border-[#2A2F3A] inline-flex items-center justify-center hover:bg-gray-50 dark:hover:bg-[#3f3f46] text-gray-700 dark:text-[#d4d4d8] font-semibold text-[13px]"
                onClick={() => setJobToCancel(null)}
              >
                Voltar
              </Button>
              <Button
                className="flex-1 h-10 bg-red-600 hover:bg-red-700 text-white font-semibold text-[13px]"
                onClick={() => {
                  cancelJob(jobToCancel);
                  setExpandedJobId(null);
                  setJobToCancel(null);
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
