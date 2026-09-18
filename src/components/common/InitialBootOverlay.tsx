import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSessionStore } from "../../context/AppContext";
import {
  isInteractionFirstRoute,
  NVU_FOREGROUND_ROUTE_EVENT,
} from "../../lib/foregroundRoute";
import { preloadRoute } from "../../lib/routePreload";

const INITIAL_BOOT_ROOT_CLASS = "nvu-initial-boot-active";
const INITIAL_BUSY_LAYER_SELECTOR =
  "[data-nvu-route-loading], [data-nvu-role-transition]";
const STABLE_FRAMES_REQUIRED = 2;

const shouldCoverInitialPath = (pathname: string) =>
  /^\/(?:admin|driver)(?:\/|$)/.test(pathname) ||
  /^\/ranking\/?$/.test(pathname);

const readInitialPathname = () =>
  typeof window === "undefined" ? "/" : window.location.pathname;

/**
 * Owns the visual identity for the complete first workspace boot.
 *
 * Session hydration, a protected-route gate and a lazy page can finish in
 * separate React commits. Keeping this one overlay mounted across those
 * commits prevents each stage from painting its own NVU and restarting the
 * progress animation.
 */
export default function InitialBootOverlay() {
  const { currentUser, sessionUiReady } = useSessionStore();
  const initialPathRef = useRef(readInitialPathname());
  const [visible, setVisible] = useState(() =>
    shouldCoverInitialPath(initialPathRef.current),
  );
  const [foregroundPathname, setForegroundPathname] = useState(
    initialPathRef.current,
  );
  const frameRef = useRef<number | null>(null);
  const stableFramesRef = useRef(0);

  useLayoutEffect(() => {
    if (!visible || typeof document === "undefined") return;

    document.documentElement.classList.add(INITIAL_BOOT_ROOT_CLASS);

    // Start the deep-link chunk before Firebase finishes restoring the
    // session. The overlay still waits for the actual route DOM to become
    // stable, so a failed best-effort preload cannot reveal an empty frame.
    void preloadRoute(initialPathRef.current).catch(() => {
      // The route's normal lazy boundary and deploy recovery own retry/error
      // handling. Preloading must never block session restoration.
    });

    return () => {
      document.documentElement.classList.remove(INITIAL_BOOT_ROOT_CLASS);
    };
  }, [visible]);

  useLayoutEffect(() => {
    const handleForegroundRoute = (event: Event) => {
      const pathname = String(
        (event as CustomEvent<string>).detail || window.location.pathname || "/",
      );
      setForegroundPathname(pathname);
      if (isInteractionFirstRoute(pathname)) setVisible(false);
    };

    window.addEventListener(NVU_FOREGROUND_ROUTE_EVENT, handleForegroundRoute);
    return () => {
      window.removeEventListener(
        NVU_FOREGROUND_ROUTE_EVENT,
        handleForegroundRoute,
      );
    };
  }, []);

  useEffect(() => {
    // Membership authorization can continue in the background; the global
    // visual boot may close as soon as the UID-scoped identity is available.
    // Protected actions remain behind sessionReady in their own route/action gates.
    const bootReady = Boolean(currentUser?.id) || sessionUiReady;
    if (!visible || !bootReady) return;

    let disposed = false;
    const observeStableDestination = () => {
      if (disposed) return;

      const hasPendingVisualLayer = Boolean(
        document.querySelector(INITIAL_BUSY_LAYER_SELECTOR),
      );
      stableFramesRef.current = hasPendingVisualLayer
        ? 0
        : stableFramesRef.current + 1;

      // Ranking analytics and photos have their own loading state. They must
      // never hold the global boot cover after the route has a stable shell.
      if (stableFramesRef.current >= STABLE_FRAMES_REQUIRED) {
        frameRef.current = null;
        setVisible(false);
        return;
      }

      frameRef.current = window.requestAnimationFrame(
        observeStableDestination,
      );
    };

    frameRef.current = window.requestAnimationFrame(observeStableDestination);

    return () => {
      disposed = true;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [currentUser?.id, sessionUiReady, visible]);

  if (!visible || isInteractionFirstRoute(foregroundPathname)) return null;

  return (
    <div
      data-nvu-initial-boot
      className="pointer-events-none fixed inset-0 z-[2300] flex items-center justify-center bg-gray-50 dark:bg-[#09090b]"
      role="status"
      aria-live="polite"
      aria-label="Abrindo o NVU"
    >
      <div
        data-nvu-initial-boot-brand
        className="flex flex-col items-center gap-2 opacity-70"
      >
        <span className="text-lg font-bold tracking-[0.22em] text-slate-800 dark:text-white">
          NVU
        </span>
        <span
          className="h-0.5 w-10 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10"
          aria-hidden="true"
        >
          <span className="block h-full w-1/2 rounded-full bg-blue-500 motion-safe:animate-[nvu-progress_900ms_ease-in-out_infinite]" />
        </span>
      </div>
    </div>
  );
}
