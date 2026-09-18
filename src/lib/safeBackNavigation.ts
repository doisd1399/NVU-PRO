type ReactRouterHistoryState = {
  usr?: Record<string, unknown> | null;
  key?: string;
  idx?: number;
  [key: string]: unknown;
};

type SafeBackOptions = {
  canGoBack?: boolean;
  exitApp?: () => void;
};

const isDriverRoute = (pathname: string) =>
  pathname === "/driver" || pathname.startsWith("/driver/");

const replaceAppLocation = (pathname: string, userState?: Record<string, unknown>) => {
  if (typeof window === "undefined") return;

  const currentState = (
    window.history.state && typeof window.history.state === "object"
      ? window.history.state
      : {}
  ) as ReactRouterHistoryState;
  const nextState: ReactRouterHistoryState = {
    ...currentState,
    usr: userState ?? null,
  };

  window.history.replaceState(nextState, "", pathname);
  window.dispatchEvent(new PopStateEvent("popstate", { state: nextState }));
};

/**
 * Handles Android/WebView back without treating a missing native WebView entry
 * as permission to close the app. React Router's BrowserRouter can still have
 * an internal entry even when Capacitor reports canGoBack=false.
 */
export function handleSafeAppBack({ canGoBack = false, exitApp }: SafeBackOptions = {}) {
  if (typeof window === "undefined") return;

  const pathname = window.location.pathname;
  const routerIndex = Number(window.history.state?.idx);
  const hasRouterEntry = Number.isFinite(routerIndex) && routerIndex > 0;
  const hasHistoryEntry = window.history.length > 1;

  if (canGoBack || hasRouterEntry || hasHistoryEntry) {
    window.history.back();
    return;
  }

  if (isDriverRoute(pathname)) {
    if (pathname === "/driver/profile") {
      // The operations view is an in-route profile state. A direct entry may
      // have no previous browser entry, so return to the profile dashboard.
      replaceAppLocation("/driver/profile", { profileTab: "dashboard" });
      return;
    }

    // Direct entries such as /driver/history, /driver/reports or /driver/trip
    // must return to the driver's profile instead of closing the APK.
    replaceAppLocation("/driver/profile", { profileTab: "dashboard" });
    return;
  }

  exitApp?.();
}

export function handleSafeRouteBack(
  navigate: (
    to: number | string,
    options?: { state?: Record<string, unknown> },
  ) => void,
  fallbackPath: string,
  fallbackState?: Record<string, unknown>,
) {
  if (typeof window !== "undefined") {
    const routerIndex = Number(window.history.state?.idx);
    if (
      (Number.isFinite(routerIndex) && routerIndex > 0) ||
      window.history.length > 1
    ) {
      navigate(-1);
      return;
    }
  }

  navigate(fallbackPath, fallbackState ? { state: fallbackState } : undefined);
}
