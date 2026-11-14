import { Activity, type ReactNode } from "react";

export function PanelLoading() {
  return (
    <div data-nvu-panel-loading role="status" aria-live="polite"
      className="min-h-[220px] flex items-center justify-center gap-3 text-sm text-slate-500 dark:text-nvu-muted">
      <span className="h-4 w-4 rounded-full border-2 border-slate-300 border-t-blue-500 motion-safe:animate-spin" aria-hidden="true" />
      Abrindo conteúdo…
    </div>
  );
}

/** Retain drafts/filters while pausing hidden effects. The page's established
 * Suspense boundary owns loading, so a new panel cannot flash a fresh fallback. */
export function RetainedPanel({ active, children, className, keepEffects = false }: {
  active: boolean; children: ReactNode; className?: string; keepEffects?: boolean;
}) {
  if (keepEffects) return <div hidden={!active} inert={!active} className={className} data-nvu-panel-active={active ? "true" : "false"}>
    {children}
  </div>;
  return (
    <Activity mode={active ? "visible" : "hidden"}>
      <div className={className} data-nvu-panel-active={active ? "true" : "false"}>
        {children}
      </div>
    </Activity>
  );
}
