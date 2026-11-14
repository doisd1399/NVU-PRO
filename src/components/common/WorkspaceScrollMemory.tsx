import { useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { workspacePageIdentity } from "../../lib/workspacePageIdentity";

/** Keep the last visible offset before a shorter destination can clamp it. */
export function WorkspaceScrollMemory({ scope }: { scope: string }) {
  const location = useLocation();
  const positions = useRef(new Map<string, number>());
  const previousScope = useRef(scope);
  if (previousScope.current !== scope) { positions.current.clear(); previousScope.current = scope; }
  const key = `${scope}:${workspacePageIdentity(location.pathname, location.search, location.state)}`;
  const previousKey = useRef(key);
  useLayoutEffect(() => {
    const original = history.scrollRestoration;
    history.scrollRestoration = "manual";
    return () => { history.scrollRestoration = original; };
  }, []);
  useLayoutEffect(() => {
    const target = previousKey.current === key ? window.scrollY : positions.current.get(key) || 0;
    previousKey.current = key;
    window.scrollTo({ top: target, behavior: "auto" });
    let visibleOffset = window.scrollY;
    const record = () => { visibleOffset = window.scrollY; };
    window.addEventListener("scroll", record, { passive: true });
    return () => {
      window.removeEventListener("scroll", record);
      positions.current.delete(key); positions.current.set(key, visibleOffset);
      if (positions.current.size > 64) positions.current.delete(positions.current.keys().next().value);
    };
  }, [key, location.key]);
  return null;
}
