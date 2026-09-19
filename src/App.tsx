import React, { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { Toaster } from "sonner";
import NotificationToastListener from "./components/NotificationToastListener";
import InitialBootOverlay from "./components/common/InitialBootOverlay";
import RoleTransitionOverlay from "./components/common/RoleTransitionOverlay";
import LiveUpdateStatus from "./components/common/LiveUpdateStatus";
import NvuStatusBarController from "./components/common/NvuStatusBarController";
import Login from "./pages/Login";
import SelectProfile from "./pages/SelectProfile";
import PendingApplications from "./pages/PendingApplications";
import { AppProvider, useOperationalStore, useSessionStore } from "./context/AppContext";
import { AuthSessionProvider, useAuthSession } from "./contexts/AuthSessionProvider";
import { MembershipProvider, useMembershipSession } from "./contexts/MembershipProvider";
import { OperationalDataProvider, useOperationalData } from "./contexts/OperationalDataProvider";
import { ProfileSessionProvider, useProfileSession } from "./contexts/ProfileSessionProvider";
import { useCompanyStore } from "./context/CompanyContext";
import { isAuthTeardownActive, onAuthTeardown } from "./lib/authLifecycle";
import { preloadImages } from "./lib/imageCache";
import { resolveProfilePhoto } from "./lib/resolveProfilePhoto";
import { preloadRoleRoutes, preloadRoute } from "./lib/routePreload";
import { membershipHasRole } from "./lib/membershipRoles";
import { writeBatch, doc } from "firebase/firestore";
import { db } from "./lib/firebase";
import { getRuntimePerformanceProfile } from "./lib/runtimePerformance";
import { announceForegroundRoute } from "./lib/foregroundRoute";
import { markSessionBootEvent } from "./lib/sessionBootTelemetry";
import { markProfilePerf } from "./lib/profilePerformanceTelemetry";
import {
  canResumeRoute,
  writeSessionResumeRoute,
} from "./lib/sessionResumeRoute";
import { handleSafeAppBack } from "./lib/safeBackNavigation";
import { cn } from "./lib/utils";

// Placeholders for Pages
const Portal = lazy(() => import("./pages/Portal"));
const NewsFeed = lazy(() => import("./pages/NewsFeed"));
const AdminLayout = lazy(() => import("./layouts/AdminLayout"));
const DriverLayout = lazy(() => import("./layouts/DriverLayout"));

const AdminFleet = lazy(() => import("./pages/admin/Fleet"));
const DriverProfile = lazy(() => import("./pages/driver/Profile"));
const RankingGlobal = lazy(() => import("./pages/RankingGlobal"));
// Keep the trip/ranking engines out of the first JavaScript bundle while still
// requesting this warm-up chunk immediately when the app mounts.
const RankingStartupWarmup = lazy(
  () => import("./components/common/RankingStartupWarmup"),
);
const PublicProfile = lazy(() => import("./pages/PublicProfile"));

const SeniorPanel = lazy(() => import("./pages/admin/SeniorPanel"));
const DriverProfileIsolated = lazy(() => import("./pages/admin/DriverProfileIsolated"));

const RecordTrip = lazy(() => import("./pages/driver/RecordTrip"));
const RecruitmentApply = lazy(() => import("./pages/RecruitmentApply"));
const AuditPage = lazy(() => import("./pages/AuditPage"));
const Diagnostics = lazy(() => import("./pages/Diagnostics"));
const ApplicationStatus = lazy(() => import("./pages/ApplicationStatus"));
const Manual = lazy(() => import("./pages/Manual"));

const TripHistory = lazy(() => import("./pages/driver/TripHistory"));
const JoinCompany = lazy(() => import("./pages/driver/JoinCompany"));


const RegisterCompany = lazy(() => import("./pages/RegisterCompany"));

const AssignJob = lazy(() => import("./pages/admin/AssignJob"));
const AddDriver = lazy(() => import("./pages/admin/AddDriver"));
const ManageContract = lazy(() => import("./pages/admin/ManageContract"));
const ContractDetailsPage = lazy(() => import("./pages/admin/ContractDetailsPage"));
const Reports = lazy(() => import("./pages/admin/Reports"));


const ROUTE_LOADING_ROOT_CLASS = "nvu-route-loading-active";
const ROUTE_LOADING_COUNT_ATTRIBUTE = "data-nvu-route-loading-count";

const updateRouteLoadingRootClass = (delta: 1 | -1) => {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const currentCount = Number(
    root.getAttribute(ROUTE_LOADING_COUNT_ATTRIBUTE) || "0",
  );
  const nextCount = Math.max(0, currentCount + delta);

  if (nextCount > 0) {
    root.setAttribute(ROUTE_LOADING_COUNT_ATTRIBUTE, String(nextCount));
  } else {
    root.removeAttribute(ROUTE_LOADING_COUNT_ATTRIBUTE);
  }
  root.classList.toggle(ROUTE_LOADING_ROOT_CLASS, nextCount > 0);
};

const RouteLoading = ({
  fullPage = false,
  reason = "unknown",
}: {
  fullPage?: boolean;
  reason?: string;
}) => {
  useLayoutEffect(() => {
    markProfilePerf("T8_ROUTE_LOADING_START", { reason });
    updateRouteLoadingRootClass(1);
    return () => {
      markProfilePerf("T8_ROUTE_LOADING_END", { reason });
      updateRouteLoadingRootClass(-1);
    };
  }, [reason]);

  return (
    <div
      data-nvu-route-loading
      className={`${fullPage ? "min-h-screen" : "min-h-[38vh]"} relative flex items-center justify-center bg-gray-50 dark:bg-[#09090b]`}
      role="status"
      aria-live="polite"
    >
      <div
        data-nvu-background-brand
        data-nvu-route-loading-brand
        className="flex flex-col items-center gap-2 opacity-70"
      >
        <span className="text-lg font-bold tracking-[0.22em] text-slate-800 dark:text-white">
          NVU
        </span>
        <span className="h-0.5 w-10 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
          <span className="block h-full w-1/2 rounded-full bg-blue-500 motion-safe:animate-[nvu-progress_900ms_ease-in-out_infinite]" />
        </span>
      </div>
      <span className="sr-only">Abrindo conteúdo</span>
    </div>
  );
};

const LazyRoute = ({
  children,
  fullPage = false,
}: {
  children: React.ReactNode;
  fullPage?: boolean;
}) => (
  <Suspense fallback={<RouteLoading fullPage={fullPage} reason="lazy-chunk-pending" />}>
    {children}
  </Suspense>
);

const routeScrollPositions = new Map<string, number>();

/**
 * Persists the last valid in-app section and restores it only after the current
 * Firebase session and canonical memberships are ready. A direct refresh of a
 * workspace URL is never normalized to `/`; the browser/WebView route is
 * preserved and ProtectedRoute remains the authorization boundary.
 */
const SessionRouteMemory = () => {
  const location = useLocation();
  const { authInitialized, currentUser, sessionUiReady } = useSessionStore();

  useEffect(() => {
    // A direct refresh/deep link keeps its explicit URL. This component only
    // records it after Firebase has identified the same user; it never replaces
    // the route with `/` and never bypasses the explicit profile selector.
    if (!authInitialized || !sessionUiReady || !currentUser?.id) return;
    if (!canResumeRoute(location.pathname)) return;
    writeSessionResumeRoute(
      currentUser.id,
      location.pathname,
      location.search,
    );
  }, [
    authInitialized,
    currentUser?.id,
    location.pathname,
    location.search,
    sessionUiReady,
  ]);

  return null;
};

/** Restores the exact scroll position on browser/Android Back without waiting
 * for data effects. New forward navigations start at the top. */
const RouteScrollMemory = () => {
  const location = useLocation();
  const navigationType = useNavigationType();
  const routeKey = `${location.pathname}${location.search}`;
  const previousRouteKeyRef = useRef(routeKey);

  useEffect(() => {
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previousRestoration;
    };
  }, []);

  useLayoutEffect(() => {
    const isSameRoute = previousRouteKeyRef.current === routeKey;
    const target = isSameRoute
      ? window.scrollY
      : navigationType === "POP"
        ? routeScrollPositions.get(routeKey) ?? 0
        : 0;
    previousRouteKeyRef.current = routeKey;
    // Restore scroll in the same layout commit. Waiting for a frame left the
    // previous page's position visible after Back in mobile WebViews.
    window.scrollTo({ top: target, behavior: "auto" });

    return () => {
      routeScrollPositions.set(routeKey, window.scrollY);
    };
  }, [location.key, navigationType, routeKey]);

  return null;
};

const RouteWarmup = ({ pathname }: { pathname: string }) => {
  const {
    authInitialized,
    sessionUiReady,
    currentUser,
  } = useAuthSession();
  const { activeRole } = useProfileSession();
  const { activeCompanyId, allCompanies, companiesLoading } = useMembershipSession();
  const backgroundLogoSignatureRef = useRef("");
  const holdSpeculativeWarmup =
    pathname === "/login" ||
    pathname === "/select-profile" ||
    pathname === "/pending-applications" ||
    pathname === "/status";

  const activeCompany = useMemo(
    () => allCompanies.find((company) => company.id === activeCompanyId),
    [activeCompanyId, allCompanies],
  );
  const currentUserPhoto = resolveProfilePhoto(currentUser);
  const identityImages = useMemo(
    () =>
      Array.from(
        new Set(
          [
            currentUserPhoto,
            activeCompany?.logoUrl,
            activeCompany?.logoURL,
            (activeCompany as any)?.logo,
          ]
            .map((value) => String(value || "").trim())
            .filter(Boolean),
        ),
      ),
    [
      activeCompany?.logoURL,
      activeCompany?.logoUrl,
      (activeCompany as any)?.logo,
      currentUserPhoto,
    ],
  );
  const identityImageSignature = identityImages.join("|");

  useLayoutEffect(() => {
    if (!authInitialized || !currentUser) return;

    // SelectProfile remains interaction-first: preload only the two primary
    // workspace destinations while the user reads the selector. This moves
    // network/module work before the tap without starting operational listeners
    // or secondary pages, so clicking Admin/Motorista does not reveal a full
    // page Suspense fallback while its shell chunk is fetched.
    void preloadRoute("/select-profile");
    if (pathname === "/select-profile" && currentUser) {
      void preloadRoute("/admin/fleet").catch(() => undefined);
      void preloadRoute("/driver/profile").catch(() => undefined);
    } else if (activeRole && !holdSpeculativeWarmup) {
      void preloadRoute(
        activeRole === "admin" ? "/admin/fleet" : "/driver/profile",
      );
    }
  }, [
    activeRole,
    authInitialized,
    currentUser?.id,
    holdSpeculativeWarmup,
    pathname,
    sessionUiReady,
  ]);

  useEffect(() => {
    if (!authInitialized || !activeRole || companiesLoading) return;

    // The selector/status surfaces must not spend their first interactive
    // frames decoding even "helpful" identity images in the background. The
    // visible StableImage instances load what is actually on screen; every
    // speculative image warm-up resumes after the user enters a workspace.
    if (holdSpeculativeWarmup) return;

    const runtime = getRuntimePerformanceProfile();
    if (identityImages.length > 0) {
      void preloadImages(
        identityImages,
        runtime.mobileViewport ? 1 : 2,
        "high",
      );
    }

    // While the lightweight selector/status screens are active, stop here.
    // Identity images above are part of the visible UI; the remaining catalog
    // logos are speculative and must not compete with taps or panel opening.
    if (runtime.backgroundImageLimit <= 0) return;

    const additionalLogos = Array.from(
      new Set(
        allCompanies
          .flatMap((company: any) => [
            company.logoUrl,
            company.logoURL,
            company.logo,
          ])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    )
      .filter((url) => !identityImages.includes(url))
      .slice(0, runtime.backgroundImageLimit);
    const signature = additionalLogos.join("|");
    if (!signature || backgroundLogoSignatureRef.current === signature) return;
    backgroundLogoSignatureRef.current = signature;

    const warmLogos = () =>
      void preloadImages(
        additionalLogos,
        runtime.backgroundImageConcurrency,
        "low",
      );
    const idleApi = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const timer = window.setTimeout(() => {
      if (idleApi.requestIdleCallback) {
        const idleId = idleApi.requestIdleCallback(warmLogos, {
          timeout: runtime.mobileViewport ? 3200 : 1400,
        });
        backgroundLogoSignatureRef.current = `${signature}#idle:${idleId}`;
        return;
      }
      warmLogos();
    }, runtime.backgroundWarmupDelayMs);

    return () => {
      window.clearTimeout(timer);
      const marker = backgroundLogoSignatureRef.current.match(/#idle:(\d+)$/);
      if (marker) idleApi.cancelIdleCallback?.(Number(marker[1]));
      if (backgroundLogoSignatureRef.current.startsWith(signature)) {
        backgroundLogoSignatureRef.current = signature;
      }
    };
  }, [
    activeRole,
    allCompanies,
    authInitialized,
    companiesLoading,
    identityImageSignature,
    identityImages,
    holdSpeculativeWarmup,
  ]);

  useEffect(() => {
    if (
      !authInitialized ||
      !sessionUiReady ||
      !activeRole ||
      holdSpeculativeWarmup
    ) return;

    void preloadRoute(
      activeRole === "admin" ? "/admin/fleet" : "/driver/profile",
    );

    const runtime = getRuntimePerformanceProfile();
    if (!runtime.allowSecondaryRouteWarmup) return;

    const warmRoutes = () => {
      void preloadRoleRoutes(activeRole);
    };
    const idleApi = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    let idleId: number | null = null;
    const timer = window.setTimeout(() => {
      if (idleApi.requestIdleCallback) {
        idleId = idleApi.requestIdleCallback(warmRoutes, {
          timeout: runtime.mobileViewport ? 4200 : 1800,
        });
        return;
      }
      warmRoutes();
    }, runtime.mobileViewport ? 3200 : 1400);

    return () => {
      window.clearTimeout(timer);
      if (idleId !== null) idleApi.cancelIdleCallback?.(idleId);
    };
  }, [
    authInitialized,
    sessionUiReady,
    activeRole,
    holdSpeculativeWarmup,
  ]);

  return null;
};

/**
 * Ranking data and photo warm-up is intentionally not part of the first
 * authenticated render. It opens several Firestore listeners and decodes
 * many images, so starting it immediately after login makes the first profile
 * feel slower even when the route itself is ready. Once the shell has had an
 * idle window, the existing account-scoped warm-up can proceed normally.
 */
const DeferredRankingWarmup = ({ pathname }: { pathname: string }) => {
  const { authInitialized, sessionReady, currentUser, activeRole } =
    useSessionStore();
  const [enabled, setEnabled] = useState(false);
  const runtime = useMemo(getRuntimePerformanceProfile, []);
  const holdRankingWarmup =
    pathname === "/login" ||
    pathname === "/select-profile" ||
    pathname === "/pending-applications" ||
    pathname === "/status";

  useEffect(() => {
    if (
      !authInitialized ||
      !sessionReady ||
      !currentUser ||
      !activeRole ||
      holdRankingWarmup
    ) {
      setEnabled(false);
      return;
    }

    let cancelled = false;
    const enable = () => {
      if (!cancelled) setEnabled(true);
    };

    // The Android WebView must start the critical ranking warmup immediately.
    // Delaying it by rankingWarmupDelayMs makes the route open on a skeleton
    // even though the authenticated session and shared caches are already
    // available. Speculative background work remains constrained inside the
    // warmup component; only the critical trip/profile listeners start now.
    if (Capacitor.isNativePlatform()) {
      enable();
      return () => {
        cancelled = true;
      };
    }

    const idleApi = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | null = null;
    const timer = window.setTimeout(() => {
      if (runtime.allowRankingWarmup && idleApi.requestIdleCallback) {
        idleId = idleApi.requestIdleCallback(enable, {
          timeout: runtime.mobileViewport ? 5200 : 2600,
        });
      } else {
        enable();
      }
    }, runtime.rankingWarmupDelayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (idleId !== null) idleApi.cancelIdleCallback?.(idleId);
    };
  }, [
    activeRole,
    authInitialized,
    currentUser?.id,
    holdRankingWarmup,
    runtime.allowRankingWarmup,
    runtime.mobileViewport,
    runtime.rankingWarmupDelayMs,
    sessionReady,
  ]);

  if (holdRankingWarmup || !enabled) return null;
  return (
    <Suspense fallback={null}>
      <RankingStartupWarmup />
    </Suspense>
  );
};

const ProtectedRoute = ({
  children,
  allowedRole,
}: {
  children: React.ReactNode;
  allowedRole: "admin" | "driver";
}) => {
  const location = useLocation();
  const {
    currentUser,
    authInitialized,
    sessionUiReady,
    profileIndex,
    activeProfileContext,
    activeRole,
    isSeniorAuthenticated,
    seniorCompanyId,
  } = useSessionStore();
  const { activeCompanyId, memberships, companies } = useCompanyStore();
  const previousSessionUiReadyRef = useRef<boolean | null>(null);

  useLayoutEffect(() => {
    markProfilePerf("T4_PROTECTED_ROUTE_ENTER", {
      route: location.pathname,
      reason: `allowed-role:${allowedRole}`,
    });
  }, [allowedRole, location.pathname]);

  useEffect(() => {
    if (previousSessionUiReadyRef.current === sessionUiReady) return;
    previousSessionUiReadyRef.current = sessionUiReady;
    markProfilePerf(
      sessionUiReady ? "T5_SESSION_UI_READY" : "T5_SESSION_UI_NOT_READY",
      { route: location.pathname },
    );
  }, [location.pathname, sessionUiReady]);

  // A direct refresh must preserve the current URL while Firebase restores
  // Auth. Once Auth is definitively signed out, return to the public Portal;
  // a cached identity never bypasses the strict sessionUiReady boundary.
  if (!authInitialized) {
    return <RouteLoading fullPage reason="auth-not-initialized" />;
  }

  if (!currentUser) return <Navigate to="/" replace />;

  // A cached active membership may paint the shell while the canonical listener reconnects;
  // membership confirmation remains the backend authorization authority. The
  // explicit Profile Index selection is the only visual fast path, while the
  // membership/role checks below remain authoritative for protected access.
  const hasCanonicalSelectedProfile = Boolean(
    currentUser &&
      profileIndex.uid === currentUser.id &&
      profileIndex.status === "ready" &&
      activeProfileContext &&
      activeProfileContext.role === activeRole &&
      activeProfileContext.companyId === activeCompanyId,
  );
  if (!sessionUiReady) {
    if (!hasCanonicalSelectedProfile) {
      return <RouteLoading fullPage reason="session-ui-not-ready" />;
    }
  }
  // The legacy password gate lives inside SeniorPanel. Let the route render
  // its login form before a role is configured; Firestore rules temporarily
  // mirror the old authenticated-only access policy.
  const isSeniorPanelRoute = location.pathname.startsWith("/admin/senior");
  const hasSeniorRole = Boolean(
    (currentUser as any).role === "senior" ||
      (Array.isArray((currentUser as any).roles) &&
        (currentUser as any).roles.includes("senior")),
  );
  const hasVerifiedSeniorSession =
    isSeniorAuthenticated && Boolean(seniorCompanyId);
  // Do not create a global membership-loading gate. Without a safe visible
  // membership there is no workspace to select, so return to the lightweight
  // selector, which owns the local membership-verification state.
  if (
    (!activeCompanyId || !activeRole) &&
    !hasSeniorRole &&
    !isSeniorPanelRoute &&
    !hasVerifiedSeniorSession
  )
    return <Navigate to="/select-profile" replace />;

  const activeMembership = memberships.find(
    (membership) =>
      membership.companyId === activeCompanyId &&
      membership.status === "active",
  );
  const activeCompany = companies.find((company) => company.id === activeCompanyId);
  const isOwner = Boolean(
    activeCompany &&
      (activeCompany.ownerId === currentUser.id ||
        activeCompany.userId === currentUser.id),
  );
  // `isSeniorAuthenticated` is set only after Firebase custom-claim
  // validation in the shared session boundary. The company id binds that
  // verified session to the selected Senior workspace; sessionStorage alone
  // never satisfies this guard.
  let hasRoleForCompany = false;

  if (allowedRole === "admin") {
    hasRoleForCompany = Boolean(
      hasSeniorRole ||
        hasVerifiedSeniorSession ||
        isSeniorPanelRoute ||
        membershipHasRole(activeMembership, "admin") ||
        isOwner,
    );
  } else if (allowedRole === "driver") {
    hasRoleForCompany = Boolean(
      membershipHasRole(activeMembership, "driver"),
    );
  }

  if (!hasRoleForCompany) {
    return <Navigate to="/select-profile" replace />;
  }

  if (!hasSeniorRole && !hasVerifiedSeniorSession && !isSeniorPanelRoute && activeRole && activeRole !== allowedRole) {
    return (
      <Navigate to={activeRole === "admin" ? "/admin" : "/driver"} replace />
    );
  }

  return <>{children}</>;
};

function RankingShellRoute() {
  const { currentUser } = useSessionStore();
  const { activeRole } = useProfileSession();

  if (!currentUser?.id) return <Navigate to="/login" replace />;
  if (activeRole !== "admin" && activeRole !== "driver") {
    return <Navigate to="/select-profile" replace />;
  }

  const ranking = <RankingGlobal />;
  return activeRole === "admin"
    ? <LazyRoute fullPage><AdminLayout>{ranking}</AdminLayout></LazyRoute>
    : <LazyRoute fullPage><DriverLayout>{ranking}</DriverLayout></LazyRoute>;
}

function AppRouteContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, profileIndex } = useSessionStore();
  const { activeRole } = useProfileSession();
  const isOnboardingSurface =
    location.pathname === "/select-profile" ||
    location.pathname === "/status" ||
    location.pathname === "/pending-applications" ||
    location.pathname === "/register-company" ||
    location.pathname === "/apply" ||
    location.pathname.startsWith("/apply/");

  useEffect(() => {
    // A previous APK could leave the native projection service alive while a
    // user enters the public recruitment flow. Never request or preserve screen
    // sharing on onboarding surfaces; operational routes remain untouched.
    const shouldCleanResidualProjection =
      isOnboardingSurface &&
      (location.pathname !== "/select-profile" ||
        profileIndex.status !== "ready" ||
        profileIndex.profiles.length === 0);
    if (!shouldCleanResidualProjection || !Capacitor.isNativePlatform()) return;

    let cancelled = false;
    void import("./lib/gtoObserver").then(async ({ GtoObserver, isGtoObserverAvailable }) => {
      if (cancelled || !isGtoObserverAvailable()) return;
      try {
        await GtoObserver.logoutCleanup();
      } catch (cleanupError) {
        // APKs predating logoutCleanup still expose stopObserver. This fallback
        // is deliberately limited to onboarding and remains best-effort.
        try {
          await GtoObserver.stopObserver();
        } catch (fallbackError) {
          console.info("[NVU Onboarding] Projeção residual não estava disponível.", {
            cleanupError,
            fallbackError,
          });
        }
      }
    }).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    isOnboardingSurface,
    location.key,
    location.pathname,
    profileIndex.profiles.length,
    profileIndex.status,
  ]);
  const initialSessionSelectorRedirectRef = useRef(false);
  const backgroundLocation = (
    location.state as { backgroundLocation?: typeof location } | null
  )?.backgroundLocation;

  // AppProvider intentionally lives outside BrowserRouter. Mirror only the
  // foreground pathname to it so expensive account-scoped realtime work can
  // be paused while interaction-first screens (notably Select Profile) are
  // visible. useLayoutEffect publishes before the next paint on route changes.
  useLayoutEffect(() => {
    announceForegroundRoute(location.pathname);
    markSessionBootEvent(
      "FIRST_RENDER",
      {
        uidPresent: Boolean(currentUser?.id),
        role: activeRole,
        routePresent: Boolean(location.pathname),
      },
      "FIRST_RENDER",
    );
  }, [activeRole, currentUser?.id, location.pathname]);

  useLayoutEffect(() => {
    if (initialSessionSelectorRedirectRef.current) return;
    if (!currentUser?.id) return;

    const navigationState = location.state as
      | { nvuExplicitProfileSelection?: boolean }
      | null;
    if (
      location.pathname === "/select-profile" &&
      navigationState?.nvuExplicitProfileSelection
    ) {
      initialSessionSelectorRedirectRef.current = true;
      return;
    }
    // This resolver is only for an authenticated boot already occurring on a
    // session-entry route. Public recruitment/cadastro routes must remain the
    // current intent after Google Auth so their own handler can open step 2.
    if (
      location.pathname !== "/" &&
      location.pathname !== "/login" &&
      location.pathname !== "/select-profile"
    ) {
      return;
    }
    if (profileIndex.status === "resolving") return;

    initialSessionSelectorRedirectRef.current = true;
    const targetPath =
      profileIndex.status === "ready" && profileIndex.profiles.length === 1
        ? profileIndex.profiles[0].destination
        : "/select-profile";
    void preloadRoute(targetPath).catch(() => undefined);
    navigate(targetPath, {
      replace: true,
      state: {
        nvuNativeSessionResume: true,
        profileIndexStatus: profileIndex.status,
      },
    });
    markSessionBootEvent(
      "ROUTE_RESTORED",
      {
        uidPresent: true,
        role: profileIndex.profiles[0]?.role || activeRole,
        companyPresent: Boolean(profileIndex.profiles[0]?.companyId),
        routePresent: Boolean(targetPath),
      },
      "ROUTE_RESTORED",
    );
  }, [
    activeRole,
    currentUser?.id,
    location.pathname,
    location.state,
    navigate,
    profileIndex,
  ]);

  return (
    <>
      <NvuStatusBarController />
      <SessionRouteMemory />
      <RouteWarmup pathname={location.pathname} />
      <DeferredRankingWarmup pathname={location.pathname} />
      <NotificationToastListener />
      <RoleTransitionOverlay />
      <RouteScrollMemory />
      <Routes location={backgroundLocation ?? location}>
        {/* Public Routes */}
        <Route path="/" element={<LazyRoute fullPage><Portal /></LazyRoute>} />
        <Route path="/login" element={<LazyRoute fullPage><Login /></LazyRoute>} />
        <Route path="/select-profile" element={<LazyRoute fullPage><SelectProfile /></LazyRoute>} />
        <Route path="/apply" element={<LazyRoute fullPage><RecruitmentApply /></LazyRoute>} />
        <Route path="/apply/:companyId" element={<LazyRoute fullPage><RecruitmentApply /></LazyRoute>} />
        <Route path="/register-company" element={<LazyRoute fullPage><RegisterCompany /></LazyRoute>} />
        <Route path="/status" element={<LazyRoute fullPage><ApplicationStatus /></LazyRoute>} />
        <Route path="/diagnostics" element={<LazyRoute fullPage><Diagnostics /></LazyRoute>} />
        <Route path="/pending-applications" element={<LazyRoute fullPage><PendingApplications /></LazyRoute>} />
        <Route path="/audit" element={<LazyRoute fullPage><AuditPage /></LazyRoute>} />
        <Route path="/public/company/:companyId" element={<LazyRoute fullPage><PublicProfile /></LazyRoute>} />
        <Route path="/public/driver/:driverId" element={<LazyRoute fullPage><PublicProfile /></LazyRoute>} />

        {/* Admin Routes */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRole="admin">
              <LazyRoute fullPage><AdminLayout /></LazyRoute>
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="fleet" replace />} />
          <Route path="fleet" element={<LazyRoute><AdminFleet /></LazyRoute>} />
          <Route path="operations" element={<Navigate to="fleet" replace />} />
          <Route path="assign" element={<LazyRoute><AssignJob /></LazyRoute>} />
          <Route path="add-driver" element={<LazyRoute><AddDriver /></LazyRoute>} />
          <Route path="contract/new" element={<LazyRoute><ManageContract /></LazyRoute>} />
          <Route path="contract/:id" element={<LazyRoute><ContractDetailsPage /></LazyRoute>} />
          <Route path="contract/:id/edit" element={<LazyRoute><ManageContract /></LazyRoute>} />
          <Route path="senior" element={<LazyRoute><SeniorPanel /></LazyRoute>} />
          <Route path="reports" element={<LazyRoute><Reports /></LazyRoute>} />
          <Route path="history" element={<LazyRoute><TripHistory /></LazyRoute>} />
          <Route path="news" element={<LazyRoute><NewsFeed /></LazyRoute>} />
          <Route path="manual" element={<LazyRoute><Manual /></LazyRoute>} />
          <Route path="driver/:id" element={<LazyRoute><DriverProfileIsolated /></LazyRoute>} />
        </Route>

        {/* Driver Routes */}
        <Route path="/ranking" element={<RankingShellRoute />} />
        <Route
          path="/driver"
          element={
            <ProtectedRoute allowedRole="driver">
              <LazyRoute fullPage><DriverLayout /></LazyRoute>
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="profile" replace />} />
          <Route path="profile" element={<LazyRoute><DriverProfile /></LazyRoute>} />
          <Route path="join" element={<LazyRoute><JoinCompany /></LazyRoute>} />
          <Route path="trip" element={<LazyRoute><RecordTrip /></LazyRoute>} />
          <Route path="history" element={<LazyRoute><TripHistory /></LazyRoute>} />
          <Route path="news" element={<LazyRoute><NewsFeed /></LazyRoute>} />
          <Route path="reports" element={<LazyRoute><Reports /></LazyRoute>} />
          <Route path="manual" element={<LazyRoute><Manual /></LazyRoute>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {backgroundLocation && (
        <Routes>
          <Route
            path="/ranking"
            element={
              <Suspense fallback={null}>
                <div className={cn(
                  "nvu-ranking-overlay fixed inset-0 z-[2000] overflow-y-auto overscroll-contain bg-gray-50 dark:bg-[#09090b]",
                  Capacitor.isNativePlatform() && "nvu-native-android",
                )}>
                  <RankingGlobal />
                </div>
              </Suspense>
            }
          />
        </Routes>
      )}
    </>
  );
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <AppRouteContent />
    </BrowserRouter>
  );
}

const LegacyMigration = () => {
  const { jobs, contracts } = useOperationalData();

  useEffect(() => {
    if (jobs.length === 0 || contracts.length === 0) return;
    
    // Usando uma nova chave para garantir a execução
    if (localStorage.getItem("legacy_migration_v2_done")) return;

    let cancelled = false;
    const removeTeardownListener = onAuthTeardown(() => {
      cancelled = true;
    });

    const runMigration = async () => {
      try {
        if (cancelled || isAuthTeardownActive()) return;
        const batch = writeBatch(db);
        let updates = 0;

        const startDate = new Date("2026-06-01T00:00:00-03:00");
        const endDate = new Date("2026-06-12T23:59:59-03:00");

        console.log("=== RELATÓRIO DE MIGRAÇÃO DE CONTRATOS LEGADOS ===");
        let totalAnalyzed = 0;
        let metCriteria = 0;
        let actuallyUpdated = 0;

        for (const job of jobs) {
          if (cancelled || isAuthTeardownActive()) return;
          totalAnalyzed++;
          
          if (job.status !== "completed") {
            continue;
          }

          const contract = contracts.find((c) => c.id === job.contractId);
          if (!contract) {
             continue;
          }

          const TARGET_CONTRACT_IDS = ["id_do_contrato_bs10", "id_do_contrato_bs20"];
          const isTargetContract = TARGET_CONTRACT_IDS.includes(contract.id);

          if (!isTargetContract) {
            continue;
          }

          const hasNewTemporalFields = !!job.completedAt || !!job.assignedAt || !!job.dueAt;
          
          const dateStr = job.createdAt || job.deadlineDate || "";
          const jobDate = dateStr ? new Date(dateStr) : null;
          let isWithinDateRange = false;
          if (jobDate && !isNaN(jobDate.getTime())) {
             isWithinDateRange = jobDate >= startDate && jobDate <= endDate;
          }

          if (isTargetContract && !hasNewTemporalFields && isWithinDateRange) {
              metCriteria++;
              
              if (job.completionStatus !== "on_time") {
                console.log(`[Job ${job.id}] Elegível. Alterando para 'on_time'. (Contrato ID: ${contract.id}, Data: ${dateStr})`);
                const ref = doc(db, "trabalhos", job.id);
                batch.update(ref, { completionStatus: "on_time" });
                updates++;
                actuallyUpdated++;
              } else {
                console.log(`[Job ${job.id}] Elegível, mas já testava como 'on_time'.`);
              }
          } else {
             console.log(`[Job ${job.id}] Contrato ${contract.id} ignorado. Motivos: 
               - Campos novos detectados: ${hasNewTemporalFields}
               - Pertence ao intervalo (01 a 12 Jun): ${isWithinDateRange} (${jobDate})`);
          }
        }

        console.log(`- Contratos analisados (total de trabalhos): ${totalAnalyzed}`);
        console.log(`- Contratos que atenderam aos critérios (elegíveis): ${metCriteria}`);
        console.log(`- Contratos efetivamente atualizados para 'on_time': ${actuallyUpdated}`);
        console.log("==================================================");

        if (updates > 0) {
          if (cancelled || isAuthTeardownActive()) return;
          await batch.commit();
          console.log(`[Legacy Migration] Lote com ${updates} contratos concluído com sucesso.`);
        }
        if (!cancelled && !isAuthTeardownActive()) {
          localStorage.setItem("legacy_migration_v2_done", "true");
        }
      } catch (e) {
        if (!cancelled && !isAuthTeardownActive()) {
          console.warn("Migration error:", e);
        }
      }
    };

    void runMigration();
    return () => {
      cancelled = true;
      removeTeardownListener();
    };
  }, [jobs, contracts]);

  return null;
};

const ContractSnapshotMigration = () => {
  const { jobs, contracts } = useOperationalData();

  useEffect(() => {
    if (jobs.length === 0 || contracts.length === 0) return;

    if (localStorage.getItem("contract_snapshot_migration_v1_done")) return;

    let cancelled = false;
    const removeTeardownListener = onAuthTeardown(() => {
      cancelled = true;
    });

    const runMigration = async () => {
      try {
        if (cancelled || isAuthTeardownActive()) return;
        const batch = writeBatch(db);
        let updates = 0;

        console.log("=== INICIANDO MIGRAÇÃO DE CONTRATOS (SNAPSHOTS) ===");

        for (const job of jobs) {
          if (cancelled || isAuthTeardownActive()) return;
          if (job.status !== "completed") continue;
          if (job.contractNameSnapshot) continue; // Already migrated

          const contract = contracts.find((c) => c.id === job.contractId);
          const finalName = contract?.name || (contract as any)?.nome || (job as any).contractName || (job as any).nomeContrato || "Contrato não identificado";
          const ref = doc(db, "trabalhos", job.id);
          batch.update(ref, { contractNameSnapshot: finalName });
          updates++;
          console.log(`[Snapshot Migration] Atualizando job ${job.id} com contrato: ${finalName}`);
        }

        if (updates > 0) {
          if (cancelled || isAuthTeardownActive()) return;
          await batch.commit();
          console.log(`[Snapshot Migration] ${updates} jobs atualizados.`);
        } else {
          console.log(`[Snapshot Migration] Nenhum job precisava ser atualizado.`);
        }

        if (!cancelled && !isAuthTeardownActive()) {
          localStorage.setItem("contract_snapshot_migration_v1_done", "true");
        }
      } catch (e) {
        if (!cancelled && !isAuthTeardownActive()) {
          console.warn("[Snapshot Migration] Erro:", e);
        }
      }
    };

    void runMigration();
    return () => {
      cancelled = true;
      removeTeardownListener();
    };
  }, [jobs, contracts]);

  return null;
};

const CLIENT_MIGRATIONS_ENABLED =
  String(import.meta.env.VITE_ENABLE_CLIENT_MIGRATIONS).toLowerCase() === "true";

export default function App() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let disposed = false;
    let backButtonListener: { remove: () => Promise<void> } | null = null;
    let appStateListener: { remove: () => Promise<void> } | null = null;

    void import("@capacitor/app")
      .then(async ({ App: CapacitorApp }) => {
        if (disposed) return;

        let inactiveAt: number | null = null;
        [backButtonListener, appStateListener] = await Promise.all([
          CapacitorApp.addListener("backButton", ({ canGoBack }) => {
            handleSafeAppBack({
              canGoBack,
              exitApp: () => void CapacitorApp.exitApp(),
            });
          }),
          CapacitorApp.addListener("appStateChange", ({ isActive }) => {
            if (!isActive) {
              inactiveAt = Date.now();
              return;
            }

            const wasInactiveForMs = inactiveAt ? Date.now() - inactiveAt : 0;
            inactiveAt = null;
            // A long Android activity pause is an auth recovery event. Keep the
            // existing threshold so short focus changes remain lightweight.
            if (wasInactiveForMs >= 12_000) {
              window.dispatchEvent(new Event("nvu-session-refresh"));
            }
          }),
        ]);

        if (disposed) {
          void backButtonListener?.remove();
          void appStateListener?.remove();
        }
      })
      .catch((error) => {
        console.warn("[NVU Native] Capacitor App listeners unavailable:", error);
      });

    return () => {
      disposed = true;
      void backButtonListener?.remove();
      void appStateListener?.remove();
    };
  }, []);

  return (
    <AppProvider>
      <AuthSessionProvider>
        <MembershipProvider>
          <ProfileSessionProvider>
            <OperationalDataProvider>
              <InitialBootOverlay />
              {CLIENT_MIGRATIONS_ENABLED && (
                <>
                  <ContractSnapshotMigration />
                  <LegacyMigration />
                </>
              )}
              <Toaster position="top-right" richColors />
              <LiveUpdateStatus />
              <AppRoutes />
            </OperationalDataProvider>
          </ProfileSessionProvider>
        </MembershipProvider>
      </AuthSessionProvider>
    </AppProvider>
  );
}
