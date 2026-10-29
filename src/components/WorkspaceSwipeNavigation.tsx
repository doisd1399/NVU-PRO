import { useEffect, useRef } from "react";
import { useWorkspaceNavigation } from "../hooks/useWorkspaceNavigation";

const pages = ["dashboard", "activity", "results", "news", "ranking", "profile"];
export function WorkspaceSwipeNavigation() {
  const navigation = useWorkspaceNavigation();
  const latest = useRef(navigation); latest.current = navigation;
  useEffect(() => {
    let start: { x: number; y: number; at: number } | null = null;
    let recognized = false, suppressUntil = 0;
    const reset = () => { start = null; recognized = false; };
    const hasDialog = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"]')).some(node => node.getClientRects().length > 0);
    const ignore = (node: EventTarget | null) => {
      if (!(node instanceof Element)) return true;
      if (node.closest('input,textarea,select,[contenteditable="true"],[role="slider"],[data-nvu-swipe-ignore],.nvu-driver-dock')) return true;
      for (let parent: Element | null = node; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (/auto|scroll/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth + 4) return true;
      }
      return false;
    };
    const onStart = (event: TouchEvent) => {
      reset();
      if (!latest.current.currentUser || !latest.current.active || event.touches.length !== 1 || hasDialog() || ignore(event.target)) return;
      const touch = event.touches[0];
      // Leave Android/browser edge gestures to the system.
      if (touch.clientX < 20 || touch.clientX > window.innerWidth - 20) return;
      start = { x: touch.clientX, y: touch.clientY, at: performance.now() };
    };
    const onMove = (event: TouchEvent) => {
      if (!start || event.touches.length !== 1) { reset(); return; }
      const dx = event.touches[0].clientX - start.x, dy = event.touches[0].clientY - start.y;
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { reset(); return; }
      if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        recognized = true;
        if (event.cancelable) event.preventDefault();
      }
    };
    const onEnd = (event: TouchEvent) => {
      if (!start || !event.changedTouches.length) { reset(); return; }
      const dx = event.changedTouches[0].clientX - start.x, dy = event.changedTouches[0].clientY - start.y;
      const duration = performance.now() - start.at;
      const fast = Math.abs(dx) >= 32 && Math.abs(dx) / Math.max(1, duration) >= .45;
      if (recognized && duration <= 750 && (Math.abs(dx) >= 52 || fast) && Math.abs(dx) > Math.abs(dy) * 1.4 && !hasDialog()) {
        const index = pages.indexOf(latest.current.active || "");
        const next = pages[index + (dx < 0 ? 1 : -1)];
        if (index >= 0 && next) { suppressUntil = performance.now() + 350; latest.current.select(next); }
      }
      reset();
    };
    const onClick = (event: MouseEvent) => { if (performance.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", reset, { passive: true });
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("touchstart", onStart); document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd); document.removeEventListener("touchcancel", reset); document.removeEventListener("click", onClick, true);
    };
  }, []);
  return null;
}
