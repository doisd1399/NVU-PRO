import React from "react";
import { Clock3, ShieldAlert } from "lucide-react";
import {
  formatSuspensionEnd,
  formatSuspensionRemaining,
} from "../lib/driverSuspension";
import { useOperationalSuspension } from "../hooks/useOperationalSuspension";
import { cn } from "../lib/utils";

export function OperationalSuspensionNotice({
  user,
  sticky = true,
  className,
}: {
  user: Record<string, any> | null | undefined;
  sticky?: boolean;
  className?: string;
}) {
  const { suspension, nowMs } = useOperationalSuspension(user);

  if (!suspension.active) return null;

  return (
    <section
      role="alert"
      aria-live="polite"
      className={cn(
        "w-full rounded-2xl border border-red-200 bg-red-50 p-4 text-red-950 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100",
        sticky && "sticky top-2 z-30 shadow-sm",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300">
          <ShieldAlert size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-bold">Atividades operacionais suspensas</h2>
              <p className="mt-1 text-xs leading-relaxed text-red-800 dark:text-red-200/90">
                Durante a suspensão não é possível solicitar trabalhos nem lançar viagens.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 rounded-xl border border-red-200 bg-white/70 px-3 py-2 dark:border-red-500/30 dark:bg-black/10">
              <Clock3 size={15} />
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wider opacity-70">Tempo restante</p>
                <p className="font-mono text-sm font-black tabular-nums">
                  {formatSuspensionRemaining(suspension.endsAt, nowMs)}
                </p>
              </div>
            </div>
          </div>

          {suspension.reasons.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {suspension.reasons.map((reason) => (
                <span
                  key={reason}
                  className="rounded-full border border-red-200 bg-white/70 px-2.5 py-1 text-[10px] font-semibold dark:border-red-500/30 dark:bg-black/10"
                >
                  {reason}
                </span>
              ))}
            </div>
          )}

          {suspension.message && (
            <div className="mt-3 rounded-xl border border-red-200/80 bg-white/70 px-3 py-2.5 text-xs leading-relaxed dark:border-red-500/30 dark:bg-black/10">
              {suspension.message}
            </div>
          )}

          <p className="mt-3 text-[10px] font-medium text-red-700 dark:text-red-300">
            Liberação automática em {formatSuspensionEnd(suspension.endsAt)}.
          </p>
        </div>
      </div>
    </section>
  );
}
