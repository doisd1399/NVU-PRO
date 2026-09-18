import React, { useLayoutEffect, useState } from "react";
import { cn } from "../../lib/utils";

type OperationProgressBarProps = {
  percent: number;
  replayKey?: string | number;
  minimumVisiblePercent?: number;
  durationMs?: number;
  trackClassName?: string;
  fillClassName?: string;
};

/**
 * Progress bar that always paints from zero before animating to the current
 * operation percentage. `replayKey` should change whenever the owning page or
 * internal view becomes visible again so the reveal animation is replayed.
 */
export function OperationProgressBar({
  percent,
  replayKey = "operation-progress",
  minimumVisiblePercent = 3,
  durationMs = 850,
  trackClassName,
  fillClassName,
}: OperationProgressBarProps) {
  const safePercent = Number.isFinite(percent) ? percent : 0;
  const targetPercent = Math.min(
    100,
    Math.max(minimumVisiblePercent, safePercent),
  );
  const [displayedPercent, setDisplayedPercent] = useState(0);

  useLayoutEffect(() => {
    let firstFrame = 0;
    let secondFrame = 0;

    // Paint one committed frame at zero. A second animation frame is required
    // so Chromium/WebView cannot coalesce the initial and final transforms.
    setDisplayedPercent(0);
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setDisplayedPercent(targetPercent);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [replayKey, targetPercent]);

  return (
    <div
      className={cn(
        "w-full bg-gray-100 dark:bg-[#2A2F3A] rounded-full h-1 overflow-hidden mx-auto max-w-full",
        trackClassName,
      )}
    >
      <div
        className={cn(
          "h-full w-full origin-left rounded-full bg-slate-800 dark:bg-gray-300 [transform:translateZ(0)]",
          fillClassName,
        )}
        style={{
          transform: `scaleX(${displayedPercent / 100}) translateZ(0)`,
          transformOrigin: "left center",
          transitionProperty: "transform",
          transitionDuration: `${durationMs}ms`,
          transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
          willChange: "transform",
        }}
      />
    </div>
  );
}
