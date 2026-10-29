import { useLayoutEffect, useState } from "react";

const DOCK_GAP = 10;

/**
 * Sizes the two-column body of the horizontal "Painel do motorista" so it ends
 * above the fixed dock band while the page is at scroll 0. The height is written
 * to `--ls-body-h` on the grid; it is clamped, and a window too short for the
 * minimum simply scrolls instead of cutting the cards.
 */
export function useLandscapeBodyHeight(enabled: boolean, min = 380, max = 476) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!enabled || !node) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const top = node.getBoundingClientRect().top + window.scrollY;
      const dock = document.querySelector(".nvu-workspace-dock-region");
      const limit = dock ? dock.getBoundingClientRect().top : window.innerHeight;
      const free = Math.floor(limit - DOCK_GAP - top);
      node.style.setProperty("--ls-body-h", `${Math.min(max, Math.max(min, free))}px`);
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
