import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useOperationalStore, useSessionStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { Button } from "../../components/ui/Button";
import { resolveSimulatorId } from "../../lib/resolveSimulator";
import { resolveSimulatorDisplayLabel } from "../../lib/simulatorOptions";
import { StableImage } from "../../components/common/StableImage";
import {
  UserCog,
  Building2,
  Search,
  ArrowLeft,
} from "lucide-react";

export default function JoinCompany() {
  const navigate = useNavigate();
  const { currentUser } = useSessionStore();
  const { simulators } = useOperationalStore();
  const {
    allCompanies,
    companiesLoading,
    companyCatalogLoaded,
    companyCatalogAttempted,
    loadCompanyCatalog,
    allCompanyMembers,
    requestJoinCompany,
    cancelRequestJoinCompany,
    driverRequests,
  } = useCompanyStore();

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSimulatorId, setSelectedSimulatorId] = useState("");
  const [isRequestingId, setIsRequestingId] = useState<string | null>(null);

  useEffect(() => {
    if (companyCatalogLoaded || companyCatalogAttempted) return;
    void loadCompanyCatalog();
  }, [companyCatalogAttempted, companyCatalogLoaded, loadCompanyCatalog]);

  const activeSimulators = simulators.filter((s:any) => s.active !== false).sort((a:any, b:any) => a.name.localeCompare(b.name));
  const getSimulatorLabel = (company: any) =>
    resolveSimulatorDisplayLabel(
      company,
      simulators as any[],
      allCompanies as any[],
    ) || company?.simulatorName || "Global Truck";

  // Check if there is an active request
  const myPendingRequest = driverRequests.find(
    (r) => r.motoristaId === currentUser?.id && r.status === "pending",
  );

  if (myPendingRequest) {
    const company = allCompanies.find((c) => c.id === myPendingRequest.empresaId);
    return (
      <div className="w-full max-w-7xl mx-auto py-4 sm:py-10 px-4 sm:px-6">
        <div className="max-w-md mx-auto w-full mb-8">
          <button
            onClick={() => navigate("/select-profile")}
            className="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-[#a1a1aa] hover:text-gray-900 dark:hover:text-[#fafafa] transition-colors"
          >
            <ArrowLeft size={16} />
            Voltar
          </button>
        </div>
        <div className="flex flex-col items-center justify-center h-[50vh] text-center max-w-md mx-auto">
          <div className="w-24 h-24 bg-orange-50 dark:bg-orange-500/10 rounded-full flex items-center justify-center mb-6 text-orange-500">
            <UserCog size={40} />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-[#fafafa] mb-2">
            Aguardando Aprovação
          </h2>
          <p className="text-gray-500 dark:text-[#a1a1aa] mb-8">
            Seu convite para a empresa{" "}
            <strong className="text-gray-900 dark:text-[#fafafa]">
              {company?.companyName || "Carregando..."}
            </strong>{" "}
            foi enviado. O administrador da frota precisa aprovar seu acesso.
          </p>
          <Button
            variant="outline"
            onClick={() => cancelRequestJoinCompany(myPendingRequest.id)}
            className="text-gray-500 dark:text-[#a1a1aa] hover:text-gray-900 dark:hover:text-[#f4f4f5]"
          >
            Cancelar Convite
          </Button>
        </div>
      </div>
    );
  }

  // Not linked to any company yet
  const handleRequest = async (companyId: string) => {
    setIsRequestingId(companyId);
    try {
      // Never hold the action behind an artificial delay.
      await requestJoinCompany(companyId);
    } finally {
      setIsRequestingId(null);
    }
  };

  // Calculate member counts
  const companiesWithCount = allCompanies
    .map((c) => ({
      ...c,
      memberCount:
        allCompanyMembers?.filter((m) => m.companyId === c.id).length || 0,
    }))
    .sort(
      (a, b) =>
        b.memberCount - a.memberCount ||
        a.companyName.localeCompare(b.companyName),
    );

  const filteredCompanies = companiesWithCount.filter((c) => {
    if (!selectedSimulatorId) return false;
    const matchesSimulator =
      resolveSimulatorId(c as any, simulators as any[], allCompanies as any[]) ===
      selectedSimulatorId;
    const matchesSearch = c.companyName.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSimulator && matchesSearch;
  });

  const isSearching = searchTerm.length > 0;

  return (
    <div className="w-full max-w-7xl mx-auto py-4 sm:py-10 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto w-full mb-6 sm:mb-10">
        <button
          onClick={() => navigate("/select-profile")}
          className="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-[#a1a1aa] hover:text-gray-900 dark:hover:text-[#fafafa] transition-colors"
        >
          <ArrowLeft size={16} />
          Voltar
        </button>
      </div>

      {/* HERO */}
      {!isSearching && (
        <div className="text-center mb-10 transition-all duration-300">
          <div className="w-16 h-16 bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/40 rounded-2xl flex items-center justify-center mx-auto mb-5 text-blue-600 shadow-sm dark:shadow-none border border-blue-100 dark:border-blue-500/20/50">
            <Building2 size={28} strokeWidth={2} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-[#fafafa] tracking-tight">
            Encontre sua Frota
          </h1>
          <p className="text-[15px] text-gray-500 dark:text-[#a1a1aa] mt-2 max-w-[280px] sm:max-w-md mx-auto leading-relaxed">
            Pesquise o nome da empresa ou frota e envie sua solicitação de acesso.
          </p>
        </div>
      )}

      {/* SIMULATOR SELECT */}
      <div className="max-w-2xl mx-auto px-4 sm:px-0 mb-4">
        <label className="block text-[13px] font-medium text-slate-700 dark:text-[#d4d4d8] mb-1.5 ml-0.5">
          Simulador
        </label>
        <select
          value={selectedSimulatorId}
          onChange={(e) => setSelectedSimulatorId(e.target.value)}
          className="w-full bg-white dark:bg-[#09090b] border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 h-14 text-[15px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:text-[#fafafa] transition-all shadow-sm appearance-none cursor-pointer"
        >
          <option value="" disabled>Selecione um simulador</option>
          {activeSimulators.map((sim:any) => (
            <option key={sim.id} value={sim.id}>
              {sim.name}
            </option>
          ))}
        </select>
      </div>

      {/* SEARCH INPUT */}
      <div className="relative mb-8 group max-w-2xl mx-auto px-4 sm:px-0">
        <div className="absolute inset-y-0 left-4 sm:left-0 pl-4 sm:pl-5 flex items-center pointer-events-none">
          <Search
            className="text-gray-400 group-focus-within:text-blue-500 transition-colors"
            size={20}
          />
        </div>
        <input
          type="text"
          disabled={!selectedSimulatorId}
          placeholder={selectedSimulatorId ? "Buscar empresa ou frota..." : "Selecione um simulador antes"}
          autoFocus
          className="w-full pl-12 sm:pl-14 pr-4 h-14 bg-white dark:bg-[#1A1F26] rounded-2xl border border-gray-200 dark:border-[#2A2F3A] focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 text-[15px] font-medium text-gray-900 dark:text-[#fafafa] placeholder:text-gray-400 dark:placeholder:text-[#71717a] shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* LIST */}
      <div className="space-y-3 max-w-2xl mx-auto px-4 sm:px-0">
        {!companyCatalogAttempted || companiesLoading ? (
          <div className="text-center py-12 text-sm text-gray-500 dark:text-[#a1a1aa]">
            Carregando empresas...
          </div>
        ) : !companyCatalogLoaded ? (
          <div className="text-center py-12 text-sm text-red-500 dark:text-red-400">
            Não foi possível carregar as empresas. Reabra esta página para tentar novamente.
          </div>
        ) : !selectedSimulatorId ? (
          <div className="text-center py-12 px-4 rounded-2xl border border-dashed border-gray-200 dark:border-[#2A2F3A] bg-gray-50 dark:bg-[#1A1F26]">
            <Building2 size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-[15px] font-medium text-gray-900 dark:text-[#fafafa]">
              Selecione um simulador
            </p>
            <p className="text-sm text-gray-500 dark:text-[#a1a1aa] mt-1">
              Escolha um simulador acima para listar as empresas disponíveis.
            </p>
          </div>
        ) : filteredCompanies.length === 0 ? (
          <div className="text-center py-12 px-4 rounded-2xl border border-dashed border-gray-200 dark:border-[#2A2F3A] bg-gray-50 dark:bg-[#1A1F26]">
            <Search size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-[15px] font-medium text-gray-900 dark:text-[#fafafa]">
              Nenhuma empresa encontrada
            </p>
            <p className="text-sm text-gray-500 dark:text-[#a1a1aa] mt-1">
              Verifique a ortografia ou tente outro termo.
            </p>
          </div>
        ) : (
          filteredCompanies.map((company) => (
            <div
              key={company.id}
              className="flex items-center p-3 sm:p-4 bg-white dark:bg-[#1A1F26] rounded-2xl border border-gray-100 dark:border-[#2A2F3A] hover:border-blue-200 dark:border-blue-500/30 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)] hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.05)] transition-all group"
            >
              <div className="flex-1 flex items-center gap-3 sm:gap-4 min-w-0 pr-4">
                {/* AVATAR */}
                <div className="flex flex-col items-center gap-1.5 shrink-0">
                  {company.logoUrl ? (
                    <StableImage
                      src={company.logoUrl}
                      alt="Logo"
                      loading="lazy"
                      decoding="async"
                      wrapperClassName="w-10 h-10 sm:w-12 sm:h-12 rounded-full border border-gray-100 dark:border-[#2A2F3A] shrink-0"
                      className="object-cover"
                      referrerPolicy="no-referrer"
                      fallback={
                        <span className="h-full w-full bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center font-bold text-blue-700 dark:text-blue-400 text-sm sm:text-base">
                          {company.companyName.substring(0, 2).toUpperCase()}
                        </span>
                      }
                    />
                  ) : (
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/20 border border-blue-100 dark:border-blue-500/20/50 flex items-center justify-center font-bold text-blue-700 dark:text-blue-400 text-sm sm:text-base group-hover:bg-blue-600 group-hover:text-white transition-colors">
                      {company.companyName.substring(0, 2).toUpperCase()}
                    </div>
                  )}
                  <span className="sm:hidden px-1.5 py-0.5 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 rounded-md text-[9px] font-bold tracking-wide truncate max-w-[60px]">
                    {getSimulatorLabel(company)}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] sm:text-[16px] font-bold text-gray-900 dark:text-[#fafafa] tracking-tight truncate leading-tight group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    {company.companyName}
                  </h3>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-3 mt-1 sm:mt-1.5">
                    <span className="text-xs font-medium text-gray-500 dark:text-[#a1a1aa] bg-gray-50 dark:bg-[#09090b] px-2 py-0.5 rounded-md border border-gray-100 dark:border-[#2A2F3A]">
                      {company.memberCount}{" "}
                      {company.memberCount === 1 ? "membro" : "membros"}
                    </span>
                    <span className="hidden sm:inline px-2 py-0.5 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 rounded-md text-xs font-bold tracking-wide border border-blue-100 dark:border-blue-500/20/50">
                      {getSimulatorLabel(company)}
                    </span>
                  </div>
                </div>
              </div>

              <Button
                onClick={() => handleRequest(company.id)}
                disabled={isRequestingId === company.id}
                className="shrink-0 h-10 px-4 text-[13px] font-bold bg-gray-900 dark:bg-[#fafafa] text-white dark:text-[#09090b] hover:bg-black dark:hover:bg-white rounded-xl shadow-[0_2px_10px_-3px_rgba(0,0,0,0.1)] active:scale-95 transition-all w-24 sm:w-28 relative overflow-hidden group/btn"
              >
                {isRequestingId === company.id ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 dark:border-black/30 border-t-white dark:border-t-black rounded-full animate-spin"></div>
                  </div>
                ) : (
                  <span className="relative z-10 flex items-center justify-center">
                    Solicitar
                  </span>
                )}
                {/* Shine effect logic */}
                <div className="absolute inset-0 -translate-x-[150%] animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 dark:via-black/10 to-transparent skew-x-[-20deg] z-0"></div>
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
