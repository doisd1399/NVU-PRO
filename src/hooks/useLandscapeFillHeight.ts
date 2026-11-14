import { useLayoutEffect, type RefObject } from "react";
import { freeHeightBelow } from "./useLandscapeBodyHeight";

/**
 * Lists of the horizontal driver profile (trips, daily results, operation history) scroll inside their own
 * card instead of scrolling the page. The height still free under the visible list is written to
 * `--nvu-fill-h` on the workspace; the stylesheet turns it into the card's max-height. A window too short
 * for `min` falls back to the normal page scroll.
 */
export function useLandscapeFillHeight(
  enabled: boolean,
  root: RefObject<HTMLElement | null>,
  selector: string | null,
  options: { min?: number; alignTo?: string; refresh?: string | number } = {},
) {
  // `refresh` re-measures when a retained page becomes the visible one without any node being added or removed.
  const { min = 240, alignTo, refresh } = options;
  useLayoutEffect(() => {
    const workspace = root.current;
    if (!enabled || !workspace || !selector) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      // The active retained panel first; pages that are not in a RetainedPanel (retained routes) use the visible match.
      const target = workspace.querySelector<HTMLElement>(`[data-nvu-panel-active="true"] ${selector}`)
        ?? Array.from(workspace.querySelectorAll<HTMLElement>(selector)).find(node => node.getClientRects().length > 0) ?? null;
      if (!target) { workspace.style.removeProperty("--nvu-fill-h"); return; }
      // A page keeps room for what follows the list (a notice, a footer) through --nvu-fill-reserve on the list itself.
      const reserve = Number.parseFloat(getComputedStyle(target).getPropertyValue("--nvu-fill-reserve")) || 0;
      let free = freeHeightBelow(target) - reserve;
      // Optionally end on the same line as a neighbouring card (the operation card beside the history).
      const neighbour = alignTo ? workspace.querySelector<HTMLElement>(`[data-nvu-panel-active="true"] ${alignTo}`) : null;
      if (neighbour) free = Math.min(free, Math.floor(neighbour.getBoundingClientRect().bottom - target.getBoundingClientRect().top));
      workspace.style.setProperty("--nvu-fill-h", `${Math.max(min, free)}px`);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(apply); };
    apply();
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    resize?.observe(workspace);
    resize?.observe(document.body);
    // Lists mount after their data arrives; childList changes alone cannot move the list's top edge.
    const mutations = new MutationObserver(schedule);
    mutations.observe(workspace, { childList: true, subtree: true });
    void document.fonts?.ready.then(schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      resize?.disconnect();
      mutations.disconnect();
      workspace.style.removeProperty("--nvu-fill-h");
    };
  }, [enabled, root, selector, min, alignTo, refresh]);
}
