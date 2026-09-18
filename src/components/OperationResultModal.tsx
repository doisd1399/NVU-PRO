import React from 'react';
import { Check, Clock, Hourglass, CalendarDays, Truck, X, Package, Banknote } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

export interface OperationResultData {
  contractName: string;
  tempoExecucao: string;
  tempoRestante: string;
  isAtrasado: boolean;
  prazoTotal: string;
  totalViagens: number;
  vehicleName?: string;
  trailerName?: string;
  showTrailer?: boolean;
  totalGanhos?: number;
}

interface OperationResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRequestNewJob: () => void;
  resultData: OperationResultData | null;
}

export function OperationResultModal({
  isOpen,
  onClose,
  onRequestNewJob,
  resultData
}: OperationResultModalProps) {
  const formatCurrency = (val?: number) => {
    if (val === undefined) return "R$ 0,00";
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val);
  };

  return (
    <AnimatePresence>
      {isOpen && resultData && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
            onClick={onClose}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-[#18181b] w-full max-w-[500px] max-h-[85vh] sm:max-h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col relative"
              onClick={e => e.stopPropagation()}
            >
              <button 
                onClick={onClose}
                className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/50 dark:bg-black/20 hover:bg-white dark:hover:bg-black/40 backdrop-blur-sm"
              >
                <X size={18} />
              </button>

              <div className="flex-1 overflow-y-auto overflow-x-hidden p-4">
                {/* Header */}
                <div className="flex flex-col items-center mb-4">
                  <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-500/20 rounded-full flex items-center justify-center shadow-sm mb-2">
                    <Check size={20} className="text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
                  </div>
                  <h2 className="text-[18px] font-black text-gray-900 dark:text-[#fafafa] mb-1 tracking-tight text-center leading-none">Operação finalizada!</h2>
                  <p className="text-gray-500 dark:text-gray-400 text-[12px] text-center font-medium">Inicie uma nova operação para continuar.</p>
                </div>

                {/* Contract Info */}
                <div className="flex items-center justify-between bg-gray-50 dark:bg-white/5 rounded-xl px-2.5 py-2 mb-3 border border-gray-100 dark:border-white/5">
                  <h3 className="text-[14px] font-bold text-gray-900 dark:text-[#fafafa] tracking-tight truncate mr-2">{resultData.contractName}</h3>
                  <span className="shrink-0 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold tracking-wider rounded-md uppercase flex items-center justify-center">Finalizada</span>
                </div>

                {/* Statistics List */}
                <div className="bg-gray-50 dark:bg-[#202024] rounded-xl border border-gray-100 dark:border-gray-800/60 p-2.5 mb-3 space-y-2">
                  {/* Número de viagens */}
                  <div className="flex items-center gap-2">
                    <Package size={11} className="text-gray-400 dark:text-gray-500 shrink-0" strokeWidth={2.5}/>
                    <div className="flex items-center gap-2 min-w-0 w-full">
                      <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 shrink-0">Número de viagens:</span>
                      <span className="text-[11.5px] font-semibold text-gray-900 dark:text-[#fafafa] truncate">
                        {resultData.totalViagens} {resultData.totalViagens === 1 ? 'viagem' : 'viagens'}
                      </span>
                    </div>
                  </div>

                  {/* Reboque: omitido para simuladores sem trailer */}
                  {resultData.showTrailer !== false && (
                    <div className="flex items-center gap-2">
                      <Truck size={11} className="text-gray-400 dark:text-gray-500 shrink-0" strokeWidth={2.5}/>
                      <div className="flex items-center gap-2 min-w-0 w-full">
                        <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 shrink-0">Reboque:</span>
                        <span className="text-[11.5px] font-semibold text-gray-900 dark:text-[#fafafa] truncate">
                          {resultData.trailerName || "Nenhum"}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Veículo */}
                  <div className="flex items-center gap-2">
                    <Truck size={11} className="text-gray-400 dark:text-gray-500 shrink-0" strokeWidth={2.5}/>
                    <div className="flex items-center gap-2 min-w-0 w-full">
                      <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 shrink-0">Veículo:</span>
                      <span className="text-[11.5px] font-semibold text-gray-900 dark:text-[#fafafa] truncate">
                        {resultData.vehicleName || "Nenhum"}
                      </span>
                    </div>
                  </div>

                  {/* Total de Ganhos */}
                  {resultData.totalGanhos !== undefined && (
                    <div className="flex items-center gap-2">
                      <Banknote size={11} className="text-green-500 dark:text-green-400 shrink-0" strokeWidth={2.5}/>
                      <div className="flex items-center gap-2 min-w-0 w-full">
                        <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 shrink-0">Total de ganhos:</span>
                        <span className="text-[11.5px] font-semibold text-green-600 dark:text-green-400 truncate">
                          {formatCurrency(resultData.totalGanhos)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Prazo total */}
                  <div className="flex items-center gap-2">
                    <CalendarDays size={11} className="text-gray-400 dark:text-gray-500 shrink-0" strokeWidth={2.5}/>
                    <div className="flex items-center gap-2 min-w-0 w-full">
                      <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 shrink-0">Prazo total:</span>
                      <span className="text-[11.5px] font-semibold text-gray-900 dark:text-[#fafafa] truncate">
                        {resultData.prazoTotal}
                      </span>
                    </div>
                  </div>

                  {/* Execução */}
                  <div className="flex items-center gap-2">
                    <Clock size={11} className="text-gray-400 dark:text-gray-500 shrink-0" strokeWidth={2.5}/>
                    <div className="flex items-center gap-2 min-w-0 w-full">
                      <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 shrink-0">Execução:</span>
                      <span className="text-[11.5px] font-semibold text-gray-900 dark:text-[#fafafa] truncate">
                        {resultData.tempoExecucao}
                      </span>
                    </div>
                  </div>

                  {/* Tempo restante / Atraso */}
                  <div className="flex items-center gap-2">
                    <Hourglass size={11} className={cn("shrink-0", resultData.isAtrasado ? "text-red-500 dark:text-red-400" : "text-gray-400 dark:text-gray-500")} strokeWidth={2.5}/>
                    <div className="flex items-center gap-2 min-w-0 w-full">
                      <span className={cn("text-[10px] font-medium shrink-0", resultData.isAtrasado ? "text-red-600/80 dark:text-red-400/80" : "text-gray-500 dark:text-gray-400")}>
                        {resultData.isAtrasado ? 'Atraso:' : 'Tempo restante:'}
                      </span>
                      <span className={cn("text-[11.5px] font-semibold truncate", resultData.isAtrasado ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-[#fafafa]")}>
                        {resultData.tempoRestante}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Result Message */}
                <div className={cn("flex items-center gap-2 rounded-xl px-3 py-2 border", resultData.isAtrasado ? "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20" : "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-100 dark:border-emerald-500/20")}>
                  <div className={cn("shrink-0 w-[17px] h-[17px] rounded-full flex items-center justify-center", resultData.isAtrasado ? "bg-amber-200/50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400" : "bg-emerald-200/50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400")}>
                    {resultData.isAtrasado ? <X size={10} strokeWidth={3} /> : <Check size={10} strokeWidth={3} />}
                  </div>
                  <div className="flex flex-col justify-center">
                    <h4 className={cn("text-[12px] font-semibold mb-0.5 tracking-tight leading-none", resultData.isAtrasado ? "text-amber-800 dark:text-amber-500" : "text-emerald-800 dark:text-emerald-500")}>Resultado da operação</h4>
                    <p className={cn("text-[10px] font-normal leading-tight", resultData.isAtrasado ? "text-amber-700/80 dark:text-amber-400/80" : "text-emerald-700/80 dark:text-emerald-400/80")}>
                      {resultData.isAtrasado 
                        ? "Não foi concluído no prazo estabelecido."
                        : "Dentro do prazo estabelecido."}
                    </p>
                  </div>
                </div>
              </div>

              {/* Bottom Fixed Action */}
              <div className="p-3 border-t border-gray-100 dark:border-gray-800/60 bg-white dark:bg-[#18181b] shrink-0">
                <button
                  onClick={onRequestNewJob}
                  className="w-full bg-[#1f242d] hover:bg-[#2a303c] dark:bg-emerald-500 dark:hover:bg-emerald-600 text-white font-bold py-2.5 rounded-xl shadow-md dark:shadow-[0_4px_14px_rgba(16,185,129,0.3)] hover:shadow-lg dark:hover:shadow-[0_6px_20px_rgba(16,185,129,0.4)] transition-all duration-300 flex items-center justify-center text-[14px]"
                >
                  Solicitar Novo Trabalho
                </button>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
