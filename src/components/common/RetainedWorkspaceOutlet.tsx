import { Activity, Suspense, useContext, useRef } from "react";
import { UNSAFE_LocationContext, useLocation, useOutlet } from "react-router-dom";
import { PanelLoading } from "./RetainedPanel";

const retainedPaths = new Set(["/admin/fleet", "/admin/history", "/admin/reports", "/admin/news", "/driver/profile", "/driver/history", "/driver/reports", "/driver/news"]);

/** Bound the cache to workspace pages and the current authenticated company.
 * Activity preserves DOM/drafts and hides portals while suspending hidden effects.
 * Each inactive outlet sees its own location, never another page's route state. */
export function RetainedWorkspaceOutlet({ scope }: { scope: string }) {
  const outlet = useOutlet(), location = useLocation();
  const locationContext = useContext(UNSAFE_LocationContext);
  const cache = useRef({ scope, entries: new Map<string, { outlet: typeof outlet; context: typeof locationContext }>() });
  if (cache.current.scope !== scope) cache.current = { scope, entries: new Map() };
  const retained = retainedPaths.has(location.pathname);
  if (retained) cache.current.entries.set(location.pathname, { outlet, context: locationContext });
  return <Suspense fallback={<PanelLoading />}>
    {[...cache.current.entries].map(([path, entry]) => <Activity key={`${scope}:${path}`} mode={path === location.pathname ? "visible" : "hidden"}>
      <UNSAFE_LocationContext.Provider value={path === location.pathname ? locationContext : entry.context}>
        <div data-nvu-retained-route={path}>{entry.outlet}</div>
      </UNSAFE_LocationContext.Provider>
    </Activity>)}
    {!retained && outlet}
  </Suspense>;
}
