import { useLayoutEffect, useState } from "react";

/** Page margin kept under the content when the dock is a lateral rail, or above the bottom pill otherwise. */
export const LANDSCAPE_PAGE_BOTTOM = 20;
const DOCK_GAP = 10;

/**
 * Height still free under `target` while the page is at scroll 0: the window height minus the bottom dock band
 * (none while the dock is the lateral rail), the target's top, the content that must stay below it inside its own
 * panel (buttons, notes, paddings) and the page margin.
 */
export function freeHeightBelow(target: HTMLElement): number {
  const rect = target.getBoundingClientRect();
  const panel = target.closest<HTMLElement>("[data-nvu-panel-active]");
  const trailing = panel ? Math.max(0, panel.getBoundingClientRect().bottom - rect.bottom) : 0;
  const dockBand = document.querySelector<HTMLElement>(".nvu-workspace-dock-space")?.getBoundingClientRect().height ?? 0;
  const bottom = dockBand > 0 ? DOCK_GAP : LANDSCAPE_PAGE_BOTTOM;
  return Math.floor(window.innerHeight - dockBand - (rect.top + window.scrollY) - trailing - bottom);
}

/**
 * Sizes the two-column body of the horizontal "Painel do motorista" so it ends above the bottom of the window
 * (or of the bottom dock band) while the page is at scroll 0. The height is written to `--ls-body-h` on the grid;
 * it is clamped, and a window too short for the minimum simply scrolls instead of cutting the cards.
 */
export function useLandscapeBodyHeight(enabled: boolean, min = 372, max = 392) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!enabled || !node) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      node.style.setProperty("--ls-body-h", `${Math.min(max, Math.max(min, freeHeightBelow(node)))}px`);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(apply); };
    apply();
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    if (node.parentElement) observer?.observe(node.parentElement);
    observer?.observe(document.body);
    void document.fonts?.ready.then(schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      observer?.disconnect();
      node.style.removeProperty("--ls-body-h");
    };
  }, [enabled, node, min, max]);
  return setNode;
}
