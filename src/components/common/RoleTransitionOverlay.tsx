import React, { useEffect, useRef, useState } from "react";
import {
  ROLE_VISUAL_TRANSITION_END,
  ROLE_VISUAL_TRANSITION_START,
  type RoleTransitionTarget,
  type RoleVisualTransitionDetail,
} from "../../lib/roleVisualTransition";

const FADE_OUT_MS = 180;
const SAFETY_TIMEOUT_MS = 1800;
const ROLE_TRANSITION_ROOT_CLASS = "nvu-role-transition-active";

const setBackgroundBrandHidden = (hidden: boolean) => {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(
    ROLE_TRANSITION_ROOT_CLASS,
    hidden,
  );
};

type ActiveTransition = {
  targetRole: RoleTransitionTarget;
  leaving: boolean;
};

export default function RoleTransitionOverlay() {
  const [transition, setTransition] = useState<ActiveTransition | null>(null);
  const frameRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const safetyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const clearScheduledExit = () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (fadeTimerRef.current !== null) {
        window.clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
      if (safetyTimerRef.current !== null) {
        window.clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
    };

    const beginExit = () => {
      clearScheduledExit();
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        setTransition((current) =>
          current ? { ...current, leaving: true } : current,
        );
        fadeTimerRef.current = window.setTimeout(() => {
          fadeTimerRef.current = null;
          setBackgroundBrandHidden(false);
          setTransition(null);
        }, FADE_OUT_MS);
      });
    };

    const handleStart = (event: Event) => {
      clearScheduledExit();
      const detail = (event as CustomEvent<RoleVisualTransitionDetail>).detail;
      const targetRole: RoleTransitionTarget =
        detail?.targetRole === "admin" ? "admin" : "driver";
      setBackgroundBrandHidden(true);
      setTransition({ targetRole, leaving: false });

      // A failed route must never leave an invisible shield blocking the app.
      safetyTimerRef.current = window.setTimeout(
        beginExit,
        SAFETY_TIMEOUT_MS,
      );
    };

    window.addEventListener(ROLE_VISUAL_TRANSITION_START, handleStart);
    window.addEventListener(ROLE_VISUAL_TRANSITION_END, beginExit);
    return () => {
      clearScheduledExit();
      setBackgroundBrandHidden(false);
      window.removeEventListener(ROLE_VISUAL_TRANSITION_START, handleStart);
      window.removeEventListener(ROLE_VISUAL_TRANSITION_END, beginExit);
    };
  }, []);

  if (!transition) return null;

  const targetLabel =
    transition.targetRole === "admin"
      ? "Abrindo perfil da empresa"
      : "Abrindo perfil do motorista";

  return (
    <div
      data-nvu-role-transition={transition.targetRole}
      className={`fixed inset-0 z-[2100] flex items-center justify-center bg-slate-950/25 backdrop-blur-[3px] transition-opacity duration-200 ease-out dark:bg-black/60 ${
        transition.leaving ? "opacity-0" : "opacity-100"
      }`}
      role="status"
      aria-live="polite"
      aria-label={targetLabel}
      style={{ willChange: "opacity" }}
    >
      <div className="flex flex-col items-center gap-2">
        <span className="text-base font-black tracking-[0.24em] text-slate-900 dark:text-white">
          NVU
        </span>
        <span
          className="h-0.5 w-12 overflow-hidden rounded-full bg-slate-900/15 dark:bg-white/15"
          aria-hidden="true"
        >
          <span className="block h-full w-1/2 rounded-full bg-blue-500 motion-safe:animate-[nvu-progress_900ms_ease-in-out_infinite]" />
        </span>
      </div>
    </div>
  );
}
