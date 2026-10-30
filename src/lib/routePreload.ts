import { getRuntimePerformanceProfile } from "./runtimePerformance";
import { Capacitor } from "@capacitor/core";

import { markProfilePerf } from "./profilePerformanceTelemetry";

type Loader = () => Promise<unknown>;

const routeLoaders: Record<string, Loader[]> = {
  // These two critical destinations are imported eagerly by App.tsx. Keeping
  // them in the registry as resolved routes lets callers use the same API
  // without creating redundant dynamic-import work during a click.
  "/login": [],
  "/select-profile": [],
  "/apply": [() => import("../pages/RecruitmentApply")],
  "/register-company": [() => import("../pages/RegisterCompany")],
  "/status": [() => import("../pages/ApplicationStatus")],
  "/pending-applications": [],
  "/audit": [() => import("../pages/AuditPage")],
  "/admin": [
    () => import("../layouts/AdminLayout"),
    () => import("../pages/admin/Fleet"),
    () => import("../pages/admin/fleet/OperationsTab"),
  ],
  "/admin/fleet": [
    // The layout is a separate lazy boundary in App.tsx. Warm it together
    // with the fleet page so selecting the company profile never has to fetch
    // the shell after the route has already changed.
    () => import("../layouts/AdminLayout"),
    () => import("../pages/admin/Fleet"),
    () => import("../pages/admin/fleet/OperationsTab"),
  ],
  "/admin/history": [() => import("../pages/driver/TripHistory")],
  "/admin/reports": [() => import("../pages/admin/Reports")],
  "/admin/news": [() => import("../pages/NewsFeed")],
  "/admin/manual": [() => import("../pages/Manual")],
  "/admin/senior": [() => import("../pages/admin/SeniorPanel")],
  "/admin/assign": [() => import("../pages/admin/AssignJob")],
  "/admin/add-driver": [() => import("../pages/admin/AddDriver")],
  "/driver": [
    () => import("../layouts/DriverLayout"),
    () => import("../pages/driver/Profile"),
  ],
  "/driver/profile": [
    // Keep the driver shell and its first page in the same warm-up lane. The
    // previous registry warmed only Profile, leaving DriverLayout to load on
    // the click from SelectProfile.
    () => import("../layouts/DriverLayout"),
    () => import("../pages/driver/Profile"),
  ],
  "/driver/trip": [() => import("../pages/driver/RecordTrip")],
  "/driver/history": [() => import("../pages/driver/TripHistory")],
  "/driver/reports": [() => import("../pages/admin/Reports")],
  "/driver/news": [() => import("../pages/NewsFeed")],
  "/driver/manual": [() => import("../pages/Manual")],
  "/driver/join": [() => import("../pages/driver/JoinCompany")],
  "/ranking": [() => import("../pages/RankingGlobal")],
};

const fleetPanelLoaders: Record<string, Loader> = {
  operations: () => import("../pages/admin/fleet/OperationsTab"),
  company: () => import("../pages/admin/fleet/CompanyTab"),
  hr: () => import("../pages/admin/fleet/RecruitmentTab"),
  history: () => import("../pages/driver/TripHistory"),
  drivers: () => import("../pages/admin/fleet/DriversTab"),
  contracts: () => import("../pages/admin/fleet/ContractsTab"),
  vehicles: () => import("../pages/admin/fleet/VehiclesTab"),
  trailers: () => import("../pages/admin/fleet/TrailersTab"),
};

// Cache by destination rather than by function identity. This also deduplicates
// fleet panel loaders, which used to be recreated on every pointer event.
const preparedDestinations = new Map<string, Promise<void>>();

const normalizePath = (path: string) => {
  const pathname = path.split("?")[0].split("#")[0];
  if (pathname === "/admin") return "/admin";
  if (pathname === "/driver") return "/driver";
  return pathname.replace(/\/$/, "") || "/";
};

const prepareDestination = (key: string, loaders: Loader[]): Promise<void> => {
  const existing = preparedDestinations.get(key);
  if (existing) {
    markProfilePerf("PRELOAD_CACHE_HIT", {
      route: key,
      cacheHit: true,
      preloaded: true,
    });
    markProfilePerf("CHUNK_CACHE_HIT", {
      route: key,
      cacheHit: true,
    });
    return existing;
  }
  if (loaders.length === 0) {
    markProfilePerf("PRELOAD_SUCCESS", {
      route: key,
      cacheHit: true,
      preloaded: true,
    });
    return Promise.resolve();
  }

  markProfilePerf("PRELOAD_START", { route: key, preloaded: false });
  markProfilePerf("T9_CHUNK_START", { route: key, preloaded: false });
  const promise = Promise.all(loaders.map((loader) => loader()))
    .then(() => {
      markProfilePerf("T10_CHUNK_END", { route: key, preloaded: true });
      markProfilePerf("PRELOAD_END", { route: key, preloaded: true });
      markProfilePerf("PRELOAD_SUCCESS", { route: key, preloaded: true });
      return undefined;
    })
    .catch((error) => {
      // Keep transient chunk/network failures retryable.
      markProfilePerf("T10_CHUNK_END", {
        route: key,
        preloaded: false,
        reason: "preload-failed",
      });
      markProfilePerf("PRELOAD_END", {
        route: key,
        preloaded: false,
        reason: "preload-failed",
      });
      markProfilePerf("PRELOAD_FAILED", {
        route: key,
        preloaded: false,
        reason: "preload-failed",
      });
      preparedDestinations.delete(key);
      throw error;
    });
  preparedDestinations.set(key, promise);
  return promise;
};

export function preloadRoute(path: string): Promise<void> {
  const normalized = normalizePath(path);

  let dynamicKey = normalized;
  let dynamicLoaders: Loader[] = [];

  if (normalized.startsWith("/apply/")) {
    dynamicKey = "/apply/:companyId";
    dynamicLoaders = [() => import("../pages/RecruitmentApply")];
  } else if (/^\/admin\/driver\/[^/]+\/perfil$/.test(normalized)) {
    dynamicKey = "/admin/driver/:id/perfil";
    dynamicLoaders = [() => import("../pages/admin/DriverProfileReference")];
  } else if (normalized.startsWith("/admin/driver/")) {
    dynamicKey = "/admin/driver/:id";
    dynamicLoaders = [() => import("../pages/admin/DriverProfileIsolated")];
  } else if (normalized === "/admin/contract/new") {
    dynamicKey = "/admin/contract/new";
    dynamicLoaders = [() => import("../pages/admin/ManageContract")];
  } else if (/^\/admin\/contract\/[^/]+\/edit$/.test(normalized)) {
    dynamicKey = "/admin/contract/:id/edit";
    dynamicLoaders = [() => import("../pages/admin/ManageContract")];
  } else if (/^\/admin\/contract\/[^/]+$/.test(normalized)) {
    dynamicKey = "/admin/contract/:id";
    dynamicLoaders = [() => import("../pages/admin/ContractDetailsPage")];
  }

  const loaders = routeLoaders[normalized] ?? dynamicLoaders;
  return prepareDestination(`route:${dynamicKey}`, loaders);
}

export function preloadFleetPanel(panel: string): Promise<void> {
  const loader = fleetPanelLoaders[panel];
  return loader
    ? prepareDestination(`fleet:${panel}`, [loader])
    : Promise.resolve();
}

export function preloadRoleRoutes(role: "admin" | "driver"): Promise<void> {
  const runtime = getRuntimePerformanceProfile();
  const localBundle = Capacitor.isNativePlatform();
  if (!runtime.allowSecondaryRouteWarmup && !localBundle) return Promise.resolve();

  const desktopPaths =
    role === "admin"
      ? [
          "/admin/fleet",
          "/admin/history",
          "/admin/reports",
          "/ranking",
          "/admin/news",
          "/admin/assign",
        ]
      : [
          "/driver/profile",
          "/ranking",
          "/driver/news",
          "/driver/trip",
        ];

  // Native assets are local. Warm only the current role's dock destinations,
  // one module per idle slice, without mounting pages or fetching their data.
  // Mobile web keeps the smaller speculative network budget.
  const paths = localBundle ? desktopPaths : runtime.mobileViewport
    ? desktopPaths.filter((path) => path.includes("ranking") || path.includes("news"))
    : desktopPaths;
  const workerCount = localBundle || runtime.mobileViewport ? 1 : 2;

  let cursor = 0;
  const worker = async () => {
    while (cursor < paths.length) {
      const path = paths[cursor++];
      if (localBundle && typeof window !== "undefined") await new Promise<void>(resolve => {
        if ("requestIdleCallback" in window) window.requestIdleCallback(() => resolve(), { timeout: 4000 });
        else setTimeout(resolve, 50);
      });
      try {
        await preloadRoute(path);
      } catch {
        // Preloading is best-effort; click navigation can retry.
      }
    }
  };

  return Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  ).then(() => undefined);
}
