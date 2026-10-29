import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, Clock, Hourglass, CalendarDays, Truck, X, Package, Banknote, Activity, Building2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { HistoryMoneySummary } from './common/HistoryMoneySummary';
import type { HistoryMoneyGroup } from '../lib/tripMoneySummary';
import { registerOptionModal } from '../lib/optionModalStack';

export interface OperationResultData {
  contractName: string;
  tempoExecucao: string;
  tempoRestante: string;
  isAtrasado: boolean;
  prazoTotal: string;
  totalViagens: number;
  vehicleName?: string;
  companyName?: string;
  prazoLimite?: string;
  trailerName?: string;
  showTrailer?: boolean;
  /** Legacy field remains accepted for old navigation payloads, but is not formatted without a currency. */
  totalGanhos?: number;
  moneyGroups?: HistoryMoneyGroup[];
  hasDeadline?: boolean;
}

interface OperationResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRequestNewJob?: () => void;
  resultData: OperationResultData | null;
  status?: 'completed' | 'in_progress';
  id?: string;
}

export function OperationResultModal({
  isOpen,
  onClose,
  onRequestNewJob,
  resultData,
  status = 'completed',
  id,
}: OperationResultModalProps) {
  const isInProgress = status === 'in_progress';
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isVisible = isOpen && Boolean(resultData);

  useEffect(() => {
    if (!isVisible) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const modal = registerOptionModal(() => onCloseRef.current());
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!modal.isTop()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, summary, [tabindex="0"]',
      ) || []).filter((element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      modal.dispose();
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isVisible]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && resultData && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[11000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 pointer-events-auto"
            onClick={onClose}
          >
            <motion.div
              ref={dialogRef}
              id={id}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-nvu-surface w-full max-w-[500px] max-h-[85dvh] sm:max-h-[90dvh] rounded-2xl shadow-2xl overflow-hidden flex flex-col relative"
              onClick={e => e.stopPropagation()}
            >
              <button 
                ref={closeRef}
                type="button"
                aria-label={isInProgress ? 'Fechar resumo da operação' : 'Fechar resultado da operação'}
                onClick={onClose}
                className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-nvu-text-soft transition-colors z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/50 dark:bg-black/20 hover:bg-white dark:hover:bg-black/40 backdrop-blur-sm"
              >
                <X size={18} />
              </button>

              <div className="flex-1 overflow-y-auto overflow-x-hidden p-4">
                {/* Header */}
                <div className="flex flex-col items-center mb-4">
                  <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-500/20 rounded-full flex items-center justify-center shadow-sm mb-2">
                    {isInProgress
                      ? <Truck size={20} className="text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
                      : <Check size={20} className="text-emerald-600 dark:text-emerald-400" strokeWidth={3} />}
                  </div>
                  <h2 id={titleId} className="text-[18px] font-black text-gray-900 dark:text-nvu-text mb-1 tracking-tight text-center leading-tight px-5">{isInProgress ? 'Operação em andamento' : 'Operação finalizada!'}</h2>
                  <p id={descriptionId} className="text-gray-500 dark:text-nvu-muted text-[12px] text-center font-medium">{isInProgress ? 'Acompanhe os dados da operação atual.' : 'Inicie uma nova operação para continuar.'}</p>
                </div>

                {/* Contract Info */}
                <div className="flex items-center justify-between bg-gray-50 dark:bg-white/5 rounded-xl px-2.5 py-2 mb-3 border border-gray-100 dark:border-white/5">
                  <h3 className="text-[14px] font-bold text-gray-900 dark:text-nvu-text tracking-tight truncate mr-2">{resultData.contractName}</h3>
                  <span className="shrink-0 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold tracking-wider rounded-md uppercase flex items-center justify-center">{isInProgress ? 'Em andamento' : 'Finalizada'}</span>
                </div>

                {/* Compact paired trip-and-earnings summary */}
                {!isInProgress && <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="min-w-0 rounded-xl border border-gray-100 dark:border-nvu-line/60 bg-gray-50 dark:bg-nvu-strip p-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-nvu-muted">
                      <Package size={12} className="text-teal-600 dark:text-teal-400" aria-hidden="true" />
                      Viagens
                    </div>
                    <p className="mt-1.5 text-sm font-bold text-gray-900 dark:text-nvu-text">
                      {resultData.totalViagens}
                    </p>
                  </div>
                  <div className="min-w-0 rounded-xl border border-gray-100 dark:border-nvu-line/60 bg-gray-50 dark:bg-nvu-strip p-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-nvu-muted">
                      <Banknote size={12} className="text-teal-600 dark:text-teal-400" aria-hidden="true" />
                      Ganhos
                    </div>
                    <div className="mt-1.5 text-sm font-bold text-gray-900 dark:text-nvu-text break-words">
                      <HistoryMoneySummary
                        groups={resultData.moneyGroups || []}
                        totalEligibleTrips={resultData.totalViagens}
                      />
                    </div>
                  </div>
                </div>}

                {/* Statistics List */}
                <div className={cn("bg-gray-50 dark:bg-nvu-strip rounded-xl border border-gray-100 dark:border-nvu-line/60 mb-3", isInProgress ? "p-3 space-y-3 [&_svg]:h-3.5 [&_svg]:w-3.5 [&_span]:text-[12px] [&_span.font-semibold]:text-[13px]" : "p-2.5 space-y-2")}>
                  {isInProgress && (
                    <div className="flex items-start gap-2">
                      <Building2 size={14} className="mt-0.5 text-gray-400 dark:text-nvu-muted shrink-0" aria-hidden="true" />
                      <span className="text-gray-500 dark:text-nvu-muted font-medium shrink-0">Empresa:</span>
                      <span className="min-w-0 break-words font-semibold text-gray-900 dark:text-nvu-text">{resultData.companyName || 'Empresa não informada'}</span>
                    </div>
                  )}
                  {isInProgress && (
                    <div className="flex items-center gap-2">
                      <Package size={14} className="text-gray-400 dark:text-nvu-muted shrink-0" />
                      <span className="text-gray-500 dark:text-nvu-muted font-medium">Número de viagens:</span>
                      <span className="font-semibold text-gray-900 dark:text-nvu-text">{resultData.totalViagens} {resultData.totalViagens === 1 ? 'viagem' : 'viagens'}</span>
                    </div>
                  )}
                  {/* Reboque: omitido para simuladores sem trailer */}
                  {resultData.showTrailer !== false && (
                    <div className="flex items-center gap-2">
                      <Truck size={11} className="text-gray-400 dark:text-nvu-muted shrink-0" strokeWidth={2.5}/>
                      <div className="flex items-center gap-2 min-w-0 w-full">
                        <span className="text-[10px] font-medium text-gray-500 dark:text-nvu-muted shrink-0">Reboque:</span>
                        <span className={cn("text-[11.5px] font-semibold text-gray-900 dark:text-nvu-text", isInProgress ? "break-words min-w-0" : "truncate")}>
                          {resultData.trailerName || "Nenhum"}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Veículo */}
                  <div className="flex items-center gap-2">
                    <Truck size={11} className="text-gray-400 dark:text-nvu-muted shrink-0" strokeWidth={2.5}/>
                    <div className="flex items-center gap-2 min-w-0 w-full">
                      <span className="text-[10px] font-medium text-gray-500 dark:text-nvu-muted shrink-0">Veículo:</span>
                      <span className={cn("text-[11.5px] font-semibold text-gray-900 dark:text-nvu-text", isInProgress ? "break-words min-w-0" : "truncate")}>
                        {resultData.vehicleName || "Nenhum"}
                      </span>
                    </div>
                  </div>

                  {isInProgress && (
                    <div className="flex items-start gap-2">
                      <Banknote size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      <span className="text-gray-500 dark:text-nvu-muted font-medium shrink-0">Total de ganhos:</span>
                      <div className="min-w-0 text-[13px]">
                        <HistoryMoneySummary groups={resultData.moneyGroups || []} totalEligibleTrips={resultData.totalViagens} />
                      </div>
                    </div>
                  )}

                  {/* Prazo total */}
                  {isInProgress && (
                    <div className="flex items-start gap-2">
                      <CalendarDays size={14} className="mt-0.5 text-gray-400 dark:text-nvu-muted shrink-0" aria-hidden="true" />
                      <span className="text-gray-500 dark:text-nvu-muted font-medium shrink-0">Prazo limite:</span>
                      <span className="min-w-0 break-words font-semibold text-gray-900 dark:text-nvu-text">{resultData.prazoLimite || 'Não definido'}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <CalendarDays size={11} className="text-gray-400 dark:text-nvu-muted shrink-0" strokeWidth={2.5}/>
                    <div className="flex items-center gap-2 min-w-0 w-full">
                      <span className="text-[10px] font-medium text-gray-500 dark:text-nvu-muted shrink-0">Prazo total:</span>
                      <span className={cn("text-[11.5px] font-semibold text-gray-900 dark:text-nvu-text", isInProgress ? "break-words min-w-0" : "truncate")}>
                        {resultData.prazoTotal}
                      </span>
                    </div>
                  </div>

                  {/* Execução */}
                  <div className="flex items-center gap-2">
                    <Clock size={11} className="text-gray-400 dark:text-nvu-muted shrink-0" strokeWidth={2.5}/>
                    <div className="flex items-center gap-2 min-w-0 w-full">
                      <span className="text-[10px] font-medium text-gray-500 dark:text-nvu-muted shrink-0">Execução:</span>
                      <span className="text-[11.5px] font-semibold text-gray-900 dark:text-nvu-text truncate">
                        {resultData.tempoExecucao}
                      </span>
                    </div>
                  </div>

                  {/* Tempo restante / Atraso */}
                  <div className="flex items-center gap-2">
                    <Hourglass size={11} className={cn("shrink-0", resultData.isAtrasado ? "text-red-500 dark:text-red-400" : "text-gray-400 dark:text-nvu-muted")} strokeWidth={2.5}/>
                    <div className="flex items-center gap-2 min-w-0 w-full">
                      <span className={cn("text-[10px] font-medium shrink-0", resultData.isAtrasado ? "text-red-600/80 dark:text-red-400/80" : "text-gray-500 dark:text-nvu-muted")}>
                        {resultData.isAtrasado ? 'Atraso:' : 'Tempo restante:'}
                      </span>
                      <span className={cn("text-[11.5px] font-semibold truncate", resultData.isAtrasado ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-nvu-text")}>
                        {resultData.tempoRestante}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Result Message */}
                <div className={cn("flex items-center gap-2 rounded-xl px-3 py-2 border", resultData.isAtrasado ? "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20" : "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-100 dark:border-emerald-500/20")}>
                  <div className={cn("shrink-0 w-[17px] h-[17px] rounded-full flex items-center justify-center", resultData.isAtrasado ? "bg-amber-200/50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400" : "bg-emerald-200/50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400")}>
                    {isInProgress ? <Activity size={10} strokeWidth={2.5} /> : resultData.isAtrasado ? <X size={10} strokeWidth={3} /> : <Check size={10} strokeWidth={3} />}
                  </div>
                  <div className="flex flex-col justify-center">
                    <h4 className={cn("text-[12px] font-semibold mb-0.5 tracking-tight leading-none", resultData.isAtrasado ? "text-amber-800 dark:text-amber-500" : "text-emerald-800 dark:text-emerald-500")}>{isInProgress ? 'Status da operação' : 'Resultado da operação'}</h4>
                    <p className={cn("text-[10px] font-normal leading-tight", resultData.isAtrasado ? "text-amber-700/80 dark:text-amber-400/80" : "text-emerald-700/80 dark:text-emerald-400/80")}>
                      {isInProgress
                        ? resultData.hasDeadline === false
                          ? 'Operação em andamento, sem prazo definido.'
                          : resultData.isAtrasado
                            ? 'Prazo excedido. A operação continua em andamento.'
                            : 'Operação em andamento, dentro do prazo estabelecido.'
                        : resultData.isAtrasado
                          ? 'Não foi concluído no prazo estabelecido.'
                          : 'Dentro do prazo estabelecido.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Bottom Fixed Action */}
              {!isInProgress && onRequestNewJob && <div className="p-3 border-t border-gray-100 dark:border-nvu-line/60 bg-white dark:bg-nvu-surface shrink-0">
                <button
                  onClick={onRequestNewJob}
                  className="w-full bg-[#1f242d] hover:bg-[#2a303c] dark:bg-emerald-500 dark:hover:bg-emerald-600 text-white font-bold py-2.5 rounded-xl shadow-md dark:shadow-[0_4px_14px_rgba(16,185,129,0.3)] hover:shadow-lg dark:hover:shadow-[0_6px_20px_rgba(16,185,129,0.4)] transition-all duration-300 flex items-center justify-center text-[14px]"
                >
                  Solicitar Novo Trabalho
                </button>
              </div>}
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
