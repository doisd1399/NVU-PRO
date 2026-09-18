import { Check, Loader2 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import {
  getLatestLiveUpdateStatus,
  LIVE_UPDATE_STATUS_EVENT,
  type LiveUpdateStatusDetail,
  type LiveUpdateStatusPhase,
} from "../../lib/liveUpdateStatus";
const runtimeOtaEnabled =
  String(import.meta.env.VITE_NVU_SELF_HOSTED_OTA_ENABLE || "")
    .trim()
    .toLowerCase() === "true" &&
  String(import.meta.env.VITE_NVU_NATIVE_BUNDLE_IMMUTABLE || "")
    .trim()
    .toLowerCase() !== "true";

const COMPLETED_VISIBLE_MS = 3_600;
const RECOVERABLE_MESSAGE_VISIBLE_MS = 4_500;
const UX_SHOW_DELAY_MS = 350;

const VISIBLE_PHASES: LiveUpdateStatusPhase[] = [
  "downloading",
  "verifying",
  "staged",
  "completed",
  "failed",
  "rolled_back",
];

type VisibleStatus = Exclude<LiveUpdateStatusPhase, "idle" | "available" | "checking">;

const visibleStatus = (
  detail: LiveUpdateStatusDetail | null,
): VisibleStatus | null => {
  if (!runtimeOtaEnabled || !detail || !VISIBLE_PHASES.includes(detail.phase)) return null;
  return detail.phase as VisibleStatus;
};

const isLongRunningPhase = (phase: LiveUpdateStatusPhase) =>
  phase === "downloading" ||
  phase === "verifying" ||
  phase === "staged";

const statusLabel = (status: VisibleStatus) => {
  switch (status) {
    case "downloading":
      return "Atualizando o aplicativo…";
    case "verifying":
      return "Verificando a atualização…";
    case "staged":
      return "Preparando a atualização…";
    case "failed":
      return "Não foi possível concluir a atualização. Continuando normalmente…";
    case "rolled_back":
      return "A atualização foi revertida. Continuando normalmente…";
    case "completed":
      return "Atualização concluída ✓";
  }
};

export default function LiveUpdateStatus() {
  const [status, setStatus] = useState<VisibleStatus | null>(() =>
    runtimeOtaEnabled ? visibleStatus(getLatestLiveUpdateStatus()) : null,
  );
  const statusRef = useRef<VisibleStatus | null>(status);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!runtimeOtaEnabled) return undefined;
    const clearShowTimer = () => {
      if (showTimerRef.current === null) return;
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    };

    const clearHideTimer = () => {
      if (hideTimerRef.current === null) return;
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    };

    const applyVisibleStatus = (nextStatus: VisibleStatus | null) => {
      statusRef.current = nextStatus;
      setStatus(nextStatus);
    };

    const hideAfter = (durationMs: number) => {
      clearHideTimer();
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        applyVisibleStatus(null);
      }, durationMs);
    };

    const applyStatus = (detail: LiveUpdateStatusDetail | null) => {
      const nextStatus = visibleStatus(detail);

      if (detail?.phase === "idle" || detail?.phase === "available" || detail?.phase === "checking") {
        clearShowTimer();
        clearHideTimer();
        if (detail.phase === "idle") applyVisibleStatus(null);
        return;
      }

      if (detail?.phase === "completed") {
        clearShowTimer();
        clearHideTimer();
        applyVisibleStatus("completed");
        hideAfter(COMPLETED_VISIBLE_MS);
        return;
      }

      if (detail?.phase === "failed" || detail?.phase === "rolled_back") {
        clearShowTimer();
        clearHideTimer();
        applyVisibleStatus(nextStatus);
        hideAfter(RECOVERABLE_MESSAGE_VISIBLE_MS);
        return;
      }

      if (!nextStatus || !isLongRunningPhase(detail?.phase || "idle")) return;

      clearHideTimer();
      if (statusRef.current === null && showTimerRef.current === null) {
        showTimerRef.current = window.setTimeout(() => {
          showTimerRef.current = null;
          const latest = visibleStatus(getLatestLiveUpdateStatus());
          if (latest && latest !== "completed") applyVisibleStatus(latest);
        }, UX_SHOW_DELAY_MS);
      }

      if (statusRef.current !== null) applyVisibleStatus(nextStatus);
    };

    const handleStatus = (event: Event) => {
      applyStatus((event as CustomEvent<LiveUpdateStatusDetail>).detail);
    };

    window.addEventListener(LIVE_UPDATE_STATUS_EVENT, handleStatus);
    // The manager starts from requestAnimationFrame. Reapply the module-level
    // status after the listener is attached so a fast cycle cannot be lost.
    applyStatus(getLatestLiveUpdateStatus());

    return () => {
      clearShowTimer();
      clearHideTimer();
      window.removeEventListener(LIVE_UPDATE_STATUS_EVENT, handleStatus);
    };
  }, []);

  if (!status) return null;

  const isCompleted = status === "completed";
  const isRecoverable = status === "failed" || status === "rolled_back";

  return (
    <div
      data-nvu-live-update-status={status}
      className="nvu-live-update-status pointer-events-none fixed left-1/2 z-[2200] flex w-[calc(100%-1.5rem)] max-w-[22rem] -translate-x-1/2 items-center justify-center gap-2 rounded-full border border-slate-200/80 bg-white/95 px-3.5 py-2 text-center text-xs font-medium text-slate-700 shadow-lg shadow-slate-900/10 backdrop-blur-sm dark:border-white/10 dark:bg-slate-900/95 dark:text-slate-100"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {isCompleted ? (
        <Check
          className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
          strokeWidth={2.5}
          aria-hidden="true"
        />
      ) : (
        <Loader2
          className={`h-3.5 w-3.5 shrink-0 animate-spin ${
            isRecoverable
              ? "text-amber-600 dark:text-amber-400"
              : "text-blue-600 dark:text-blue-400"
          }`}
          aria-hidden="true"
        />
      )}
      <span>{statusLabel(status)}</span>
    </div>
  );
}
