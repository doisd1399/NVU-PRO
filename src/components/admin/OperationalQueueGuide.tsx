import React from "react";
import { ChevronDown, CircleHelp } from "lucide-react";

export function OperationalQueueGuide() {
  return (
    <details className="group rounded-xl border border-slate-200 bg-slate-50/70 text-slate-900 dark:border-nvu-line dark:bg-nvu-page dark:text-nvu-text">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-3 text-xs font-medium [&::-webkit-details-marker]:hidden">
        <CircleHelp size={16} className="shrink-0 text-slate-500 dark:text-nvu-muted" aria-hidden="true" />
        <span className="flex-1">Como funciona o envio automático?</span>
        <ChevronDown size={15} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-3 border-t border-slate-200 px-3 pb-3 pt-3 text-xs leading-relaxed text-slate-600 dark:border-nvu-line dark:text-nvu-text-soft">
        <ol className="space-y-3">
          {[
            ["Crie as operações", "Em Criar operação, cadastre as rotas, as viagens e o prazo."],
            ["Organize em pastas", "Reúna as operações de uma sequência na mesma pasta. Cada pasta pode ter uma fila."],
            ["Ative a fila", "Em Nova fila, escolha a pasta e os motoristas, ajuste a ordem e ative. Libere os veículos na aba Veículos."],
          ].map(([title, description], index) => (
            <li key={title} className="flex items-start gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white font-semibold tabular-nums text-slate-700 dark:border-nvu-line dark:bg-nvu-surface dark:text-nvu-text" aria-hidden="true">{index + 1}</span>
              <div><p className="font-semibold text-slate-900 dark:text-nvu-text">{title}</p><p className="mt-0.5">{description}</p></div>
            </li>
          ))}
        </ol>
        <p className="rounded-lg bg-white p-3 dark:bg-nvu-surface">
          <strong className="font-semibold text-slate-900 dark:text-nvu-text">O NVU cuida da sequência.</strong>{" "}
          Após finalizar uma operação, o motorista recebe a próxima disponível, escolhe o veículo e confirma o início. Cada motorista tem seu próprio progresso.
        </p>
        <p>A primeira fila ativa com operações disponíveis tem prioridade. Novas operações adicionadas à pasta entram no final da fila.</p>
        <p>Acompanhe cada motorista na aba <strong className="font-medium">Progresso</strong>. Uma operação em andamento continua mesmo se a fila for pausada ou removida.</p>
      </div>
    </details>
  );
}
