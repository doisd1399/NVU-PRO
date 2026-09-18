import React, { useState } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import {
  useActivityStore,
  useOperationalStore,
  useSessionStore,
} from "../context/AppContext";
import { useNotificationStore } from "../context/NotificationsContext";
import { useCompanyStore } from "../context/CompanyContext";
import { resolveProfilePhoto } from "../lib/resolveProfilePhoto";
import {
  Package,
  LayoutDashboard,
  FileText,
  Activity,
  Users,
  Settings,
  LogOut,
  Truck,
  Container,
  UserCheck,
  ChevronDown,
  Bell,
  Pencil,
  Menu,
  User,
  Moon,
  Sun,
  UserPlus,
  Building2,
  Crown,
  ChevronLeft,
  Check,
  Trophy,
  Newspaper,
  BookOpen,
} from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { cn } from "../lib/utils";
import { auth } from "../lib/firebase";
import { CompactProfileEditorModal, type CompactProfileEditorMode } from "../components/CompactProfileEditorModal";
import { StableImage } from "../components/common/StableImage";
import { NotificationCenter } from "../components/NotificationCenter";
import { GlobalMenu } from "../components/GlobalMenu";
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
import { isNativeAndroid } from "../lib/gtoObserver";
import {
  beginRankingWarmupSession,
  waitForRankingWarmup,
  warmRegisteredRankingPhotos,
} from "../lib/rankingPhotoWarmup";

export default function AdminLayout() {
  const {
    currentUser,
    switchRole,
    activeRole,
    logOutApp,
    seniorCompanyId,
    setSeniorCompanyId,
  } = useSessionStore();
  const {
    companies,
    activeCompanyId,
    setActiveCompanyId,
    memberships,
  } = useCompanyStore();
  const { notifications, markNotificationAsRead } = useNotificationStore();
  const { simulators } = useOperationalStore();
  const { jobDemands } = useActivityStore();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const isSeniorPanelRoute = location.pathname.startsWith("/admin/senior");
  const isSeniorCompanyPreview = Boolean(
    seniorCompanyId &&
      activeCompanyId === seniorCompanyId &&
      sessionStorage.getItem("seniorAccess") === "true" &&
      !isSeniorPanelRoute,
  );
  // The Senior route has its own Firebase-backed password/claim gate. Admin users
  // must be able to see and open that gate even before the senior claim has been
  // granted; hiding the entry behind the claim makes the panel impossible to discover.
  // AdminLayout is mounted only behind ProtectedRoute allowedRole="admin".
  // Keep the Senior entry visible for every authenticated admin; SeniorPanel itself
  // still enforces the Firebase-backed password/custom-claim gate before exposing
  // protected actions. This avoids hiding the only entry point because of stale or
  // not-yet-refreshed role metadata.
  const hasSeniorPanelAccess = true;
  const isNewsRoute = location.pathname.includes("/admin/news");
  const isManualRoute = location.pathname.includes("/admin/manual");
  const isAdminCompanyRoute = location.pathname.startsWith("/admin/fleet");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = React.useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = React.useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = React.useState(false);
  const [profileEditorMode, setProfileEditorMode] = React.useState<CompactProfileEditorMode>("driver");
  const [isHeaderEditRevealed, setIsHeaderEditRevealed] = React.useState(false);
  const [showCompanySwitch, setShowCompanySwitch] = React.useState(false);
  const [profileChromeProgress, setProfileChromeProgress] = React.useState(0);
  const nativeAndroid = isNativeAndroid();

  const warmRankingAssets = React.useCallback(() => {
    beginRankingWarmupSession(currentUser?.id || "");
    return Promise.all([
      warmRegisteredRankingPhotos(12),
      waitForRankingWarmup(currentUser?.id),
    ]).then(() => undefined);
  }, [currentUser?.id]);

  const warmNewsFeed = React.useCallback(() => {
    const newsUser = currentUser as any;
    const activeCompany = companies.find((company) => company.id === activeCompanyId) ||
      companies.find((company) => company.id === currentUser?.companyId);
    const simulatorId = activeCompany?.simulatorId || activeCompany?.simuladorId ||
      newsUser?.simulatorId || newsUser?.simuladorId;
    const simulatorDocument = simulators.find((simulator) => simulator.id === simulatorId);
    return import("../pages/NewsFeed").then(({ warmNvuNewsFirstPage }) => warmNvuNewsFirstPage({
      userId: currentUser?.id,
      simulatorValues: [
        activeCompany?.simulatorName,
        activeCompany?.simuladorNome,
        activeCompany?.simulator,
        simulatorDocument?.name,
        newsUser?.simulatorName,
        newsUser?.simuladorNome,
        newsUser?.simulator,
        simulatorDocument?.id,
        activeCompany?.simulatorId,
        activeCompany?.simuladorId,
        newsUser?.simulatorId,
        newsUser?.simuladorId,
      ],
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
    const handleOpenNotification = (event: Event) => {
      const notification = (event as CustomEvent).detail as { type?: string; tipo?: string };
      const type = notification?.type ?? notification?.tipo;
      if (type === "RH_APPLICATION") {
        navigate("/admin/fleet", { state: { activeTab: "hr" } });
      } else if (type === "WORK_REQUEST") {
        navigate("/admin/fleet", { state: { activeTab: "operations" } });
      } else {
        navigate("/admin/fleet");
      }
    };
    window.addEventListener("nvu-notification-open", handleOpenNotification);
    return () => window.removeEventListener("nvu-notification-open", handleOpenNotification);
  }, [navigate]);

  React.useEffect(() => {
    const handleOpenShellMenu = () => setIsMobileMenuOpen(true);
    window.addEventListener("nvu-open-shell-menu", handleOpenShellMenu);
    return () => window.removeEventListener("nvu-open-shell-menu", handleOpenShellMenu);
  }, []);

  React.useEffect(() => {
    if (!isProfileMenuOpen) setShowCompanySwitch(false);
  }, [isProfileMenuOpen]);

  React.useEffect(() => {
    if (!isAdminCompanyRoute) {
      setProfileChromeProgress(0);
      return;
    }

    let frame = 0;
    const updateChrome = () => {
      frame = 0;
      const hero = document.querySelector<HTMLElement>(".nvu-profile-hero");
      if (!hero) return;
      const heroBottom = hero.getBoundingClientRect().bottom;
      const progress = Math.max(0, Math.min(1, (168 - heroBottom) / 120));
      setProfileChromeProgress((current) => Math.abs(current - progress) < 0.015 ? current : progress);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(updateChrome);
    };
    updateChrome();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [isAdminCompanyRoute]);

  const heroChromeActive = isAdminCompanyRoute && profileChromeProgress < 0.55;

  React.useEffect(() => {
    setIsMobileMenuOpen(false);
    setIsProfileMenuOpen(false);
    setShowCompanySwitch(false);
  }, [location.pathname]);

  React.useEffect(() => {
    if (!isAdminCompanyRoute) {
      setIsHeaderEditRevealed(false);
      return;
    }
    const revealFromBanner = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: string }>).detail;
      if (!detail?.scope || detail.scope === "company") setIsHeaderEditRevealed(true);
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
  }, [isAdminCompanyRoute]);

  React.useEffect(() => {
    if (!isMobileMenuOpen) return;
    void preloadRoute("/admin/fleet");
    void preloadRoute("/ranking");
    void preloadRoute("/admin/news");
    if (!isNewsRoute) void warmNewsFeed();
    void preloadRoute("/admin/reports");
  }, [isMobileMenuOpen, isNewsRoute, warmNewsFeed]);


  // Secondary route chunks and news data are loaded only after an explicit
  // menu/navigation intent. Mounting the authenticated shell must not compete
  // with the first visible page for parsing, network or Firestore time.

  const unreadNotifications = notifications.filter((n) => !n.lida);
  const pendingCount = unreadNotifications.length;

  const pendingDemandsCount = React.useMemo(() => {
    return (
      jobDemands?.filter(
        (d) => d.companyId === activeCompanyId && d.status === "pending",
      ).length || 0
    );
  }, [jobDemands, activeCompanyId]);

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
          const roles = new Set(
            resolveMembershipRoles(membership, currentUser),
          );
          if (
            comp &&
            (comp.ownerId === currentUser?.id || comp.userId === currentUser?.id)
          ) {
            roles.add("admin");
            roles.add("driver");
          }
          list.push({
            companyId: membership.companyId,
            companyName: cName,
            roles: Array.from(roles),
          });
        }
      });
    }
    return list;
  }, [memberships, companies, currentUser]);

  const handleSwitchRole = (newRole: "admin" | "driver") => {
    setIsProfileMenuOpen(false);
    if (activeRole === newRole) return;

    const currentMember = memberships.find(
      (m) => m.companyId === activeCompanyId && m.status === "active",
    );
    const currentCompany = companies.find(
      (company) => company.id === activeCompanyId,
    );
    const isOwner = Boolean(
      currentCompany &&
        (currentCompany.ownerId === currentUser?.id ||
          currentCompany.userId === currentUser?.id),
    );
    const hasRole =
      membershipHasRole(currentMember, newRole) ||
      (newRole === "admin" && isOwner);

    if (!hasRole) {
      alert(
        newRole === "admin"
          ? "Você não possui permissão de administrador."
          : "Perfil de motorista não disponível.",
      );
      return;
    }

    const target = newRole === "admin" ? "/admin/fleet" : "/driver/profile";
    commitRoleVisualTransition(newRole, () => {
      void switchRole(newRole, activeCompanyId || undefined);
      navigate(target, { replace: true });
    });
    void preloadRoute(target).catch(() => undefined);
  };

  const handleCompanySwitch = (companyId: string, roles: string[]) => {
    const nextRole: "admin" | "driver" =
      roles.length > 0 && !roles.includes("admin") ? "driver" : "admin";
    const target =
      nextRole === "admin" ? "/admin/fleet" : "/driver/profile";
    const commitCompanySwitch = () => {
      setActiveCompanyId(companyId);
      void switchRole(nextRole, companyId);
      setIsProfileMenuOpen(false);
      if (nextRole !== activeRole) {
        navigate(target, { replace: true });
      }
    };

    if (nextRole === activeRole) {
      commitCompanySwitch();
      return;
    }

    commitRoleVisualTransition(nextRole, commitCompanySwitch);
    void preloadRoute(target).catch(() => undefined);
  };

  const handleReturnToSeniorPanel = React.useCallback(() => {
    // A Senior inspection is a temporary workspace. Restore the company that
    // was active before the inspection and clear only the temporary company
    // scope; the Firebase Senior authorization itself remains authenticated.
    const storedOriginCompanyId = String(
      sessionStorage.getItem("seniorOriginCompanyId") || "",
    ).trim();
    const currentUserCompanyId = String(currentUser?.companyId || "").trim();

    const ownCompanyIds = new Set(
      memberships
        .filter((membership) => membership.status === "active")
        .map((membership) => String(membership.companyId || "").trim())
        .filter(Boolean),
    );
    if (currentUserCompanyId) ownCompanyIds.add(currentUserCompanyId);

    const fallbackAdminMembership = memberships.find(
      (membership) =>
        membership.status === "active" &&
        membershipHasRole(membership, "admin", currentUser),
    );
    const fallbackMembership = memberships.find(
      (membership) => membership.status === "active",
    );

    const originCompanyId =
      (storedOriginCompanyId && ownCompanyIds.has(storedOriginCompanyId)
        ? storedOriginCompanyId
        : "") ||
      (currentUserCompanyId && ownCompanyIds.has(currentUserCompanyId)
        ? currentUserCompanyId
        : "") ||
      String(
        fallbackAdminMembership?.companyId ||
          fallbackMembership?.companyId ||
          "",
      ).trim();

    sessionStorage.removeItem("seniorAccess");
    sessionStorage.removeItem("seniorCompanyId");
    sessionStorage.removeItem("seniorOriginCompanyId");
    sessionStorage.removeItem("seniorOriginRole");
    setSeniorCompanyId(null);

    if (originCompanyId) {
      // Commit the user's own company before the route changes. The Senior
      // panel therefore never inherits the inspected company's active scope.
      setActiveCompanyId(originCompanyId);
      void switchRole("admin", originCompanyId);
    }

    setIsNotificationsOpen(false);
    setIsProfileMenuOpen(false);
    setIsMobileMenuOpen(false);
    navigate("/admin/senior", {
      replace: true,
      state: { activeTab: "approved", selectedCompanyId: null },
    });
  }, [
    currentUser,
    memberships,
    navigate,
    setActiveCompanyId,
    setSeniorCompanyId,
    switchRole,
  ]);

  const handleLogout = async () => {
    await logOutApp();
    navigate("/login");
  };

  const handleSidebarNavigation = React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, path: string) => {
      setIsMobileMenuOpen(false);
      if (!isPlainPrimaryNavigation(event.nativeEvent)) return;
      event.preventDefault();
      const commit = () => {
        if (path === "/ranking") {
          navigate(path, { state: { backgroundLocation: location } });
          return;
        }
        navigate(path);
      };
      if (path === "/ranking") {
        // Ranking must acknowledge the tap in the same interaction frame.
        // Route/code/photo warm-up continues after the destination is visible.
        commit();
        void preloadRoute(path).catch(() => undefined);
        void warmRankingAssets().catch(() => undefined);
      } else {
        void prepareAndCommitNavigation(() => preloadRoute(path), commit);
      }
    },
    [location, navigate, warmRankingAssets],
  );

  if (!currentUser) return null;

  const navGroups = [
    {
      title: "",
      items: [
        {
          label: "Estrutura da Frota",
          icon: Truck,
          path: "/admin/fleet",
        },
        {
          label: "Ranking",
          icon: Trophy,
          path: "/ranking",
        },
        {
          label: "NVU News",
          icon: Newspaper,
          path: "/admin/news",
        },
        {
          label: "Relatórios",
          icon: Activity,
          path: "/admin/reports",
        },
        {
          label: "Manual",
          icon: BookOpen,
          path: "/admin/manual",
        },
      ],
    },
  ];

  const currentActiveAdminCompany = companies.find(
    (c) => c.id === activeCompanyId,
  );

  return (
    <div className={cn(
      "nvu-admin-shell min-h-screen bg-gray-50 dark:bg-[#09090b] flex flex-col text-gray-900 dark:text-[#fafafa] font-sans",
      nativeAndroid && "nvu-native-android",
      nativeAndroid && isAdminCompanyRoute && "nvu-native-admin-company-route",
    )}>
      {/* Top Bar fixed at the top */}
      <header className={cn(
        "nvu-admin-header nvu-profile-chrome-header fixed top-0 left-0 right-0 h-11 md:h-12 flex items-center px-4 md:px-6 justify-between z-50",
        nativeAndroid && isAdminCompanyRoute
          ? "bg-transparent border-transparent text-white"
          : "bg-white dark:bg-[#09090b] border-b border-gray-100 dark:border-[#2A2F3A]",
      )}
        style={isAdminCompanyRoute ? ({ "--nvu-chrome-progress": profileChromeProgress } as React.CSSProperties) : undefined}
        data-nvu-hero-chrome={isAdminCompanyRoute ? (heroChromeActive ? "active" : "settled") : undefined}
      >
        <div className="flex items-center gap-3 md:gap-4">
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen((open) => !open)}
            aria-expanded={isMobileMenuOpen}
            aria-controls="nvu-admin-floating-menu"
            aria-label={isMobileMenuOpen ? "Fechar menu corporativo" : "Abrir menu corporativo"}
            className={cn(
              "nvu-admin-menu-button lg:hidden p-1.5 -ml-1.5 rounded-lg",
              nativeAndroid && isAdminCompanyRoute
                ? "text-white hover:bg-white/10"
                : "text-gray-600 dark:text-[#d4d4d8] hover:bg-gray-50 dark:bg-[#09090b] dark:hover:bg-[#3f3f46]",
            )}
          >
            <Menu size={24} />
          </button>
          <div
            data-nvu-background-brand
            data-nvu-layout-brand
            className="hidden lg:flex items-center"
          >
            <h1 className="font-bold text-lg text-gray-900 dark:text-[#fafafa] tracking-tight">
              NVU
            </h1>
          </div>
          <div
            data-nvu-background-brand
            data-nvu-layout-brand
            className="lg:hidden flex items-center font-bold text-lg text-gray-900 dark:text-[#fafafa] leading-none"
          >
            <span>NVU</span>
          </div>
        </div>

        {/* Right Box: Bell and User */}
        <div className={cn("flex items-center gap-1.5 md:gap-4", nativeAndroid && isAdminCompanyRoute && "text-white")}>

          {isSeniorCompanyPreview && (
            <button
              type="button"
              onClick={handleReturnToSeniorPanel}
              aria-label="Voltar ao Painel Sênior"
              title="Voltar ao Painel Sênior"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700 transition-colors hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-1 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20 dark:focus:ring-offset-[#09090b]"
            >
              <Crown size={16} strokeWidth={2.2} />
            </button>
          )}
          {isAdminCompanyRoute && isHeaderEditRevealed && (
            <button
              type="button"
              data-nvu-header-edit-button
              onClick={() => {
                setProfileEditorMode("company");
                setIsProfileModalOpen(true);
              }}
              aria-label="Editar perfil da empresa"
              title="Editar empresa"
              className={cn(
                "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-white/40",
                heroChromeActive
                  ? "text-white/95 hover:bg-white/10 hover:text-white"
                  : "text-gray-700 dark:text-[#d4d4d8] hover:bg-gray-100 dark:hover:bg-[#3f3f46]/50",
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
                "relative p-2 rounded-lg transition-colors",
                nativeAndroid && isAdminCompanyRoute && heroChromeActive
                  ? "text-white/90 hover:text-white hover:bg-white/10"
                  : "text-gray-700 dark:text-[#d4d4d8] hover:text-gray-950 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-[#3f3f46]",
              )}
            onOpen={(notification) => {
              const type = notification.type ?? notification.tipo;
              if (type === "RH_APPLICATION") {
                navigate("/admin/fleet", { state: { activeTab: "hr" } });
              } else if (type === "WORK_REQUEST" || type === "OPERATION_COMPLETED") {
                navigate("/admin/fleet", { state: { activeTab: "operations" } });
              } else {
                navigate("/admin/fleet");
              }
            }}
          />
          <button className={cn(
            "lg:hidden p-1.5 rounded-lg shrink-0",
            nativeAndroid && isAdminCompanyRoute
              ? "text-white hover:bg-white/10"
              : "text-gray-500 dark:text-[#a1a1aa] hover:bg-gray-50 dark:bg-[#09090b] dark:hover:bg-[#3f3f46]",
          )}>
            {resolveProfilePhoto(currentUser) ? (
              <StableImage
                src={resolveProfilePhoto(currentUser)}
                alt={currentUser.name}
                loading="eager"
                decoding="async"
                fetchPriority="high"
                wrapperClassName="w-7 h-7 rounded-full bg-gray-200 dark:bg-white/10"
                className="object-cover"
                referrerPolicy="no-referrer"
                fallback={
                  <span className="h-full w-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-[10px]">
                    {currentUser?.name?.substring(0, 2).toUpperCase() || "AD"}
                  </span>
                }
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-[10px]">
                {currentUser?.name?.substring(0, 2).toUpperCase() || "AD"}
              </div>
            )}
          </button>
          <button
            onClick={handleLogout}
            className={cn(
              "hidden lg:flex p-2",
              nativeAndroid && isAdminCompanyRoute
                ? "text-white/85 hover:text-white"
                : "text-gray-400 hover:text-gray-600 dark:text-[#d4d4d8] dark:hover:text-[#a1a1aa]",
            )}
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      {/* Main wrapper starts below the header */}
      <div className={cn(
        "nvu-admin-shell-content flex-1 flex pt-11 md:pt-12 max-w-full relative",
        nativeAndroid && isAdminCompanyRoute && "nvu-admin-company-content",
      )}>
        <GlobalMenu
          profile="company"
          open={isMobileMenuOpen}
          onClose={() => setIsMobileMenuOpen(false)}
          onNavigate={handleSidebarNavigation}
          currentUserName={currentUser?.name || "Administrador"}
          profilePhotoUrl={resolveProfilePhoto(currentUser)}
          roleLabel="Administrador"
          activeRole={activeRole as "admin" | "driver"}
          canSwitchRole={true}
          onSwitchRole={handleSwitchRole}
          isProfileMenuOpen={isProfileMenuOpen}
          onToggleProfile={() => setIsProfileMenuOpen((open) => !open)}
          showCompanySwitch={showCompanySwitch}
          onShowCompanySwitch={setShowCompanySwitch}
          availableCompanies={availableCompanies}
          activeCompanyId={activeCompanyId}
          onCompanySwitch={handleCompanySwitch}
          onProfileEdit={() => {
            setIsProfileMenuOpen(false);
            setProfileEditorMode("driver");
            setIsProfileModalOpen(true);
          }}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLogout={handleLogout}
          companyGroups={navGroups}
          hasSeniorPanelAccess={hasSeniorPanelAccess}
          isSeniorCompanyPreview={isSeniorCompanyPreview}
          onSeniorPanel={() => {
            if (isSeniorCompanyPreview) {
              handleReturnToSeniorPanel();
              return;
            }
            navigate("/admin/senior");
            setIsMobileMenuOpen(false);
          }}
        />

        {/* Main Content Viewport */}
        <main className="flex-1 min-w-0 lg:ml-64 flex flex-col min-h-[calc(100vh-3.5rem)] md:min-h-[calc(100vh-4rem)] max-w-full">
          <div
            className={cn(
              "flex-1",
              isAdminCompanyRoute && nativeAndroid
                ? "p-0"
                : isSeniorPanelRoute
                  ? "px-0 pt-0 pb-4 sm:px-2 sm:pt-1 md:px-4 md:pt-2"
                  : isNewsRoute
                    ? "p-2 sm:p-4 md:p-6"
                    : "p-4 sm:p-6 md:p-10",
            )}
          >
            <div className={cn(
              "w-full",
              location.pathname.startsWith("/admin/fleet")
                ? ""
                : "max-w-6xl mx-auto",
            )}>
              {!isSeniorPanelRoute &&
              !isManualRoute &&
              !activeCompanyId &&
              companies.length > 0 &&
              !location.pathname.includes("/admin/fleet") ? (
                <div className="text-center py-12 bg-white dark:bg-[#09090b] rounded-3xl border border-gray-200 dark:border-[#2A2F3A] shadow-sm dark:shadow-none">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-[#fafafa] mb-2">
                    Selecione uma Frota
                  </h2>
                  <p className="text-gray-500 dark:text-[#a1a1aa] mb-6">
                    Você precisa selecionar uma frota ativa na página de Gestão
                    da Frota para continuar.
                  </p>
                  <button
                    onClick={() =>
                      navigate("/admin/fleet", {
                        state: { activeTab: "operations" },
                      })
                    }
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors"
                  >
                    Ir para Gestão da Frota
                  </button>
                </div>
              ) : !isSeniorPanelRoute &&
                !isManualRoute &&
                !activeCompanyId &&
                companies.length === 0 &&
                !location.pathname.includes("/admin/fleet") ? (
                <div className="text-center py-12 bg-white dark:bg-[#09090b] rounded-3xl border border-gray-200 dark:border-[#2A2F3A] shadow-sm dark:shadow-none">
                  <div className="mx-auto w-16 h-16 bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/20 text-blue-500 flex items-center justify-center rounded-full mb-4">
                    <Truck size={32} />
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-[#fafafa] mb-2">
                    Nenhuma frota cadastrada
                  </h2>
                  <p className="text-gray-500 dark:text-[#a1a1aa] mb-6">
                    Crie sua primeira empresa/frota para começar a gerenciar.
                  </p>
                  <button
                    onClick={() =>
                      navigate("/admin/fleet", {
                        state: { activeTab: "operations" },
                      })
                    }
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors"
                  >
                    Criar Primeira Frota
                  </button>
                </div>
              ) : (
                <Outlet />
              )}
            </div>
          </div>
        </main>
      </div>

        <CompactProfileEditorModal
          open={isProfileModalOpen}
          mode={profileEditorMode}
          onClose={() => setIsProfileModalOpen(false)}
        />
    </div>
  );
}
