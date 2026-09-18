import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Calendar, 
  Building2, 
  Users, 
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  ArrowLeft,
  Info 
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useOperationalStore, useSessionStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import {
  getFilteredTrips,
  getMonthlyRange,
  getWeeklyRange,
  normalizeTrip,
} from "../../lib/metricsEngine";
import {
  getCanonicalTripDriverId,
  getCanonicalTripDriverName,
} from "../../lib/tripIdentity";
import { useTripHistory } from "../../hooks/useTripHistory";

type ReportPeriod = "semanal" | "mensal";

type ReportTrip = ReturnType<typeof normalizeTrip> & {
  parsedDate: Date;
  val: number;
};

type ReportHistoryItem = {
  id: string;
  title: string;
  subTitle: string;
  totalValue: number;
  tripCount: number;
  sortDate: Date;
  avgTicket: number;
  variation: number;
  hasPrevious: boolean;
};

const formatUtcDate = (date: Date) =>
  date.toLocaleDateString("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const formatUtcMonth = (date: Date) => {
  const value = date.toLocaleDateString("pt-BR", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const utcDateKey = (date: Date) => date.toISOString().slice(0, 10);
const utcMonthKey = (date: Date) => date.toISOString().slice(0, 7);

export default function Reports({
  defaultDriverId,
  hideHeader = false,
  isInsideAdminTab = false,
}: {
  defaultDriverId?: string;
  hideHeader?: boolean;
  isInsideAdminTab?: boolean;
} = {}) {
  const navigate = useNavigate();
  const { activeRole, currentUser } = useSessionStore();
  const { activeCompanyId, allCompanyMembers } = useCompanyStore();
  const { users = [] } = useOperationalStore();
  const {
    historicoTrips = [],
    loading: tripsLoading,
    error: tripsError,
  } = useTripHistory(activeCompanyId, {
    userId: currentUser?.id,
  });

  const isDriverView = activeRole === "driver" || Boolean(defaultDriverId);
  const initialDriverId =
    defaultDriverId || (activeRole === "driver" ? currentUser?.id || null : null);

  const [period, setPeriod] = useState<ReportPeriod>("semanal");
  const [mode, setMode] = useState<"empresa" | "funcionarios">(
    isDriverView ? "funcionarios" : "empresa",
  );
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(
    initialDriverId,
  );
  const [visibleItems, setVisibleItems] = useState(5);

  useEffect(() => {
    if (!isDriverView) return;
    setMode("funcionarios");
    setSelectedDriverId(initialDriverId);
  }, [initialDriverId, isDriverView]);

  useEffect(() => {
    if (isDriverView) return;
    setMode("empresa");
    setSelectedDriverId(null);
    setVisibleItems(5);
  }, [activeCompanyId, isDriverView]);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);

  const validTrips = useMemo<ReportTrip[]>(() => {
    if (!activeCompanyId) return [];

    const normalizedTrips = historicoTrips.map((trip) =>
      normalizeTrip(trip as any),
    );

    return getFilteredTrips(
      normalizedTrips,
      undefined,
      undefined,
      activeCompanyId,
    )
      .filter(
        (trip) =>
          trip.metricDate instanceof Date &&
          Number.isFinite(trip.metricDate.getTime()),
      )
      .map((trip) => ({
        ...trip,
        parsedDate: new Date(trip.metricDate),
        val: trip.normalizedValor,
      }));
  }, [activeCompanyId, historicoTrips]);

  const generateHistory = (
    trips: ReportTrip[],
    currentPeriod: ReportPeriod,
  ): ReportHistoryItem[] => {
    const groups = new Map<
      string,
      Omit<ReportHistoryItem, "avgTicket" | "variation" | "hasPrevious">
    >();

    trips.forEach((trip) => {
      const date = trip.parsedDate;
      if (!Number.isFinite(date.getTime())) return;

      const range =
        currentPeriod === "semanal"
          ? getWeeklyRange(date)
          : getMonthlyRange(date);
      const key =
        currentPeriod === "semanal"
          ? utcDateKey(range.start)
          : utcMonthKey(range.start);
      const subTitle =
        currentPeriod === "semanal"
          ? `${formatUtcDate(range.start)} até ${formatUtcDate(range.end)}`
          : formatUtcMonth(range.start);
      const currentRange =
        currentPeriod === "semanal"
          ? getWeeklyRange(new Date())
          : getMonthlyRange(new Date());
      const isCurrent = range.start.getTime() === currentRange.start.getTime();
      const title =
        currentPeriod === "semanal"
          ? isCurrent
            ? "Semana atual"
            : `Semana de ${formatUtcDate(range.start)}`
          : isCurrent
            ? "Mês atual"
            : formatUtcMonth(range.start);

      const existing = groups.get(key);
      if (existing) {
        existing.tripCount += 1;
        existing.totalValue += trip.val;
        return;
      }

      groups.set(key, {
        id: key,
        title,
        subTitle,
        totalValue: trip.val,
        tripCount: 1,
        sortDate: range.start,
      });
    });

    const sorted = Array.from(groups.values()).sort(
      (a, b) => a.sortDate.getTime() - b.sortDate.getTime(),
    );
    const totalsByPeriod = new Map(
      sorted.map((item) => [item.id, item.totalValue] as const),
    );

    return sorted
      .map((item) => {
        const previousReference = new Date(item.sortDate);
        if (currentPeriod === "semanal") {
          previousReference.setUTCDate(previousReference.getUTCDate() - 7);
        } else {
          previousReference.setUTCMonth(previousReference.getUTCMonth() - 1);
        }
        const previousKey =
          currentPeriod === "semanal"
            ? utcDateKey(getWeeklyRange(previousReference).start)
            : utcMonthKey(getMonthlyRange(previousReference).start);
        const previousTotal = totalsByPeriod.get(previousKey);
        const hasPrevious = previousTotal !== undefined;
        let variation = 0;

        if (hasPrevious) {
          if ((previousTotal || 0) > 0) {
            variation =
              ((item.totalValue - (previousTotal || 0)) /
                (previousTotal || 1)) *
              100;
          } else if (item.totalValue > 0) {
            variation = 100;
          }
        }

        return {
          ...item,
          avgTicket:
            item.tripCount > 0 ? item.totalValue / item.tripCount : 0,
          variation,
          hasPrevious,
        };
      })
      .reverse();
  };

  const companyHistory = useMemo(() => {
    if (mode !== "empresa") return [];
    return generateHistory(validTrips, period);
  }, [mode, period, validTrips]);

  const driverHistory = useMemo(() => {
    if (mode !== "funcionarios" || !selectedDriverId) return [];
    return generateHistory(
      validTrips.filter(
        (trip) => getCanonicalTripDriverId(trip) === selectedDriverId,
      ),
      period,
    );
  }, [mode, period, selectedDriverId, validTrips]);

  const activeDrivers = useMemo(() => {
    const namesById = new Map<string, string>();
    const usersById = new Map(
      users.map((user) => [String(user.id || ""), user] as const),
    );

    allCompanyMembers.forEach((member) => {
      if (
        member.companyId !== activeCompanyId ||
        member.status !== "active" ||
        !member.userId
      ) {
        return;
      }
      const roles = Array.isArray(member.roles)
        ? member.roles
        : member.role
          ? [member.role]
          : [];
      if (!roles.includes("driver")) return;

      const user = usersById.get(member.userId);
      namesById.set(
        member.userId,
        String(user?.name || user?.email || "Motorista sem nome"),
      );
    });

    validTrips.forEach((trip) => {
      const driverId = getCanonicalTripDriverId(trip);
      if (!driverId) return;
      const user = usersById.get(driverId);
      namesById.set(
        driverId,
        String(
          user?.name ||
            getCanonicalTripDriverName(trip) ||
            namesById.get(driverId) ||
            "Motorista sem nome",
        ),
      );
    });

    if (isDriverView && initialDriverId) {
      const currentName =
        currentUser?.name || currentUser?.email || "Motorista";
      namesById.set(initialDriverId, String(currentName));
    }

    return Array.from(namesById, ([id, name]) => ({ id, name })).sort(
      (a, b) =>
        a.name.localeCompare(b.name, "pt-BR", {
          sensitivity: "base",
          numeric: true,
        }) || a.id.localeCompare(b.id),
    );
  }, [
    activeCompanyId,
    allCompanyMembers,
    currentUser?.email,
    currentUser?.name,
    initialDriverId,
    isDriverView,
    users,
    validTrips,
  ]);

  const handleLoadMore = () => {
    setVisibleItems((prev) => prev + 5);
  };

  const handleModeChange = (newMode: "empresa" | "funcionarios") => {
    if (isDriverView) return;
    setMode(newMode);
    setSelectedDriverId(null);
    setVisibleItems(5);
  };

  const handlePeriodChange = (newPeriod: "semanal" | "mensal") => {
    setPeriod(newPeriod);
    setVisibleItems(5);
  };

  const renderHistoryList = (list: ReportHistoryItem[]) => {
    if (tripsLoading && list.length === 0) {
      return (
        <div className="bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-[12px] shadow-sm px-4 py-8 flex items-center justify-center">
          <span className="text-[14px] font-medium text-slate-500 dark:text-slate-400">
            Atualizando resultados...
          </span>
        </div>
      );
    }

    if (list.length === 0) {
      return (
        <div className="bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-[12px] shadow-sm px-4 py-8 flex flex-col items-center justify-center text-center">
          <span className="text-[15px] font-medium text-slate-600 dark:text-slate-400">
            Nenhum dado encontrado para o histórico {period}.
          </span>
        </div>
      );
    }
    
    return (
        <div className="space-y-2.5">
          {list.slice(0, visibleItems).map((item) => (
            <div key={item.id} className="bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-[12px] shadow-sm p-3.5 flex flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold text-slate-900 dark:text-white leading-tight">
                  {item.title}
                </span>
                <span className="text-[12px] font-normal text-slate-500 dark:text-slate-400 leading-none">
                  {item.subTitle.includes(' até ') ? (
                    `${item.subTitle.split(' até ')[0]} até ${item.subTitle.split(' até ')[1]}`
                  ) : (
                    item.subTitle
                  )}
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-50 dark:bg-black/20 rounded-[8px] p-2 flex flex-col items-center justify-center border border-slate-100 dark:border-[#2A2F3A]/50 text-center">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 flex items-center leading-none uppercase tracking-wider break-normal">Ganhos</span>
                  <span className="text-[13px] sm:text-[14px] font-bold text-emerald-600 dark:text-emerald-400 leading-tight break-all">
                    {formatCurrency(item.totalValue)}
                  </span>
                </div>
                
                <div className="bg-slate-50 dark:bg-black/20 rounded-[8px] p-2 flex flex-col items-center justify-center border border-slate-100 dark:border-[#2A2F3A]/50 text-center">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 flex items-center leading-none uppercase tracking-wider break-normal">Viagens</span>
                  <span className="text-[13px] sm:text-[14px] font-bold text-slate-800 dark:text-slate-200 leading-tight break-words flex flex-wrap items-center justify-center">
                    {item.tripCount} <span className="text-[12px] font-medium ml-1">viagens</span>
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-[#2A2F3A] flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-none mt-0.5">Ticket Médio:</span>
                  <span className="text-[12px] font-semibold text-slate-800 dark:text-slate-200 leading-none">{formatCurrency(item.avgTicket)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-none mt-0.5">Desempenho:</span>
                  {item.hasPrevious ? (
                    <div className={cn("flex items-center gap-0.5 text-[12px] font-semibold leading-none", item.variation > 0 ? "text-emerald-600 dark:text-emerald-400" : item.variation < 0 ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-400")}>
                      {item.variation > 0 ? <ArrowUpRight size={14} className="shrink-0" /> : item.variation < 0 ? <ArrowDownRight size={14} className="shrink-0" /> : <Minus size={14} className="shrink-0" />}
                      {Math.abs(item.variation).toFixed(1)}%
                    </div>
                  ) : (
                    <span className="text-[12px] font-medium text-slate-400 dark:text-slate-500 leading-none">-</span>
                  )}
                </div>
              </div>
            </div>
          ))}

          {visibleItems < list.length && (
            <button 
              onClick={handleLoadMore}
              className="w-full bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] text-emerald-600 dark:text-emerald-400 font-bold py-2.5 rounded-[12px] flex items-center justify-center gap-2 mt-4 shadow-sm hover:bg-slate-50 dark:hover:bg-[#2A2F3A] transition-colors text-[14px]"
            >
              Carregar mais registros
              <ChevronDown size={16} />
            </button>
          )}
        </div>
    );
  };

  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-50 dark:bg-[#09090b] font-sans pb-8 w-full box-border">
      <div className="max-w-[900px] mx-auto flex flex-col gap-4 pt-4 sm:pt-6 w-full px-4 sm:px-4 md:px-0 box-border">
        
        {/* Header Container */}
        {!hideHeader && (
        <div className="px-1 mb-2 flex items-center gap-2.5">
          <button 
            onClick={() => navigate(activeRole === "admin" ? "/admin" : "/driver")}
            className="w-7 h-7 rounded-full bg-slate-200 dark:bg-[#1A1F26] flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-[#2A2F3A] transition-colors shrink-0"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex flex-col justify-center">
            <h1 className="text-[16px] sm:text-[18px] font-bold text-slate-900 dark:text-white tracking-tight leading-none">
              Relatórios
            </h1>
            <p className="text-[12px] font-medium text-slate-500 dark:text-slate-400 mt-1 leading-none">
              Fechamento de entregas e ganhos
            </p>
          </div>
        </div>
        )}

        <div className="space-y-3">
          {/* Period Selector */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={() => handlePeriodChange("semanal")}
              className={cn(
                "flex items-center justify-center gap-1.5 py-1.5 px-3 min-h-[42px] rounded-[10px] border text-[13px] sm:text-[14px] font-bold transition-colors",
                period === "semanal"
                  ? "bg-emerald-50/50 dark:bg-emerald-500/10 border-emerald-500/30 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                  : "bg-white dark:bg-[#1A1F26] border-slate-200 dark:border-[#2A2F3A] text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-[#2A2F3A]"
              )}
            >
              <Calendar size={15} className="shrink-0" />
              Semanal
            </button>
            <button
              onClick={() => handlePeriodChange("mensal")}
              className={cn(
                "flex items-center justify-center gap-1.5 py-1.5 px-3 min-h-[42px] rounded-[10px] border text-[13px] sm:text-[14px] font-bold transition-colors",
                period === "mensal"
                  ? "bg-emerald-50/50 dark:bg-emerald-500/10 border-emerald-500/30 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                  : "bg-white dark:bg-[#1A1F26] border-slate-200 dark:border-[#2A2F3A] text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-[#2A2F3A]"
              )}
            >
              <Calendar size={15} className="shrink-0" />
              Mensal
            </button>
          </div>

          {!isDriverView && (
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={() => handleModeChange("empresa")}
              className={cn(
                "flex items-center justify-center gap-1.5 py-1.5 px-3 min-h-[42px] rounded-[10px] border text-[13px] sm:text-[14px] font-bold transition-colors",
                mode === "empresa"
                  ? "bg-emerald-50/50 dark:bg-emerald-500/10 border-emerald-500/30 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                  : "bg-white dark:bg-[#1A1F26] border-slate-200 dark:border-[#2A2F3A] text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-[#2A2F3A]"
              )}
            >
              <Building2 size={15} className="shrink-0" />
              Da Empresa
            </button>
            <button
              onClick={() => handleModeChange("funcionarios")}
              className={cn(
                "flex items-center justify-center gap-1.5 py-1.5 px-3 min-h-[42px] rounded-[10px] border text-[13px] sm:text-[14px] font-bold transition-colors",
                mode === "funcionarios"
                  ? "bg-emerald-50/50 dark:bg-emerald-500/10 border-emerald-500/30 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                  : "bg-white dark:bg-[#1A1F26] border-slate-200 dark:border-[#2A2F3A] text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-[#2A2F3A]"
              )}
            >
              <Users size={15} className="shrink-0" />
              Dos Funcionários
            </button>
          </div>
          )}
        </div>

        {tripsError && (
          <div className="rounded-[12px] border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12px] font-medium text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
            Não foi possível atualizar os relatórios agora. O último resultado disponível foi mantido e uma nova tentativa será feita automaticamente.
          </div>
        )}

        {mode === "empresa" && (
          <div className="mt-5">
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="w-[3px] h-[16px] bg-emerald-600 rounded-full"></div>
              <h2 className="text-[16px] font-bold text-slate-900 dark:text-white tracking-tight">Histórico de Fechamento</h2>
            </div>
            {renderHistoryList(companyHistory)}
          </div>
        )}

        {mode === "funcionarios" && !selectedDriverId && (
          <div className="mt-5 flex flex-col gap-2.5">
            <div className="flex items-center gap-2 mb-1 px-1">
              <div className="w-[3px] h-[16px] bg-emerald-600 rounded-full"></div>
              <h2 className="text-[16px] font-bold text-slate-900 dark:text-white tracking-tight">
                Selecione um Motorista
              </h2>
            </div>
            
            {activeDrivers.length === 0 ? (
              <div className="bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-[12px] shadow-sm px-4 py-8 flex flex-col items-center justify-center text-center">
                <span className="text-[15px] font-medium text-slate-600 dark:text-slate-400">Nenhum motorista ativo encontrado.</span>
              </div>
            ) : (
              <>
                {activeDrivers.map((driver) => (
                  <div 
                    key={driver.id} 
                    onClick={() => { setSelectedDriverId(driver.id); setVisibleItems(5); }}
                    className="bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-[12px] shadow-sm px-4 py-3 flex items-center justify-between cursor-pointer hover:border-emerald-200 dark:hover:border-emerald-500/30 transition-colors"
                  >
                    <div className="flex flex-col gap-1 w-full">
                      <span className="text-[15px] font-semibold text-slate-900 dark:text-white leading-tight truncate">
                         {driver.name}
                      </span>
                      <span className="text-[12px] font-normal text-slate-500 dark:text-slate-400 leading-snug">
                         Acessar relatório financeiro individual
                      </span>
                    </div>
                    <div className="shrink-0 flex items-center">
                      <ChevronRight size={18} className="text-slate-400 dark:text-slate-500" />
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {mode === "funcionarios" && selectedDriverId && (
          <div className="mt-5">
            <div className="flex items-center gap-3 mb-4 px-1">
              {!isDriverView && (
                <button 
                  onClick={() => setSelectedDriverId(null)}
                  className="w-8 h-8 rounded-full bg-slate-200 dark:bg-[#1A1F26] flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-[#2A2F3A] transition-colors shrink-0"
                >
                  <ArrowLeft size={18} />
                </button>
              )}
              <div className="flex flex-col">
                <h2 className="text-[16px] font-bold text-slate-900 dark:text-white tracking-tight">
                  {activeDrivers.find(d => d.id === selectedDriverId)?.name || "Motorista"}
                </h2>
                <span className="text-[12px] text-slate-500 dark:text-slate-400 leading-none mt-0.5">Histórico financeiro individual</span>
              </div>
            </div>

            {renderHistoryList(driverHistory)}
          </div>
        )}

        {/* Info Notice */}
        <div className="mt-5 mb-4">
          <div className="bg-[#f8fafc] dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/30 rounded-[12px] p-3.5 flex gap-2.5 shadow-sm">
            <Info className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" size={18} />
            <p className="text-[12px] text-slate-600 dark:text-slate-300 font-medium leading-relaxed">
              Os dados refletem o histórico oficial e excluem entregas rejeitadas, canceladas ou viagens ainda em andamento.
            </p>
          </div>
        </div>
        
        
      </div>
    </div>
  );
}
