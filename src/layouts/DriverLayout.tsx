import { RetainedWorkspaceOutlet } from "../components/common/RetainedWorkspaceOutlet";
import { NvuWordmark } from "../components/common/NvuWordmark";
import { resolveNewsSessionSimulator } from "../lib/newsSimulator";
import { resolveDriverPhoto } from '../lib/resolveDriverPhoto';
import React, { useState } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  useOperationalStore,
  useSessionStore,
} from "../context/AppContext";
import { useNotificationStore } from "../context/NotificationsContext";
import { useCompanyStore } from "../context/CompanyContext";
import {
  Package,
  LogOut,
  User as UserIcon,
  Settings,
  Bell,
  Pencil,
  Moon,
  Sun,
  Building2,
  ChevronLeft,
  Check,
  ClipboardList,
} from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { WorkspaceProfileCover } from "../components/common/WorkspaceProfileCover";
import { isProfileCoverPage } from "../lib/profileCover";
import { useLandscapeWorkspace } from "../hooks/useLandscapeWorkspace";
import { useProfileChrome } from "../hooks/useProfileChrome";
import { isNativeAndroid } from "../lib/gtoObserver";
import { isMobileWebAndroidLike } from "../lib/mobileWebRuntime";
import { cn } from "../lib/utils";
import {
  deriveCurrentOperationProgress,
  selectCanonicalOperationTrips,
  selectCurrentOperationJob,
} from "../lib/currentOperation";
import { useDriverTrips } from "../hooks/useDriverTrips";
import { OperationRecoveryContext, useMissingOperationTrip } from "../hooks/useMissingOperationTrip";
import { SimpleAutomationCompletionBridge } from "../components/SimpleAutomationCompletionBridge";
import { auth } from "../lib/firebase";
import { CompactProfileEditorModal } from "../components/CompactProfileEditorModal";
import { StableImage } from "../components/common/StableImage";
import { NotificationCenter } from "../components/NotificationCenter";
import { DRIVER_MENU_ITEMS } from "../components/workspaceMenuItems";
import { GlobalMenu } from "../components/GlobalMenu";
import { WorkspaceDock } from "../components/WorkspaceDock";
import { preloadRoute } from "../lib/routePreload";
import {
  commitRoleVisualTransition,
  finishRoleVisualTransition,
} from "../lib/roleVisualTransition";
import {
  prepareAndCommitNavigation,
  isPlainPrimaryNavigation,
} from "../lib/navigationTransition";
import { membershipHasRole, resolveMembershipRoles } from "../lib/membershipRoles";
import {
  beginRankingWarmupSession,
  waitForRankingWarmup,
  warmRegisteredRankingPhotos,
} from "../lib/rankingPhotoWarmup";

export default function DriverLayout() {
  const { currentUser, switchRole, activeRole, logOutApp } = useSessionStore();
  const { companies, activeCompanyId, setActiveCompanyId, memberships } = useCompanyStore();
  const { notifications, markNotificationAsRead } = useNotificationStore();
  const { jobs, contracts, vehicles, trailers, simulators } = useOperationalStore();
  const driverTripState = useDriverTrips(currentUser?.id ?? null);
  const navigate = useNavigate();
  const location = useLocation();
  const isNewsRoute = location.pathname.includes("/driver/news");
  const landscapeWorkspace = useLandscapeWorkspace();
  const isCoverTabRoute = isProfileCoverPage(location.pathname, location.state);
  // Horizontal "Painel do motorista": the work tab shares the solid header and
  // cover of the other profile tabs. Portrait keeps the photo hero.
  const isLandscapeDashboard = landscapeWorkspace && location.pathname === "/driver/profile" && !isCoverTabRoute;
  // Every tab of the driver profile gets the denser horizontal spacing; portrait is untouched.
  const isLandscapeProfile = landscapeWorkspace && location.pathname === "/driver/profile";
  const isCoverPage = isCoverTabRoute || isLandscapeDashboard;
  const isDriverHeroRoute = location.pathname.startsWith("/driver/profile") && !isCoverPage;
  const isLegacyCoverPage = isCoverPage && location.pathname !== "/driver/profile";
  // Match the APK shell on mobile browsers without pretending that browser
  // APIs can provide native Android permissions or plugins.
  const nativeAndroid = isNativeAndroid() || isMobileWebAndroidLike();
  const { theme, toggleTheme } = useTheme();
  const [isProfileMenuOpen, setIsProfileMenuOpen] = React.useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isHeaderEditRevealed, setIsHeaderEditRevealed] = React.useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = React.useState(false);
  const [showCompanySwitch, setShowCompanySwitch] = React.useState(false);
  const { headerRef, heroChromeActive } = useProfileChrome(isDriverHeroRoute);

  const warmRankingAssets = React.useCallback(() => {
    beginRankingWarmupSession(currentUser?.id || "");
    return Promise.all([
      warmRegisteredRankingPhotos(12),
      waitForRankingWarmup(currentUser?.id),
    ]).then(() => undefined);
  }, [currentUser?.id]);

  const warmNewsFeed = React.useCallback(() => {
    const selected = resolveNewsSessionSimulator({ activeCompanyId, currentUser, companies, simulators });
    return import("../pages/NewsFeed").then(({ warmNvuNewsFirstPage }) => warmNvuNewsFirstPage({
      userId: currentUser?.id,
      simulatorValues: [selected.key, ...selected.aliases],
    })).catch((error) => {
      console.warn("[NVU NEWS] Pré-carregamento da página indisponível:", error);
    });
  }, [activeCompanyId, companies, currentUser, simulators]);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      finishRoleVisualTransition();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);



  React.useEffect(() => {
    const handleOpenShellMenu = () => setIsMobileMenuOpen(true);
    window.addEventListener("nvu-open-shell-menu", handleOpenShellMenu);
    return () => window.removeEventListener("nvu-open-shell-menu", handleOpenShellMenu);
  }, []);

  const currentActiveCompany = React.useMemo(() => {
    return activeCompanyId
      ? companies.find((c) => c.id === activeCompanyId)
      : null;
  }, [companies, activeCompanyId]);

  // Keep completion polling at the authenticated shell level. The Pro flow can
  // be launched from Profile and the route may change while Android captures;
  // mounting the bridge only inside Dashboard made CAPTURE_CAPTURED wait for
  // that subtree to be mounted again.
  const driverOperation = React.useMemo(
    () => selectCurrentOperationJob(jobs, currentUser?.id, activeCompanyId),
    [activeCompanyId, currentUser?.id, jobs],
  );
  const driverOperationProgress = React.useMemo(
    () => deriveCurrentOperationProgress(driverOperation, driverTripState.trips, currentUser?.id),
    [currentUser?.id, driverOperation, driverTripState.trips],
  );
  const driverOperationTrips = React.useMemo(
    () => driverOperation ? selectCanonicalOperationTrips(driverOperation, driverTripState.trips, String(currentUser?.id || driverOperation.driverId || "")) : [],
    [driverOperation, driverTripState.trips],
  );
  const visibleOperationTripIds = React.useMemo(
    () => driverOperationTrips.map((trip) =>
      String(trip.canonicalTripId || trip.tripId || trip.id || "")),
    [driverOperationTrips],
  );
  const operationRecovery = useMissingOperationTrip(
    driverOperation, currentUser?.id, visibleOperationTripIds, driverTripState.historyReady,
  );

  const driverContract = React.useMemo(
    () => (driverOperation ? contracts.find((contract) => contract.id === driverOperation.contractId) || null : null),
    [contracts, driverOperation],
  );

  const driverVehicle = React.useMemo(
    () => (driverOperation ? vehicles.find((vehicle) => vehicle.id === driverOperation.vehicleId) || null : null),
    [driverOperation, vehicles],
  );

  const driverTrailer = React.useMemo(
    () => {
      const trailerId = String(
        (driverOperation as any)?.trailerId || (driverContract as any)?.trailerId || "",
      ).trim();
      return trailerId ? trailers.find((trailer) => trailer.id === trailerId) || null : null;
    },
    [driverContract, driverOperation, trailers],
  );

  const driverOperationCompany = React.useMemo(
    () => {
      const companyId = String((driverOperation as any)?.companyId || "").trim();
      return (companyId && companies.find((company) => company.id === companyId)) || currentActiveCompany || null;
    },
    [companies, currentActiveCompany, driverOperation],
  );

  const currentMembership = React.useMemo(
    () =>
      memberships.find(
        (membership) =>
          membership.companyId === activeCompanyId &&
          membership.status === "active",
      ),
    [memberships, activeCompanyId],
  );

  const canUseAdminProfile = React.useMemo(() => {
    const isOwner = Boolean(
      currentActiveCompany &&
        (currentActiveCompany.ownerId === currentUser?.id ||
          currentActiveCompany.userId === currentUser?.id),
    );
    const hasMembershipAdminRole = membershipHasRole(
      currentMembership,
      "admin",
      currentUser,
    );
    const hasLegacyAdminRole =
      currentUser?.roles?.includes("admin") &&
      (!activeCompanyId || currentUser.companyId === activeCompanyId);

    return Boolean(hasMembershipAdminRole || isOwner || hasLegacyAdminRole);
  }, [
    currentActiveCompany,
    currentMembership,
    currentUser,
    activeCompanyId,
  ]);

  // Redirect driver to join page if they don't have an active company and aren't an admin
  React.useEffect(() => {
    const isJoinRoute = window.location.pathname.includes("/driver/join");
    const needsToJoinCompany =
      !activeCompanyId && !currentUser?.roles?.includes("admin");

    if (needsToJoinCompany && !isJoinRoute) {
      navigate("/driver/join", { replace: true });
    } else if (!needsToJoinCompany && isJoinRoute) {
      navigate("/driver/profile", { replace: true });
    }
  }, [activeCompanyId, currentUser, navigate]);

  React.useEffect(() => {
    if (!isProfileMenuOpen) setShowCompanySwitch(false);
  }, [isProfileMenuOpen]);

  React.useEffect(() => {
    setIsMobileMenuOpen(false);
    setIsProfileMenuOpen(false);
    setShowCompanySwitch(false);
  }, [location.pathname]);

  React.useEffect(() => {
    if (!isDriverHeroRoute) {
      setIsHeaderEditRevealed(false);
      return;
    }
    const revealFromBanner = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: string }>).detail;
      if (!detail?.scope || detail.scope === "driver") setIsHeaderEditRevealed(true);
    };
    const hideOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.("[data-nvu-profile-banner], [data-nvu-header-edit-button]")) return;
      setIsHeaderEditRevealed(false);
    };
    window.addEventListener("nvu-profile-banner-tapped", revealFromBanner);
    document.addEventListener("pointerdown", hideOutside, true);
    return () => {
      window.removeEventListener("nvu-profile-banner-tapped", revealFromBanner);
      document.removeEventListener("pointerdown", hideOutside, true);
    };
  }, [isDriverHeroRoute]);

  React.useEffect(() => {
    if (!isMobileMenuOpen) return;
    // Warm the profile switch, not every heavy secondary page at menu-open.
    void preloadRoute("/admin/fleet").catch(() => undefined);
  }, [isMobileMenuOpen]);

  // Secondary route chunks and news data are loaded only after an explicit
  // menu/navigation intent. Mounting the authenticated shell must not compete
  // with the first visible page for parsing, network or Firestore time.

  // availableCompanies
  const availableCompanies = React.useMemo(() => {
    const list: { companyId: string; companyName: string; roles: string[] }[] =
      [];
    if (memberships && memberships.length > 0) {
      memberships.forEach((membership) => {
        if (membership.status === "active") {
          const comp = companies.find((c) => c.id === membership.companyId);
          // A membership ativa continua sendo a autoridade durante a hidratação
          // do documento da empresa; nunca descarte o vínculo só porque o card
          // ainda não chegou ao cache.
          const cName = comp ? comp.companyName : "Empresa vinculada (carregando...)";
          const roles = new Set(resolveMembershipRoles(membership, currentUser));
          if (
            comp &&
            (comp.ownerId === currentUser?.id || comp.userId === currentUser?.id)
          ) {
            roles.add("admin");
          }
          if (roles.size === 0) roles.add("driver");
          list.push({
            companyId: membership.companyId,
            companyName: cName,
            roles: Array.from(roles),
          });
        }
      });
    }
    return list;
  }, [memberships, companies, currentUser?.id]);

  const unreadNotifications =
    notifications?.filter((n) => !n.lida && n.userId === currentUser?.id) || [];
  const pendingCount = unreadNotifications.length;

  const handleSwitchRole = (newRole: "admin" | "driver") => {
    setIsMobileMenuOpen(false);
    setIsProfileMenuOpen(false);
    const target = newRole === "admin" ? "/admin/fleet" : "/driver/profile";
    if (activeRole === newRole) {
      commitRoleVisualTransition(newRole, () => {
        void switchRole(newRole, activeCompanyId || undefined);
        navigate(target, { replace: true });
      });
      return;
    }

    const currentMember = currentMembership;
    const hasRole =
      newRole === "admin"
        ? canUseAdminProfile
        : Boolean(
            membershipHasRole(currentMember, "driver") &&
              currentMember?.status === "active",
          );

    if (!hasRole) {
      alert(
        newRole === "admin"
          ? "Você não possui permissão de administrador."
          : "Perfil de motorista não disponível.",
      );
      return;
    }

    commitRoleVisualTransition(newRole, () => {
      void switchRole(newRole, activeCompanyId || undefined);
      navigate(target, { replace: true });
    });
    void preloadRoute(target).catch(() => undefined);
  };

  const handleCompanySwitch = (companyId: string, roles: string[]) => {
    const nextRole: "admin" | "driver" = roles.includes("admin")
      ? "admin"
      : "driver";
    const target =
      nextRole === "admin" ? "/admin/fleet" : "/driver/profile";
    const commitCompanySwitch = () => {
      setActiveCompanyId(companyId);
      void switchRole(nextRole, companyId);
      setIsProfileMenuOpen(false);
      setIsMobileMenuOpen(false);
      navigate(target, { replace: true });
    };

    if (nextRole === activeRole) {
      commitCompanySwitch();
      return;
    }

    commitRoleVisualTransition(nextRole, commitCompanySwitch);
    void preloadRoute(target).catch(() => undefined);
  };

  const handleLogout = async () => {
    setIsMobileMenuOpen(false);
    await logOutApp();
    navigate("/login");
  };

  const handleSidebarNavigation = React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, path: string, state?: Record<string, unknown>) => {
      setIsMobileMenuOpen(false);
      if (!isPlainPrimaryNavigation(event.nativeEvent)) return;
      event.preventDefault();
      const commit = () => {
        if (path === "/ranking") {
          navigate(path, { state: { backgroundLocation: location } });
          return;
        }
        navigate(path, { state });
      };
      if (path === "/ranking") {
        // Commit first; the ranking warm-up is best-effort and never gates
        // the visible route transition.
        commit();
        void preloadRoute(path).catch(() => undefined);
        void warmRankingAssets().catch(() => undefined);
      } else {
        void prepareAndCommitNavigation(() => preloadRoute(path), commit);
      }
    },
    [location, navigate, warmRankingAssets],
  );

  // All hooks must run before the session guard. The authenticated user can be
  // briefly unavailable during resume/logout and React must still see the same
  // hook order on every render.
  if (!currentUser) return null;

  const isApproved =
    activeRole === "admin" ||
    (activeCompanyId &&
      memberships.find((m) => m.companyId === activeCompanyId)?.status ===
        "active");

  const navItems = isApproved ? DRIVER_MENU_ITEMS : [];

  return (
    <OperationRecoveryContext.Provider value={operationRecovery}>
    <div
      data-nvu-native-android={nativeAndroid ? "true" : "false"}
      className={cn(
        "nvu-workspace-shell min-h-screen bg-gray-50 dark:bg-nvu-page flex flex-col text-gray-900 dark:text-nvu-text font-sans",
        nativeAndroid && "nvu-native-android nvu-native-driver-shell",
        !nativeAndroid && "nvu-desktop-shell nvu-desktop-driver-shell",
        isDriverHeroRoute && "nvu-native-profile-route",
        isCoverPage && "nvu-cover-page-shell",
        isLandscapeDashboard && "nvu-landscape-dashboard",
        isLandscapeProfile && "nvu-landscape-profile",
      )}
    >
      {window.location.pathname.includes("/driver/join") ? (
        <>{isLegacyCoverPage && <WorkspaceProfileCover scope="driver"/>}<RetainedWorkspaceOutlet scope={`${currentUser?.id || ""}:${activeCompanyId || ""}:driver`} /></>
      ) : (
        <>
          <SimpleAutomationCompletionBridge
            currentUser={currentUser}
            currentCompany={driverOperationCompany}
            currentJob={driverOperation}
            currentContract={driverContract}
            activeVehicle={driverVehicle}
            activeTrailer={driverTrailer}
            currentOperationProgress={driverOperationProgress}
            currentOperationTrips={driverOperationTrips}
            operationHistoryLoading={driverTripState.loading}
            operationHistoryReady={driverTripState.historyReady}
            operationHistoryError={Boolean(driverTripState.error)}
          />
          {/* Top Bar (Header) fixed at the top */}
          <header
            className={cn(
              "nvu-native-header nvu-profile-native-header nvu-profile-chrome-header fixed top-0 left-0 right-0 h-11 md:h-12 flex items-center px-4 md:px-6 justify-between z-50",
              isDriverHeroRoute
                ? "bg-transparent border-transparent text-white"
                : "bg-white dark:bg-nvu-page border-b border-gray-100 dark:border-nvu-line",
            )}
            ref={headerRef}
            data-nvu-hero-chrome={isDriverHeroRoute ? (heroChromeActive ? "active" : "settled") : undefined}
          >
            <div className="flex items-center gap-3 md:gap-4">
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen((open) => !open)}
                aria-expanded={isMobileMenuOpen}
                aria-controls="nvu-profile-floating-menu"
                aria-label={isMobileMenuOpen ? "Fechar menu" : "Abrir menu"}
                className={cn(
                  "nvu-native-menu-button md:hidden p-1.5 -ml-1.5 rounded-lg transition-colors",
                  isDriverHeroRoute
                    ? "text-white hover:bg-white/10"
                    : "text-gray-600 dark:text-nvu-text-soft hover:bg-gray-50 dark:bg-nvu-page dark:hover:bg-nvu-strip",
                )}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="4" x2="20" y1="12" y2="12" />
                  <line x1="4" x2="20" y1="6" y2="6" />
                  <line x1="4" x2="20" y1="18" y2="18" />
                </svg>
              </button>
              <div
                data-nvu-background-brand
                data-nvu-layout-brand
                className={cn(
                  "nvu-native-desktop-brand hidden md:flex items-center",
                  isDriverHeroRoute && "nvu-profile-wordmark",
                )}
              >
                <NvuWordmark />
              </div>
              <div
                data-nvu-background-brand
                data-nvu-layout-brand
                className={cn(
                  "nvu-native-mobile-brand md:hidden flex items-center font-bold leading-none",
                  isDriverHeroRoute ? "nvu-profile-wordmark text-white" : "text-lg text-gray-900 dark:text-nvu-text",
                )}
              >
                <NvuWordmark />
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
              {isDriverHeroRoute && isHeaderEditRevealed && (
                <button
                  type="button"
                  data-nvu-header-edit-button
                  onClick={() => setIsProfileModalOpen(true)}
                  aria-label="Editar perfil do motorista"
                  title="Editar perfil"
                  className={cn(
                    "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-white/40",
                    heroChromeActive
                      ? "text-white/95 hover:bg-white/10 hover:text-white"
                      : "text-gray-700 dark:text-nvu-text-soft hover:bg-gray-100 dark:hover:bg-nvu-strip/50",
                  )}
                >
                  <Pencil size={20} strokeWidth={2} />
                </button>
              )}
              <NotificationCenter
                notifications={notifications}
                onRead={markNotificationAsRead}
                isOpen={isNotificationsOpen}
                onToggle={() => setIsNotificationsOpen((open) => !open)}
                onClose={() => setIsNotificationsOpen(false)}
                buttonClassName={cn(
                  "relative p-2 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20",
                  heroChromeActive
                    ? "text-white/90 hover:text-white hover:bg-white/10"
                    : "text-gray-700 dark:text-nvu-text-soft hover:text-gray-950 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-nvu-strip/50",
                )}
                onOpen={(notification) => {
                  const type = notification.type ?? notification.tipo;
                  navigate(type === "NEW_OPERATION" ? "/driver" : "/driver/profile");
                }}
              />

              <div className={cn(
                "hidden sm:block h-6 w-px mx-1",
                isDriverHeroRoute ? "hidden" : "bg-gray-200 dark:bg-nvu-strip",
              )}></div>

              <button
                onClick={() => navigate("/driver/profile")}
                className={cn(
                  "flex items-center gap-2 focus:outline-none hover:opacity-80 transition-opacity",
                  isDriverHeroRoute && "ring-1 ring-white/35 rounded-full",
                )}
              >
                {currentActiveCompany?.logoUrl ? (
                  <StableImage
                    src={currentActiveCompany.logoUrl}
                    alt="Perfil"
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                    wrapperClassName="w-8 h-8 sm:w-9 sm:h-9 rounded-full border border-gray-200 dark:border-nvu-line bg-gray-100 dark:bg-nvu-surface shrink-0"
                    className="object-cover"
                    referrerPolicy="no-referrer"
                    fallback={
                      <span className="h-full w-full bg-slate-900 dark:bg-nvu-surface flex items-center justify-center text-white text-xs sm:text-sm font-bold">
                        {currentActiveCompany.companyName?.substring(0, 2).toUpperCase() || "NV"}
                      </span>
                    }
                  />
                ) : currentActiveCompany ? (
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-slate-900 dark:bg-nvu-surface border border-transparent dark:border-nvu-line flex items-center justify-center text-white text-xs sm:text-sm font-bold shrink-0">
                    {currentActiveCompany.companyName
                      ?.substring(0, 2)
                      .toUpperCase()}
                  </div>
                ) : resolveDriverPhoto(currentUser) ? (
                  <StableImage
                    src={resolveDriverPhoto(currentUser)}
                    alt="Perfil"
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                    wrapperClassName="w-8 h-8 sm:w-9 sm:h-9 rounded-full border border-gray-200 dark:border-nvu-line bg-gray-100 dark:bg-nvu-surface shrink-0"
                    className="object-cover"
                    referrerPolicy="no-referrer"
                    fallback={
                      <span className="h-full w-full bg-slate-900 dark:bg-nvu-surface flex items-center justify-center text-white text-xs sm:text-sm font-bold">
                        {currentUser?.name?.substring(0, 2).toUpperCase() || "MO"}
                      </span>
                    }
                  />
                ) : (
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-slate-900 dark:bg-nvu-surface border border-transparent dark:border-nvu-line flex items-center justify-center text-white text-xs sm:text-sm font-bold shrink-0">
                    {currentUser?.name?.substring(0, 2).toUpperCase()}
                  </div>
                )}
              </button>
            </div>
          </header>

          {/* Main wrapper starts below the header */}
          <div
            className={cn(
              "nvu-native-shell flex-1 flex max-w-full relative",
              isDriverHeroRoute ? "nvu-native-profile-shell pt-0" : "pt-11 md:pt-12",
            )}
          >
            <GlobalMenu
              profile="driver"
              open={isMobileMenuOpen}
              onClose={() => setIsMobileMenuOpen(false)}
              nativeAndroid={nativeAndroid}
              onNavigate={handleSidebarNavigation}
              currentUserName={currentUser?.name || "Motorista"}
              profilePhotoUrl={resolveDriverPhoto(currentUser)}
              roleLabel="Motorista"
              activeRole={activeRole as "admin" | "driver"}
              canSwitchRole={canUseAdminProfile}
              onSwitchRole={handleSwitchRole}
              isProfileMenuOpen={isProfileMenuOpen}
              onToggleProfile={() => setIsProfileMenuOpen((open) => !open)}
              showCompanySwitch={showCompanySwitch}
              onShowCompanySwitch={setShowCompanySwitch}
              availableCompanies={availableCompanies}
              activeCompanyId={activeCompanyId}
              onCompanySwitch={handleCompanySwitch}
              onProfileEdit={() => {
                setIsMobileMenuOpen(false);
                setIsProfileMenuOpen(false);
                setIsProfileModalOpen(true);
              }}
              theme={theme}
              onToggleTheme={toggleTheme}
              onLogout={handleLogout}
              driverItems={navItems}
            />

            {/* Main Content Viewport */}
            <main className="nvu-native-main flex-1 min-w-0 md:ml-64 flex flex-col min-h-[calc(100vh-3.5rem)] md:min-h-[calc(100vh-4rem)] max-w-full">
              <div
                className={cn(
                  "nvu-native-content p-2 sm:p-4 md:p-6 flex-1 w-full max-w-full overflow-hidden",
                  isDriverHeroRoute && "nvu-native-profile-content",
                )}
              >
                <>{isLegacyCoverPage && <WorkspaceProfileCover scope="driver"/>}<RetainedWorkspaceOutlet scope={`${currentUser?.id || ""}:${activeCompanyId || ""}:driver`} /></>
              </div>
            </main>
          </div>

        <WorkspaceDock role="driver" />
        <CompactProfileEditorModal
          open={isProfileModalOpen}
          mode="driver"
          onClose={() => setIsProfileModalOpen(false)}
        />
        </>
      )}
    </div>
    </OperationRecoveryContext.Provider>
  );
}
