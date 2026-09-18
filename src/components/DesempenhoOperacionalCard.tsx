import React, { useState } from "react";
import { TrendingUp, Star, X, Route, Target, Users, Crosshair, Activity, ChevronRight } from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "../lib/utils";

export interface DesempenhoMetrics {
  motoristasAtivos: number;
  metaOperacional: number;
  viagensRealizadas: number;
  viagensRestantes: number;
  metaPorMotorista: number;
  mediaOperacional: number;
  capacidadeOperacional: number;
  scoreDisplay: number;
  scoreStatus: number;
}

interface DesempenhoOperacionalCardProps {
  metrics: DesempenhoMetrics;
  className?: string;
  periodPreset?: "semana" | "mes" | "custom";
  setPeriodPreset?: (val: "semana" | "mes" | "custom") => void;
}

export function DesempenhoOperacionalCard({
  metrics,
  className,
  periodPreset,
  setPeriodPreset,
}: DesempenhoOperacionalCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const getClassification = (score: number) => {
    if (score >= 150)
      return {
        text: "👑 Elite Operacional",
        badgeText: "Elite Operacional",
        message: "Resultado excepcional. A empresa tornou-se referência operacional neste período.",
        effectClass: "shadow-[0_0_15px_rgba(139,92,246,0.3)] dark:shadow-[0_0_15px_rgba(139,92,246,0.15)]",
        textColor: "text-[#8b5cf6] dark:text-[#a78bfa]",
        iconColor: "text-[#8b5cf6] dark:text-[#a78bfa]",
        bgHover: "hover:bg-violet-50 dark:hover:bg-violet-900/10",
        indicatorColor: "bg-[#8b5cf6]",
        barGradient: "from-violet-400 to-violet-500",
        dotColor: "bg-[#8b5cf6]",
      };
    if (score >= 121)
      return {
        text: "🏆 Missão Superada",
        badgeText: "Missão Superada",
        message: "A operação superou o objetivo estabelecido e segue em excelente desempenho.",
        effectClass: "shadow-[0_0_15px_rgba(16,185,129,0.3)] dark:shadow-[0_0_15px_rgba(16,185,129,0.15)]",
        textColor: "text-[#10b981] dark:text-[#34d399]",
        iconColor: "text-[#10b981] dark:text-[#34d399]",
        bgHover: "hover:bg-emerald-50 dark:hover:bg-emerald-900/10",
        indicatorColor: "bg-[#10b981]",
        barGradient: "from-emerald-400 to-emerald-500",
        dotColor: "bg-[#10b981]",
      };
    if (score >= 100)
      return {
        text: "✅ Missão Cumprida",
        badgeText: "Missão Cumprida",
        message: "Parabéns! A meta operacional foi atingida com sucesso.",
        effectClass: "shadow-[0_0_15px_rgba(34,197,94,0.3)] dark:shadow-[0_0_15px_rgba(34,197,94,0.15)]",
        textColor: "text-[#22c55e] dark:text-[#4ade80]",
        iconColor: "text-[#22c55e] dark:text-[#4ade80]",
        bgHover: "hover:bg-green-50 dark:hover:bg-green-900/10",
        indicatorColor: "bg-[#22c55e]",
        barGradient: "from-green-400 to-green-500",
        dotColor: "bg-[#22c55e]",
      };
    if (score >= 81)
      return {
        text: "🎯 Objetivo à Vista",
        badgeText: "Objetivo à Vista",
        message: "Falta pouco para alcançar a meta do período. Mantenha o ritmo atual.",
        effectClass: "shadow-[0_0_15px_rgba(234,179,8,0.3)] dark:shadow-[0_0_15px_rgba(234,179,8,0.15)]",
        textColor: "text-[#eab308] dark:text-[#facc15]",
        iconColor: "text-[#eab308] dark:text-[#facc15]",
        bgHover: "hover:bg-yellow-50 dark:hover:bg-yellow-900/10",
        indicatorColor: "bg-[#eab308]",
        barGradient: "from-yellow-400 to-yellow-500",
        dotColor: "bg-[#eab308]",
      };
    if (score >= 61)
      return {
        text: "⚡ Operação Acelerada",
        badgeText: "Operação Acelerada",
        message: "A operação acelera rumo à meta e segue no caminho certo.",
        effectClass: "shadow-[0_0_15px_rgba(14,165,233,0.3)] dark:shadow-[0_0_15px_rgba(14,165,233,0.15)]",
        textColor: "text-[#0ea5e9] dark:text-[#38bdf8]",
        iconColor: "text-[#0ea5e9] dark:text-[#38bdf8]",
        bgHover: "hover:bg-sky-50 dark:hover:bg-sky-900/10",
        indicatorColor: "bg-[#0ea5e9]",
        barGradient: "from-sky-400 to-sky-500",
        dotColor: "bg-[#0ea5e9]",
      };
    if (score >= 41)
      return {
        text: "🚚 Frota em Movimento",
        badgeText: "Frota em Movimento",
        message: "A equipe está construindo um bom ritmo operacional. Continue avançando.",
        effectClass: "shadow-[0_0_15px_rgba(59,130,246,0.3)] dark:shadow-[0_0_15px_rgba(59,130,246,0.15)]",
        textColor: "text-[#3b82f6] dark:text-[#60a5fa]",
        iconColor: "text-[#3b82f6] dark:text-[#60a5fa]",
        bgHover: "hover:bg-blue-50 dark:hover:bg-blue-900/10",
        indicatorColor: "bg-[#3b82f6]",
        barGradient: "from-blue-400 to-blue-500",
        dotColor: "bg-[#3b82f6]",
      };
    if (score >= 21)
      return {
        text: "🛣️ Rota Estabelecida",
        badgeText: "Rota Estabelecida",
        message: "A frota já definiu seu ritmo inicial, ganhando tração.",
        effectClass: "shadow-[0_0_15px_rgba(99,102,241,0.3)] dark:shadow-[0_0_15px_rgba(99,102,241,0.15)]",
        textColor: "text-[#6366f1] dark:text-[#818cf8]",
        iconColor: "text-[#6366f1] dark:text-[#818cf8]",
        bgHover: "hover:bg-indigo-50 dark:hover:bg-indigo-900/10",
        indicatorColor: "bg-[#6366f1]",
        barGradient: "from-indigo-400 to-indigo-500",
        dotColor: "bg-[#6366f1]",
      };
    return {
      text: "🚦 Operação Iniciada",
      badgeText: "Operação Iniciada",
      message: "O período está em andamento. Cada viagem registrada contribui para o avanço da operação.",
      effectClass: "shadow-[0_0_15px_rgba(100,116,139,0.3)] dark:shadow-[0_0_15px_rgba(100,116,139,0.15)]",
      textColor: "text-[#64748b] dark:text-[#94a3b8]",
      iconColor: "text-[#64748b] dark:text-[#94a3b8]",
      bgHover: "hover:bg-slate-50 dark:hover:bg-slate-900/10",
      indicatorColor: "bg-[#64748b]",
      barGradient: "from-slate-400 to-slate-500",
      dotColor: "bg-[#64748b]",
    };
  };

  const cls = getClassification(metrics.scoreStatus);

  return (
    <>
      {/* COMPACT CARD */}
      <div
        onClick={() => setIsModalOpen(true)}
        className={cn(
          "bg-white dark:bg-[#1A1F26] rounded-2xl p-4 sm:p-5 border border-slate-100 dark:border-[#2A2F3A] font-sans w-full flex items-center justify-between cursor-pointer transition-all duration-300 shadow-sm hover:shadow",
          cls.bgHover,
          className,
        )}
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-slate-50 dark:bg-[#2A2F3A] flex items-center justify-center shrink-0 shadow-sm border border-slate-100 dark:border-[#3A3F4A]">
            <TrendingUp size={20} className={cls.iconColor} strokeWidth={2.5} />
          </div>
          <div className="flex flex-col">
            <h2 className="text-slate-500 dark:text-slate-400 font-bold text-[11px] sm:text-[12px] tracking-wider uppercase mb-0.5">
              Desempenho Operacional
            </h2>
            <div className="flex items-center gap-2">
              <span className={cn("font-black text-[18px] sm:text-[20px] leading-none drop-shadow-sm", cls.textColor)}>
                {metrics.scoreDisplay.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
              </span>
              <div className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600"></div>
              <span className={cn("font-bold text-[13px] sm:text-[14px] leading-none mt-[2px]", cls.textColor)}>
                {cls.text}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 text-slate-400 dark:text-slate-500 font-medium text-[13px]">
            Ver detalhes
          </div>
          <div
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center bg-slate-50 dark:bg-[#2A2F3A] transition-transform duration-300",
              "group-hover:translate-x-1",
            )}
          >
            <ChevronRight size={18} className="text-slate-400 dark:text-slate-500" />
          </div>
        </div>
      </div>

      {/* MODAL */}
      {isModalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[1500] flex items-end md:items-center justify-center p-0 md:p-6 bg-slate-900/60 backdrop-blur-sm transition-opacity duration-300 font-sans"
            onClick={() => setIsModalOpen(false)}
          >
            <div
              className="w-full md:max-w-4xl bg-gray-50 dark:bg-[#12161b] md:rounded-[32px] rounded-t-[32px] shadow-2xl relative flex flex-col md:h-auto overflow-hidden animate-in slide-in-from-bottom-10 md:slide-in-from-bottom-0 md:zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
              style={{ maxHeight: "95vh" }}
            >
              {/* Mobile handle */}
              <div className="md:hidden w-10 h-1 bg-gray-300 dark:bg-gray-700 rounded-full mx-auto mt-3 mb-1 relative z-20"></div>

              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-5 relative w-full bg-white dark:bg-[#161B22] border-b border-gray-100 dark:border-[#2A2F3A] overflow-hidden">
                {/* Header background flair now contained inside the header */}
                <div className={cn("absolute top-0 right-0 w-80 h-80 bg-gradient-to-bl from-current via-current/5 to-transparent opacity-10 -mr-16 -mt-16 rounded-full pointer-events-none z-0", cls.textColor)} />

                <div className="flex items-center gap-4 relative z-10">
                  <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center bg-current/10", cls.textColor)}>
                    <Activity size={24} className="fill-current opacity-80" />
                  </div>
                  <div className="flex flex-col">
                    <h2 className="text-gray-900 dark:text-white font-bold text-xl tracking-tight leading-tight">
                      Desempenho Operacional
                    </h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={cn("font-black text-[22px] tracking-tight leading-none", cls.textColor)}>
                        {metrics.scoreDisplay.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                      </span>
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
                      <div className={cn("flex items-center gap-1.5 text-sm font-semibold whitespace-nowrap", cls.textColor)}>
                        {cls.badgeText}
                      </div>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-[#2A2F3A] transition-colors text-gray-400 dark:text-gray-500 z-10 relative"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="w-full px-6 py-5 overflow-y-auto z-10 custom-scrollbar flex flex-col gap-5">
                
                {setPeriodPreset && (
                  <div className="flex items-center p-1 bg-gray-100 dark:bg-[#1A1F26] rounded-lg w-full max-w-[280px] mx-auto border border-gray-200/50 dark:border-[#2A2F3A]">
                    <button
                      onClick={() => setPeriodPreset("semana")}
                      className={cn(
                        "flex-1 px-4 py-1.5 text-sm font-semibold rounded-md transition-all duration-200",
                        periodPreset === "semana"
                          ? "bg-white dark:bg-[#2A2F3A] text-gray-900 dark:text-white shadow-sm"
                          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                      )}
                    >
                      Semana
                    </button>
                    <button
                      onClick={() => setPeriodPreset("mes")}
                      className={cn(
                        "flex-1 px-4 py-1.5 text-sm font-semibold rounded-md transition-all duration-200",
                        periodPreset === "mes"
                          ? "bg-white dark:bg-[#2A2F3A] text-gray-900 dark:text-white shadow-sm"
                          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                      )}
                    >
                      Mensal
                    </button>
                  </div>
                )}

                {/* Bloco 9: Mensagem Inteligente */}
                <div className={cn("rounded-xl p-4 border flex items-start gap-3 text-sm font-medium transition-all shadow-sm", "bg-current/5 border-current/20", cls.textColor)}>
                  <Activity size={18} className="mt-0.5 shrink-0" />
                  <div className="leading-relaxed">{cls.message}</div>
                </div>

                {/* Grid Responsivo e Mais Compacto */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                  {/* Bloco 1: Viagens realizadas */}
                  <div className="bg-white dark:bg-[#1A1F26] rounded-xl p-4 md:p-5 border border-gray-100 dark:border-[#2A2F3A] shadow-sm flex flex-col justify-center hover:shadow-md transition-shadow">
                    <span className="text-gray-500 dark:text-gray-400 text-[13px] font-medium mb-1.5 leading-none">Viagens Realizadas</span>
                    <span className="text-gray-900 dark:text-white text-2xl leading-none font-bold">{metrics.viagensRealizadas}</span>
                  </div>

                  {/* Bloco 2: Meta Operacional */}
                  <div className="bg-white dark:bg-[#1A1F26] rounded-xl p-4 md:p-5 border border-gray-100 dark:border-[#2A2F3A] shadow-sm flex flex-col justify-center hover:shadow-md transition-shadow">
                    <span className="text-gray-500 dark:text-gray-400 text-[13px] font-medium mb-1.5 leading-none">Meta Operacional</span>
                    <span className="text-gray-900 dark:text-white text-2xl leading-none font-bold">{metrics.metaOperacional}</span>
                  </div>

                  {/* Bloco 3: Faltam para a meta */}
                  <div className="bg-white dark:bg-[#1A1F26] rounded-xl p-4 md:p-5 border border-gray-100 dark:border-[#2A2F3A] shadow-sm flex flex-col justify-center hover:shadow-md transition-shadow">
                    <span className="text-gray-500 dark:text-gray-400 text-[13px] font-medium mb-1.5 leading-none">Faltam para Meta</span>
                    <span className="text-gray-900 dark:text-white text-2xl leading-none font-bold">
                      {metrics.viagensRestantes > 0 ? metrics.viagensRestantes : "Atingida"}
                    </span>
                  </div>

                  {/* Bloco 4: Motoristas em operação */}
                  <div className="bg-white dark:bg-[#1A1F26] rounded-xl p-4 md:p-5 border border-gray-100 dark:border-[#2A2F3A] shadow-sm flex flex-col justify-center hover:shadow-md transition-shadow">
                    <span className="text-gray-500 dark:text-gray-400 text-[13px] font-medium mb-1.5 leading-none">Motoristas Ativos</span>
                    <span className="text-gray-900 dark:text-white text-2xl leading-none font-bold">{metrics.motoristasAtivos}</span>
                  </div>

                  {/* Bloco 5: Meta por motorista */}
                  <div className="bg-white dark:bg-[#1A1F26] rounded-xl p-4 md:p-5 border border-gray-100 dark:border-[#2A2F3A] shadow-sm flex flex-col justify-center hover:shadow-md transition-shadow">
                    <span className="text-gray-500 dark:text-gray-400 text-[13px] font-medium mb-1.5 leading-none">Meta p/ Motorista</span>
                    <span className="text-gray-900 dark:text-white text-2xl leading-none font-bold">{metrics.metaPorMotorista}</span>
                  </div>

                  {/* Bloco 6: Média operacional */}
                  <div className="bg-white dark:bg-[#1A1F26] rounded-xl p-4 md:p-5 border border-gray-100 dark:border-[#2A2F3A] shadow-sm flex flex-col justify-center hover:shadow-md transition-shadow">
                    <span className="text-gray-500 dark:text-gray-400 text-[13px] font-medium mb-1.5 leading-none">Média Operacional</span>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-gray-900 dark:text-white text-2xl leading-none font-bold">{metrics.mediaOperacional.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                      <span className="text-xs font-medium text-gray-400">viagens/mot</span>
                    </div>
                  </div>
                </div>

                {/* Bloco 7 & 8: Capacidade Operacional */}
                <div className="bg-white dark:bg-[#1A1F26] rounded-xl p-5 border border-gray-100 dark:border-[#2A2F3A] shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3">
                  <div className="flex flex-col gap-2.5">
                    <span className="text-gray-900 dark:text-white font-bold text-[14px]">Capacidade Operacional</span>
                    <div className="flex">
                      <div className={cn("inline-flex items-center px-3 py-1.5 rounded-lg text-[13px] font-semibold border whitespace-nowrap", "bg-current/5 border-current/10", cls.textColor)}>
                        {cls.text}
                      </div>
                    </div>
                  </div>
                  
                  <div className="h-1.5 bg-gray-100 dark:bg-[#2A2F3A] rounded-full overflow-hidden relative">
                    <div 
                      className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-1000", cls.barGradient)}
                      style={{ width: `${Math.min(100, metrics.capacidadeOperacional)}%` }}
                    />
                  </div>
                  
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-gray-500 dark:text-gray-400 font-medium">{metrics.viagensRealizadas} / {metrics.metaOperacional} viagens</span>
                    <span className="text-gray-900 dark:text-white font-bold tracking-tight">{metrics.capacidadeOperacional.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span>
                  </div>
                </div>

              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
