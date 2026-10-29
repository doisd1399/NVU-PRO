import { useLayoutEffect, useRef, useState } from "react";

/** Animate only the header's CSS property; scrolling must not rerender a whole workspace. */
export function useProfileChrome(enabled: boolean) {
  const headerRef = useRef<HTMLElement>(null);
  const [settled, setSettled] = useState(false);
  const settledRef = useRef(false);
  useLayoutEffect(() => {
    if (!enabled) {
      if (settledRef.current) { settledRef.current = false; setSettled(false); }
      return;
    }
    let frame = 0;
    let previous = -1;
    const update = () => {
      frame = 0;
      const hero = Array.from(document.querySelectorAll<HTMLElement>(".nvu-profile-hero, .nvu-cover-hero")).find(node => node.getClientRects().length > 0);
      if (!hero || !headerRef.current) return;
      const progress = Math.max(0, Math.min(1, (168 - hero.getBoundingClientRect().bottom) / 120));
      if (Math.abs(progress - previous) < .015) return;
      previous = progress;
      headerRef.current.style.setProperty("--nvu-chrome-progress", String(progress));
      const next = progress >= .55;
      headerRef.current.dataset.nvuHeroChrome = next ? "settled" : "active";
      if (settledRef.current !== next) { settledRef.current = next; setSettled(next); }
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
      headerRef.current?.style.removeProperty("--nvu-chrome-progress");
    };
  }, [enabled]);
  return { headerRef, heroChromeActive: enabled && !settled };
}
