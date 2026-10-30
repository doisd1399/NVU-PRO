import { companyTeamRoles } from "../../../lib/companyTeam";
import { DriverOptionsSheet, type DriverOption } from "../../../components/admin/management/DriverOptionsSheet";
import { useManagedDriverContacts } from "../../../hooks/useManagedDriverContacts";
import { ModalPortal } from "../../../components/ui/ModalPortal";
import { resolveDriverPhoto } from '../../../lib/resolveDriverPhoto';
import React, { useState } from "react";
import { prepareFleetMembership } from "../../../services/fleetMembershipService";
import { useNavigate } from "react-router-dom";
import { useOperationalStore, useSessionStore } from "../../../context/AppContext";
import { useCompanyStore } from "../../../context/CompanyContext";
import { Card, CardContent } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import {
  CheckCircle,
  ShieldAlert,
  Star,
  UserCircle,
  Users,
  Eye,
  Trash2,
  Crown,
  Loader2,
  MoreVertical,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import { toast } from "sonner";
import { StableImage } from "../../../components/common/StableImage";

import { UserPlus, X, Image as ImageIcon, Truck, Clock, Check, User, Briefcase } from "lucide-react";
import { convertFileToBase64, compressImage, getNomeContratoHistorico } from "../../../lib/utils";
import { getDriverLevelData } from "../../../lib/levelUtils";
import { useTripHistory } from "../../../hooks/useTripHistory";

function DriversTab() {
  const navigate = useNavigate();
  const { currentUser } = useSessionStore();
  const {
    activeCompanyId,
    approveDriver,
    rejectDriver,
    promoteDriverToAdmin,
    demoteAdminToDriver,
    removeDriverFromFleet,
    allCompanyMembers,
    allCompanyMembersReady,
    allCompanyMembersError,
    companies,
    driverRequests,
  } = useCompanyStore();
  const { users: displayUsers, jobs, contracts, createManualDriver } = useOperationalStore();
  const contactIds = [...allCompanyMembers.filter(row => row.companyId === activeCompanyId && row.status === "active").map(row => row.userId), ...driverRequests.filter(row => row.empresaId === activeCompanyId && row.status === "pending").map(row => row.motoristaId)];
  const contacts = useManagedDriverContacts(currentUser?.id || "", activeCompanyId || "", contactIds);
  const users = React.useMemo(() => {
    const rows = displayUsers.map(user => {
      const contact = contacts.find(row => row.id === user.id);
      return { ...user, ...(contact ? { email: contact.email, whatsapp: contact.whatsapp } : {}) };
    });
    for (const profile of contacts) if (!rows.some(row => row.id === profile.id) && driverRequests.some(request => request.empresaId === activeCompanyId && request.status === "pending" && request.motoristaId === profile.id)) rows.push(profile as any);
    return rows;
  }, [displayUsers, contacts, driverRequests, activeCompanyId]);
  const { historicoTrips = [] } = useTripHistory(activeCompanyId, {
    userId: currentUser?.id,
  });
  React.useEffect(() => {
    if (currentUser?.id && activeCompanyId) void prepareFleetMembership(activeCompanyId, "fleet-ready");
  }, [currentUser?.id, activeCompanyId]);
  const hasSeniorRole = Boolean((currentUser as any)?.role === "senior" || (Array.isArray((currentUser as any)?.roles) && (currentUser as any).roles.includes("senior")));
  const [driverToRemove, setDriverToRemove] = useState<string | null>(null);

  const [processingRoleChangeId, setProcessingRoleChangeId] = useState<
    string | null
  >(null);

  const [optionsDriverId, setOptionsDriverId] = useState<string | null>(null);

  const activeCompany = companies?.find(company => company.id === activeCompanyId);
  const getDriverRoles = React.useCallback((driver: any) =>
    companyTeamRoles(driver.id, activeCompanyId || "", allCompanyMembers, activeCompany),
    [activeCompanyId, allCompanyMembers, activeCompany]);

  const allEmployees = React.useMemo(
    () =>
      users.filter(
        (u) =>
          getDriverRoles(u).length > 0,
      ),
    [currentUser?.id, currentUser?.role, getDriverRoles, users],
  );
  const pendingRequests = React.useMemo(
    () =>
      driverRequests.filter(
        (r) => r.empresaId === activeCompanyId && r.status === "pending",
      ),
    [activeCompanyId, driverRequests],
  );
  const activeEmployees = React.useMemo(
    () =>
      allEmployees.filter((u) =>
        getDriverRoles(u).some((r: string) => r === "driver" || r === "admin"),
      ),
    [allEmployees, getDriverRoles],
  );

  const [filterAvailability, setFilterAvailability] = useState<
    "all" | "available"
  >("all");

  const filteredEmployees = React.useMemo(
    () =>
      activeEmployees.filter((u) => {
        if (filterAvailability === "available") return u.isOnline;
        return true;
      }),
    [activeEmployees, filterAvailability],
  );

  const sortedEmployees = React.useMemo(
    () =>
      [...filteredEmployees]
        .map((driver) => {
          const {
            allCompletedJobs,
            activeJob,
            totalDeliveries,
            displayLevel,
            xpProgress,
          } = getDriverLevelData(driver.id, jobs, contracts, historicoTrips);
          return {
            ...driver,
            totalDeliveries,
            allDriverJobs: allCompletedJobs,
            activeJob,
            displayLevel,
            xpProgress,
          };
        })
        .sort((a, b) => b.totalDeliveries - a.totalDeliveries),
    [contracts, filteredEmployees, historicoTrips, jobs],
  );

  const unresolvedProfiles = allCompanyMembers.some(member => member.companyId === activeCompanyId && member.status === "active" && !users.some(user => user.id === member.userId));
  const teamPending = allCompanyMembersReady === false;
  if (!currentUser) return null;

  const handleAssignJob = (driverId: string) => {
    navigate("/admin/assign", {
      state: { preselectedDriverId: driverId },
    });
  };

  const handleViewJob = (jobId: string) => {
    navigate("/admin/fleet", { state: { preselectedJobId: jobId } });
  };

  return (
    <div className="space-y-8">
      {filteredEmployees.length > 0 && Boolean(allCompanyMembersError || unresolvedProfiles) && <p role="status" className="text-xs text-amber-600">{allCompanyMembersError ? "Equipe salva · não foi possível confirmar a atualização dos vínculos." : "Alguns perfis vinculados ainda não estão disponíveis."}</p>}
      {/* Pendências Section */}
      {pendingRequests.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-gray-500 dark:text-nvu-muted uppercase tracking-widest mb-4">
            Aprovações Pendentes
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {pendingRequests.map((req) => {
              const driver = users.find((u) => u.id === req.motoristaId);
              if (!driver) return null;
              return (
                <Card
                  key={req.id}
                  className="rounded-2xl border border-yellow-200 shadow-sm dark:shadow-none relative overflow-hidden bg-yellow-50 dark:bg-amber-500/10 dark:border-amber-500/20/10"
                >
                  <CardContent className="p-0">
                    <div className="flex flex-col sm:flex-row">
                      <div className="p-6 flex-1 flex items-start gap-4">
                        {resolveDriverPhoto(driver) ? (
                          <StableImage
                            src={resolveDriverPhoto(driver)}
                            alt={driver?.name}
                            loading="lazy"
                            decoding="async"
                            wrapperClassName="w-14 h-14 rounded-full border-2 border-white shadow-sm dark:shadow-none bg-gray-50 dark:bg-nvu-surface"
                            className="object-cover"
                            referrerPolicy="no-referrer"
                            fallback={
                              <span className="h-full w-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-lg">
                                {driver?.name?.substring(0, 2).toUpperCase() || "M"}
                              </span>
                            }
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-full border-2 border-white shadow-sm dark:shadow-none bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-lg">
                            {driver?.name?.substring(0, 2).toUpperCase() || "M"}
                          </div>
                        )}
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-nvu-text flex items-center gap-2">
                            {driver?.name || "Motorista"}
                            <ShieldAlert
                              size={16}
                              className="text-yellow-500"
                            />
                          </h3>
                          <p className="text-sm text-gray-500 dark:text-nvu-muted flex flex-wrap gap-x-3 gap-y-1">
                            <span>{driver?.email || ""}</span>
                            {driver?.whatsapp && (
                              <span className="flex items-center gap-1">
                                <span className="w-1 h-1 bg-gray-300 dark:bg-nvu-line rounded-full"></span>
                                {driver.whatsapp}
                              </span>
                            )}
                          </p>

                          <div className="mt-2 inline-block bg-yellow-100 dark:bg-yellow-500/20 text-yellow-800 dark:text-yellow-400 text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wide">
                            Aguardando
                          </div>
                        </div>
                      </div>

                      <div className="bg-white dark:bg-nvu-surface p-6 flex flex-col justify-center sm:border-l border-yellow-100 dark:border-yellow-500/20 sm:w-40 shrink-0 border-t sm:border-t-0 gap-3">
                        <Button
                          disabled={Boolean(processingRoleChangeId)}
                          onClick={async () => {
                            if (processingRoleChangeId) return;
                            setProcessingRoleChangeId(req.id);
                            try {
                              await approveDriver(req.id);
                            } catch {
                              // Context already reports the precise permission/network error.
                            } finally {
                              setProcessingRoleChangeId(null);
                            }
                          }}
                          className="w-full bg-green-500 hover:bg-green-600 text-white shadow-sm dark:shadow-none"
                        >
                          {processingRoleChangeId === req.id ? "Aprovando..." : "Aprovar"}
                        </Button>
                        <Button
                          disabled={Boolean(processingRoleChangeId)}
                          onClick={async () => {
                            if (processingRoleChangeId) return;
                            setProcessingRoleChangeId(req.id);
                            try {
                              await rejectDriver(req.id);
                            } catch {
                              // Context already reports the precise permission/network error.
                            } finally {
                              setProcessingRoleChangeId(null);
                            }
                          }}
                          variant="outline"
                          className="w-full text-red-600 bg-white dark:bg-nvu-surface hover:bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 border-gray-200 dark:border-nvu-line"
                        >
                          {processingRoleChangeId === req.id ? "Processando..." : "Recusar"}
                        </Button>
                        <Button
                          onClick={() => navigate(`/admin/driver/${driver.id}/perfil`, { state: { returnUrl: "/admin/fleet", returnState: { activeTab: "drivers" }, companyId: activeCompanyId } })}
                          variant="ghost"
                          className="w-full text-gray-700 dark:text-nvu-text-soft bg-white dark:bg-nvu-surface hover:bg-gray-50 dark:hover:bg-nvu-strip border-gray-200 dark:border-nvu-line text-sm h-8"
                        >
                          Ver Perfil
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* Lista de Motoristas Ativos */}
      <section>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <h2 className="text-sm font-bold text-gray-500 dark:text-nvu-muted uppercase tracking-widest leading-none mt-1">
              Motoristas Ativos
            </h2>
            <div className="flex bg-gray-100 dark:bg-nvu-surface p-1 rounded-lg items-center">
              <button
                onClick={() => setFilterAvailability("all")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${filterAvailability === "all" ? "bg-white dark:bg-nvu-surface text-gray-900 dark:text-nvu-text shadow-sm dark:shadow-none" : "text-gray-500 dark:text-nvu-muted hover:text-gray-700 dark:hover:text-nvu-text-soft"}`}
              >
                Todos
              </button>
              <button
                onClick={() => setFilterAvailability("available")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${filterAvailability === "available" ? "bg-white dark:bg-nvu-surface text-green-700 shadow-sm dark:shadow-none" : "text-gray-500 dark:text-nvu-muted hover:text-gray-700 dark:hover:text-nvu-text-soft"}`}
              >
                Disponíveis
              </button>
              <div className="w-[1px] h-4 bg-gray-300 dark:bg-nvu-strip mx-1 my-auto"></div>
              <button
                onClick={() => navigate('/admin/add-driver')}
                className="px-3 py-1.5 text-xs font-semibold rounded-md transition-colors text-white bg-gray-900 dark:bg-white dark:text-gray-900 hover:bg-black dark:hover:bg-gray-100 flex items-center gap-1.5 shadow-sm"
              >
                <UserPlus size={14} strokeWidth={2.5} />
                Novo
              </button>
            </div>
          </div>
        </div>

        {filteredEmployees.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-nvu-surface rounded-2xl border border-gray-200 dark:border-nvu-line border-dashed">
            <div className="mx-auto w-16 h-16 bg-gray-50 dark:bg-nvu-surface rounded-full flex items-center justify-center text-gray-400 mb-4">
              <Users size={24} />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-nvu-text">
              {allCompanyMembersError ? "Falha ao carregar equipe" : teamPending ? "Confirmando equipe…" : unresolvedProfiles ? "Perfis da equipe não disponíveis" : `Nenhum motorista ${filterAvailability === "available" ? "disponível" : "ativo"}`}
            </h3>
            <p className="text-gray-500 dark:text-nvu-muted mt-1 max-w-sm mx-auto">
              {allCompanyMembersError ? "Não foi possível confirmar os vínculos. Tente novamente ao restabelecer a conexão." : teamPending ? "Aguardando confirmação dos vínculos da empresa." : unresolvedProfiles ? "Há vínculos ativos, mas seus perfis ainda não foram encontrados. Nenhum vínculo foi removido." : "Motoristas aprovados aparecerão nesta lista."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4 w-full relative">
            {sortedEmployees.map((driver) => {
              const { allDriverJobs, activeJob, totalDeliveries, displayLevel, xpProgress } = driver as any;

              const [firstName, secondName] = driver.name.trim().split(/\s+/);
              const displayName = secondName ? `${firstName} ${secondName}` : firstName;

              return (
                <Card
                  key={driver.id}
                  className="rounded-[20px] border border-gray-200/60 dark:border-nvu-line shadow-sm hover:shadow-md dark:shadow-none relative bg-white dark:bg-nvu-surface group transition-all duration-200 w-full overflow-visible"
                >
                  <CardContent className="p-3 md:p-4 flex flex-col w-full gap-2.5 md:gap-3">
                    {/* 1. Cabeçalho */}
                    <div className="flex items-start w-full gap-2.5 md:gap-3">
                      {resolveDriverPhoto(driver) ? (
                        <StableImage
                          src={resolveDriverPhoto(driver)}
                          alt={driver.name}
                          loading="lazy"
                          decoding="async"
                          wrapperClassName="w-[60px] h-[60px] md:w-[72px] md:h-[72px] rounded-[16px] border border-gray-200 dark:border-nvu-line bg-gray-50 dark:bg-nvu-surface shrink-0"
                          className="object-cover"
                          referrerPolicy="no-referrer"
                          fallback={
                            <span className="h-full w-full text-gray-500 dark:text-nvu-muted flex items-center justify-center font-bold text-xl">
                              {driver.name.substring(0, 2).toUpperCase()}
                            </span>
                          }
                        />
                      ) : (
                        <div className="w-[60px] h-[60px] md:w-[72px] md:h-[72px] rounded-[16px] border border-gray-200 dark:border-nvu-line bg-gray-50 dark:bg-nvu-surface text-gray-500 dark:text-nvu-muted flex items-center justify-center font-bold text-xl shrink-0">
                          {driver.name.substring(0, 2).toUpperCase()}
                        </div>
                      )}
                      
                      <div className="flex-1 min-w-0 flex flex-col pt-0.5">
                        <div className="flex items-start justify-between">
                          <h3 className="font-bold text-[15px] md:text-[16px] text-gray-900 dark:text-nvu-text leading-[1.25] flex items-center flex-wrap gap-1.5 line-clamp-2 pr-2">
                            <span>{displayName}</span>
                            {processingRoleChangeId === driver.id && <span role="status" className="text-xs text-amber-600">Atualizando vínculo…</span>}
                            <CheckCircle
                              size={14}
                              className="text-blue-500 shrink-0 select-none inline-block align-middle"
                              strokeWidth={2.5}
                            />
                          </h3>
                          
                            {/* Menu de opções */}
                          <div className="shrink-0">
                            <button 
                              onClick={() => setOptionsDriverId(driver.id)}
                              aria-label={`Ações de ${driver.name}`}
                              aria-haspopup="dialog"
                              aria-expanded={optionsDriverId === driver.id}
                              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-nvu-strip text-gray-400 hover:text-gray-600 dark:text-nvu-muted dark:hover:text-nvu-text-soft transition-colors -mt-1 -mr-1"
                            >
                              <MoreVertical size={18} />
                            </button>
                          </div>
                        </div>

                        {/* 2. Card unificado Cargo + Status */}
                        <div className="flex items-center w-fit border border-gray-100 dark:border-nvu-line rounded-full px-2 py-[3px] bg-gray-50 dark:bg-nvu-surface divide-x divide-gray-200 dark:divide-nvu-line mt-1 md:mt-1.5">
                          <div className="flex items-center gap-1.5 pr-2.5 text-gray-600 dark:text-nvu-muted">
                            <User size={10} strokeWidth={2.5} />
                            <span className="text-[11px] font-semibold">{getDriverRoles(driver).includes("admin") ? "Admin" : "Motorista"}</span>
                          </div>
                          <div className="flex items-center gap-1.5 pl-2.5">
                            <span className={cn(
                              "w-1.5 h-1.5 md:w-2 md:h-2 rounded-full",
                              activeJob ? "bg-amber-400" : (driver.isOnline ? "bg-emerald-500" : "bg-slate-500")
                            )}></span>
                            <span className={cn(
                              "text-[11px] font-bold",
                              activeJob ? "text-amber-600 dark:text-amber-500" : (driver.isOnline ? "text-emerald-600 dark:text-emerald-500" : "text-slate-500 dark:text-nvu-muted")
                            )}>
                              {activeJob ? "Em operação" : (driver.isOnline ? "Livre" : "Indisponível")}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Cards Internos (Stack Vertical, 12px gap) */}
                    <div className="flex flex-col gap-2 md:gap-3 mt-1 text-sm md:text-base">
                      {activeJob && contracts ? (() => {
                        const contract = contracts.find(c => c.id === activeJob.contractId);
                        const contractTitle = contract?.name || 'Em andamento';
                        const progress = contract?.totalDeliveries > 0 
                          ? Math.round((activeJob.progress / contract.totalDeliveries) * 100) 
                          : 0;
                        
                        let timeRemainingStr = "";
                        const targetDateStr = activeJob.dueAt || activeJob.deadlineDate;
                        if (targetDateStr) {
                          const target = new Date(targetDateStr);
                          const diffMs = target.getTime() - new Date().getTime();
                          if (diffMs > 0) {
                            const d = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                            const h = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
                            const m = Math.floor((diffMs / 1000 / 60) % 60);
                            timeRemainingStr = `${d} dias • ${h}h • ${m}min`;
                          } else {
                            timeRemainingStr = "Prazo esgotado";
                          }
                        }

                        return (
                          <>
                            {/* Card Operação */}
                            <div className="w-full bg-slate-50 dark:bg-nvu-surface border border-slate-100 dark:border-nvu-line rounded-xl p-2 px-3 md:p-3 md:px-4 flex flex-col gap-1.5 md:gap-2 relative overflow-hidden">
                               <div className="flex items-center gap-2.5 w-full">
                                  <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-slate-200/50 dark:bg-nvu-surface flex items-center justify-center shrink-0">
                                      <Truck size={16} className="text-slate-600 dark:text-nvu-muted" />
                                  </div>
                                  <div className="flex flex-col flex-1 min-w-0 justify-center">
                                      <span className="text-[9px] md:text-[10px] font-bold text-slate-500 dark:text-nvu-muted uppercase tracking-wider mb-[1px] md:mb-0.5">Operação</span>
                                      <div className="flex justify-between items-center w-full">
                                        <span className="text-[13px] md:text-[14px] font-bold text-slate-900 dark:text-nvu-text truncate pr-2">{contractTitle}</span>
                                        <span className="text-[12px] md:text-[13px] font-bold text-slate-900 dark:text-nvu-text">{progress}%</span>
                                      </div>
                                  </div>
                               </div>
                               <div className="h-1.5 md:h-2 w-full bg-slate-200 dark:bg-nvu-surface rounded-full overflow-hidden mt-0.5 md:mt-1">
                                  <div className="h-full bg-slate-900 dark:bg-nvu-accent rounded-full transition-all duration-300" style={{width: `${progress}%`}}></div>
                               </div>
                            </div>
                            
                            {/* Card Tempo Restante */}
                            {timeRemainingStr && (
                              <div className="w-full bg-[#FFF7ED] dark:bg-orange-500/10 border border-[#FFEDD5] dark:border-orange-500/20 rounded-xl p-2 px-3 md:p-3 md:px-4 flex items-center gap-2.5">
                                  <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-[#FFEDD5] dark:bg-orange-500/20 flex items-center justify-center shrink-0">
                                      <Clock size={16} className="text-orange-500" strokeWidth={2.5} />
                                  </div>
                                  <div className="flex flex-col justify-center">
                                      <span className="text-[9px] md:text-[10px] font-bold text-slate-500 dark:text-nvu-muted uppercase tracking-wider mb-[1px] md:mb-0.5">Tempo Restante</span>
                                      <span className={cn("text-[13px] md:text-[14px] font-bold leading-none mt-0.5", timeRemainingStr === "Prazo esgotado" ? "text-red-600 dark:text-red-400" : "text-orange-600 dark:text-orange-500")}>
                                        {timeRemainingStr}
                                      </span>
                                  </div>
                              </div>
                            )}
                          </>
                        )
                      })() : driver.isOnline ? (
                        <>
                            {/* Card Disponibilidade */}
                            <div className="w-full bg-[#ECFDF5] dark:bg-emerald-500/10 border border-[#D1FAE5] dark:border-emerald-500/20 rounded-xl p-2 px-3 md:p-3 md:px-4 flex items-center gap-2.5 md:gap-3">
                              <div className="w-8 h-8 md:w-10 md:h-10 rounded-full border-[2px] border-emerald-500 flex items-center justify-center shrink-0">
                                  <Check size={16} className="text-emerald-500" strokeWidth={3.5} />
                              </div>
                              <div className="flex flex-col justify-center pt-0.5">
                                  <span className="text-[10px] md:text-[11px] font-bold text-slate-900 dark:text-nvu-text uppercase tracking-wider mb-[3px]">Disponível para trabalho</span>
                                  <span className="text-[11px] md:text-[12px] font-medium text-slate-500 dark:text-nvu-muted leading-none">Pronto para novas operações</span>
                              </div>
                            </div>
                            
                            {/* Card Última Operação */}
                            <div className="w-full bg-slate-50 dark:bg-nvu-surface border border-slate-100 dark:border-nvu-line rounded-xl p-2 px-3 md:p-3 md:px-4 flex items-center justify-between gap-2.5 md:gap-3">
                              <div className="flex items-center gap-2.5 md:gap-3 min-w-0">
                                <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-slate-200/50 dark:bg-nvu-surface flex items-center justify-center shrink-0">
                                    <Clock size={16} className="text-slate-600 dark:text-nvu-muted" />
                                </div>
                                <div className="flex flex-col justify-center min-w-0 pr-2">
                                    <span className="text-[9px] md:text-[10px] font-bold text-slate-500 dark:text-nvu-muted uppercase tracking-wider mb-[1px] md:mb-0.5">Última Operação</span>
                                    <span className="text-[13px] md:text-[14px] font-bold text-slate-900 dark:text-nvu-text truncate">
                                      {allDriverJobs?.[0] ? getNomeContratoHistorico(allDriverJobs[0], contracts.find(c => c.id === allDriverJobs[0].contractId)) : 'Nenhuma'}
                                    </span>
                                </div>
                              </div>
                              {allDriverJobs?.[0] && (
                                <div className="flex flex-col items-end shrink-0 justify-center">
                                    <span className="text-[10px] md:text-[11px] font-medium text-slate-500 dark:text-nvu-muted mb-0.5">Realizada em</span>
                                    <span className="text-[10px] md:text-[11px] font-medium text-slate-500 dark:text-nvu-muted">
                                      {(allDriverJobs?.[0]?.completedAt || allDriverJobs?.[0]?.createdAt) ? new Date(allDriverJobs[0].completedAt || allDriverJobs[0].createdAt).toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'}) : '--/--'} às {(allDriverJobs?.[0]?.completedAt || allDriverJobs?.[0]?.createdAt) ? new Date(allDriverJobs[0].completedAt || allDriverJobs[0].createdAt).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}) : '--:--'}
                                    </span>
                                </div>
                              )}
                            </div>
                        </>
                      ) : (
                        <>
                            {/* Card Última Operação for paused/offline */}
                            <div className="w-full bg-slate-50 dark:bg-nvu-surface border border-slate-100 dark:border-nvu-line rounded-xl p-2 px-3 md:p-3 md:px-4 flex items-center justify-between gap-2.5 md:gap-3">
                              <div className="flex items-center gap-2.5 md:gap-3 min-w-0">
                                <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-slate-200/50 dark:bg-nvu-surface flex items-center justify-center shrink-0">
                                    <Clock size={16} className="text-slate-600 dark:text-nvu-muted" />
                                </div>
                                <div className="flex flex-col justify-center min-w-0 pr-2">
                                    <span className="text-[9px] md:text-[10px] font-bold text-slate-500 dark:text-nvu-muted uppercase tracking-wider mb-[1px] md:mb-0.5">Última Operação</span>
                                    <span className="text-[13px] md:text-[14px] font-bold text-slate-900 dark:text-nvu-text truncate">
                                      {allDriverJobs?.[0] ? getNomeContratoHistorico(allDriverJobs[0], contracts.find(c => c.id === allDriverJobs[0].contractId)) : 'Nenhuma'}
                                    </span>
                                </div>
                              </div>
                              {allDriverJobs?.[0] && (
                                <div className="flex flex-col items-end shrink-0 justify-center">
                                    <span className="text-[10px] md:text-[11px] font-medium text-slate-500 dark:text-nvu-muted mb-[1px] md:mb-0.5">Realizada em</span>
                                    <span className="text-[10px] md:text-[11px] font-medium text-slate-500 dark:text-nvu-muted">
                                      {(allDriverJobs?.[0]?.completedAt || allDriverJobs?.[0]?.createdAt) ? new Date(allDriverJobs[0].completedAt || allDriverJobs[0].createdAt).toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'}) : '--/--'} às {(allDriverJobs?.[0]?.completedAt || allDriverJobs?.[0]?.createdAt) ? new Date(allDriverJobs[0].completedAt || allDriverJobs[0].createdAt).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}) : '--:--'}
                                    </span>
                                </div>
                              )}
                            </div>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {optionsDriverId && (() => {
        const driver = sortedEmployees.find(item => item.id === optionsDriverId) as any;
        if (!driver) return null;
        const isAdmin = getDriverRoles(driver).includes("admin");
        const canManageRoles = getDriverRoles(currentUser).includes("admin") || hasSeniorRole;
        const options: DriverOption[] = [
          { id: "profile", label: "Ver Perfil", icon: Eye, onSelect: () => navigate(`/admin/driver/${driver.id}/perfil`, { state: { returnUrl: "/admin/fleet", returnState: { activeTab: "drivers" }, companyId: activeCompanyId } }) },
          { id: "assign", label: "Designar Trabalho", icon: Briefcase, onSelect: () => navigate("/admin/assign", { state: { preselectedDriverId: driver.id } }) },
        ];
        if (canManageRoles) {
          options.push({
            id: "role", label: isAdmin ? "Remover de Admin" : "Promover a Admin", icon: Crown, disabled: Boolean(processingRoleChangeId),
            onSelect: async () => {
              if (processingRoleChangeId) return;
              if (isAdmin) {
                if (driver.id === currentUser?.id) { toast.error("Você não pode remover seus próprios privilégios."); return; }
                setProcessingRoleChangeId(driver.id);
                try { await demoteAdminToDriver(driver.id); toast.success("Privilégios de administrador removidos."); }
                catch (e: any) { toast.error("Erro: " + e.message); }
                finally { setProcessingRoleChangeId(null); }
              } else {
                setProcessingRoleChangeId(driver.id);
                try { await promoteDriverToAdmin(driver.id); toast.success("Promovido a administrador."); }
                catch (e: any) { toast.error("Erro ao promover: " + e.message); }
                finally { setProcessingRoleChangeId(null); }
              }
            },
          });
          if (driver.id !== currentUser?.id || hasSeniorRole) {
            options.push({ id: "remove", label: "Remover da Frota", icon: Trash2, danger: true, disabled: Boolean(processingRoleChangeId), onSelect: () => setDriverToRemove(driver.id) });
          }
        }
        const status = driver.activeJob ? "Em operação" : (driver.isOnline ? "Livre" : "Indisponível");
        return <DriverOptionsSheet driverId={driver.id} companyId={activeCompanyId || ""} name={driver.name} photo={resolveDriverPhoto(driver)}
          subtitle={`${isAdmin ? "Admin" : "Motorista"} · ${status}`} options={options} onClose={() => setOptionsDriverId(null)} />;
      })()}

      {driverToRemove && (
        <ModalPortal label="Remover da frota" onClose={() => setDriverToRemove(null)} busy={Boolean(processingRoleChangeId)}><div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 min-h-[100dvh]">
          <div className="nvu-viewport-modal-card flex flex-col bg-white dark:bg-nvu-surface rounded-2xl w-full max-w-sm shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="nvu-modal-body p-6">
              <div className="w-12 h-12 bg-red-100 dark:bg-red-500/20 rounded-full flex items-center justify-center mb-4 text-red-600 dark:text-red-400">
                <Trash2 size={24} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-nvu-text mb-2">
                Remover da frota
              </h3>
              <p className="text-gray-600 dark:text-nvu-text-soft text-sm">
                Tem certeza que deseja remover este motorista da frota? Esta
                ação não pode ser desfeita e ele não terá mais acesso aos
                trabalhos.
              </p>
            </div>
            <div className="bg-gray-50 dark:bg-nvu-surface px-6 py-4 flex gap-3 justify-end items-center border-t border-gray-100 dark:border-nvu-line">
              <Button variant="outline" disabled={Boolean(processingRoleChangeId)} onClick={() => setDriverToRemove(null)}>
                Cancelar
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                disabled={processingRoleChangeId === driverToRemove}
                onClick={async () => {
                  if (!driverToRemove || processingRoleChangeId) return;
                  const targetId = driverToRemove;
                  setProcessingRoleChangeId(targetId);
                  setDriverToRemove(null);
                  const notice = toast.loading("Removendo motorista da frota…");
                  try {
                    await removeDriverFromFleet(targetId);
                  } catch {
                    // AppContext already shows the precise permission/network error.
                  } finally {
                    toast.dismiss(notice);
                    setProcessingRoleChangeId(null);
                  }
                }}
              >
                {processingRoleChangeId === driverToRemove ? "Removendo..." : "Remover"}
              </Button>
            </div>
          </div>
        </div></ModalPortal>
      )}

    </div>
  );
}

export default React.memo(DriversTab);
