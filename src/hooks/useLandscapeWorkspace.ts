import { useSyncExternalStore } from "react";

/**
 * Horizontal workspace layouts apply to landscape viewports wide enough for two
 * columns. Portrait, and very small landscape windows, keep the vertical layout.
 * The same expression is mirrored by the stylesheet only through the
 * `nvu-landscape-dashboard` class that this query drives.
 */
export const LANDSCAPE_WORKSPACE_QUERY = "(orientation: landscape) and (min-width: 720px)";

export function readLandscapeWorkspace(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(LANDSCAPE_WORKSPACE_QUERY).matches;
  } catch {
    return false;
  }
}

function subscribeLandscapeWorkspace(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  let query: MediaQueryList;
  try {
    query = window.matchMedia(LANDSCAPE_WORKSPACE_QUERY);
  } catch {
    return () => undefined;
  }
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }
  query.addListener(onChange);
  return () => query.removeListener(onChange);
}

/** True while the viewport is landscape and at least 720px wide. */
export function useLandscapeWorkspace(): boolean {
  return useSyncExternalStore(subscribeLandscapeWorkspace, readLandscapeWorkspace, () => false);
}
