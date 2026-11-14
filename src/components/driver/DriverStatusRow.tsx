import { cn } from "../../lib/utils";

/** One availability control for both the current operation and the idle panel. */
export function DriverStatusRow({ online, suspended, onChange }: {
  online: boolean;
  suspended: boolean;
  onChange: (online: boolean) => void;
}) {
  return <div className="nvu-driver-status-row">
    <span aria-hidden="true" className={cn("nvu-driver-status-dot h-2.5 w-2.5 rounded-full shrink-0", online ? "bg-[#0cb49f]" : "bg-gray-300 dark:bg-nvu-line")} />
    <span className="nvu-driver-status-label">Status</span>
    <span className="nvu-driver-status-value">{suspended ? "Suspenso" : online ? "Disponível" : "Indisponível"}</span>
    <label className={cn("relative inline-flex items-center shrink-0", suspended ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
      <input type="checkbox" aria-label="Disponível para fretes" className="sr-only peer" checked={online}
        disabled={suspended} onChange={event => onChange(event.target.checked)} />
      <div className="nvu-driver-status-switch w-11 h-6 bg-gray-200 dark:bg-nvu-strip rounded-full peer peer-focus:outline-none peer-checked:after:translate-x-5 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white dark:after:bg-gray-300 after:border-gray-200 dark:after:border-transparent after:border after:rounded-full after:h-5 after:w-5 after:transition-all shadow-inner dark:shadow-none" />
    </label>
  </div>;
}
