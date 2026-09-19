import React from "react";
import { NavLink } from "react-router-dom";
import {
  Building2,
  Check,
  ChevronLeft,
  ChevronDown,
  Crown,
  LayoutDashboard,
  LogOut,
  Moon,
  Settings,
  Sun,
  User,
} from "lucide-react";
import { cn } from "../lib/utils";
import { StableImage } from "./common/StableImage";

export type GlobalMenuProfile = "driver" | "company";

export type GlobalMenuItem = {
  label: string;
  path: string;
  exact?: boolean;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
};

export type GlobalMenuGroup = {
  title?: string;
  items: GlobalMenuItem[];
};

export type GlobalMenuCompany = {
  companyId: string;
  companyName: string;
  roles: string[];
};

export type GlobalMenuProps = {
  profile: GlobalMenuProfile;
  open: boolean;
  onClose: () => void;
  nativeAndroid?: boolean;
  onNavigate?: (event: React.MouseEvent<HTMLAnchorElement>, path: string) => void;
  currentUserName: string;
  profilePhotoUrl?: string | null;
  roleLabel: string;
  activeRole: "admin" | "driver";
  canSwitchRole: boolean;
  onSwitchRole: (role: "admin" | "driver") => void;
  isProfileMenuOpen: boolean;
  onToggleProfile: () => void;
  showCompanySwitch: boolean;
  onShowCompanySwitch: (show: boolean) => void;
  availableCompanies: GlobalMenuCompany[];
  activeCompanyId: string | null;
  onCompanySwitch: (companyId: string, roles: string[]) => void;
  onProfileEdit: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onLogout: () => void;
  driverItems?: GlobalMenuItem[];
  companyGroups?: GlobalMenuGroup[];
  hasSeniorPanelAccess?: boolean;
  isSeniorCompanyPreview?: boolean;
  onSeniorPanel?: () => void;
};

const profileCopy: Record<GlobalMenuProfile, {
  menuLabel: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number }>;
  accountAriaLabel: string;
  actionsAriaLabel: string;
}> = {
  driver: {
    menuLabel: "Menu do motorista",
    title: "Central do motorista",
    description: "Acesse seu perfil, páginas e preferências.",
    icon: LayoutDashboard,
    accountAriaLabel: "Perfil do motorista",
    actionsAriaLabel: "Ações do perfil",
  },
  company: {
    menuLabel: "Menu corporativo",
    title: "Central da empresa",
    description: "Gerencie frota, equipe e operações.",
    icon: Building2,
    accountAriaLabel: "Perfil do administrador",
    actionsAriaLabel: "Ações do perfil",
  },
};

export function GlobalMenu({
  profile,
  open,
  onClose,
  nativeAndroid = false,
  onNavigate,
  currentUserName,
  profilePhotoUrl,
  roleLabel,
  activeRole,
  canSwitchRole,
  onSwitchRole,
  isProfileMenuOpen,
  onToggleProfile,
  showCompanySwitch,
  onShowCompanySwitch,
  availableCompanies,
  activeCompanyId,
  onCompanySwitch,
  onProfileEdit,
  theme,
  onToggleTheme,
  onLogout,
  driverItems = [],
  companyGroups = [],
  hasSeniorPanelAccess = false,
  isSeniorCompanyPreview = false,
  onSeniorPanel,
}: GlobalMenuProps) {
  const copy = profileCopy[profile];
  const IntroIcon = copy.icon;
  const isCompany = profile === "company";
  const menuStateClass = nativeAndroid
    ? open
      ? "nvu-native-sidebar-open flex"
      : "nvu-native-sidebar-closed hidden"
    : open
      ? "nvu-native-sidebar-open flex translate-x-0"
      : "nvu-native-sidebar-closed -translate-x-full";

  return (
    <>
      {open && (
        <div
          className={cn(
            "nvu-native-menu-overlay fixed inset-0 bg-gray-900/50 z-40 md:hidden overflow-hidden",
            isCompany && "nvu-admin-menu-overlay",
          )}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          aria-hidden="true"
          data-nvu-menu-overlay="true"
        />
      )}

      <aside
        id={isCompany ? "nvu-admin-floating-menu" : "nvu-profile-floating-menu"}
        data-nvu-unified-profile-menu={profile}
        data-nvu-menu-open={open ? "true" : "false"}
        aria-label={copy.menuLabel}
        className={cn(
          "nvu-native-sidebar nvu-floating-menu-card nvu-profile-menu-card bg-white dark:bg-[#09090b] border-r border-gray-100 dark:border-[#2A2F3A] flex flex-col fixed top-11 md:top-12 bottom-0 z-40 shadow-sm dark:shadow-none hidden md:flex",
          !nativeAndroid && "w-64 left-0",
          isCompany && "nvu-admin-sidebar",
          !nativeAndroid && "transition-transform duration-300 ease-in-out",
          menuStateClass,
        )}
      >
        <div className={cn("nvu-profile-menu-intro", isCompany && "nvu-admin-menu-intro")}>
          <div className={cn("nvu-profile-menu-intro-copy", isCompany && "nvu-admin-menu-intro-copy")}>
            <p className={cn("nvu-profile-menu-eyebrow", isCompany && "nvu-admin-menu-eyebrow")}>{copy.menuLabel}</p>
            <h2 className={cn("nvu-profile-menu-title", isCompany && "nvu-admin-menu-title")}>{copy.title}</h2>
            <p className={cn("nvu-profile-menu-description", isCompany && "nvu-admin-menu-description")}>{copy.description}</p>
          </div>
          <div className={cn("nvu-profile-menu-intro-icon", isCompany && "nvu-admin-menu-intro-icon")} aria-hidden="true">
            <IntroIcon size={17} />
          </div>
        </div>

        <div className={cn("nvu-profile-menu-account p-2 border-b border-gray-100 dark:border-[#2A2F3A] relative", isCompany && "nvu-admin-menu-account")}>
          <div
            role="button"
            tabIndex={0}
            aria-expanded={isProfileMenuOpen}
            aria-label={copy.accountAriaLabel}
            onClick={onToggleProfile}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onToggleProfile();
              }
            }}
            className={cn(
              cn("flex items-center justify-between px-3 py-2.5 rounded-xl border cursor-pointer shadow-sm dark:shadow-none relative", !nativeAndroid && "transition-colors"),
              isProfileMenuOpen
                ? "border-green-200 bg-green-50 dark:bg-green-500/10 dark:border-green-500/20/50"
                : "border-gray-100 dark:border-[#2A2F3A] bg-white dark:bg-[#09090b] hover:bg-gray-50 dark:hover:bg-[#3f3f46]",
            )}
          >
            <div className="flex items-center gap-3 min-w-0">
              {profilePhotoUrl ? (
                <StableImage
                  src={profilePhotoUrl}
                  alt={currentUserName}
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                  wrapperClassName="w-9 h-9 rounded-full bg-gray-200 dark:bg-white/10 shrink-0"
                  className="object-cover"
                  referrerPolicy="no-referrer"
                  fallback={<span className="h-full w-full bg-slate-900 dark:bg-[#18181b] flex items-center justify-center text-white font-bold text-sm">{currentUserName.substring(0, 2).toUpperCase() || "NV"}</span>}
                />
              ) : (
                <div className={cn("w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0", isCompany ? "bg-blue-600" : "bg-slate-900 dark:bg-[#18181b]")}>
                  {currentUserName.substring(0, 2).toUpperCase() || "NV"}
                </div>
              )}
              <div className="flex-1 min-w-0 pr-2">
                <p className="text-sm font-bold text-gray-900 dark:text-[#fafafa] truncate">{currentUserName}</p>
                <p className="text-[11px] text-[#0cb49f] dark:text-[#0cb49f] font-semibold truncate leading-tight mt-0.5">{roleLabel}</p>
              </div>
            </div>
            <ChevronDown size={16} className={cn("text-gray-400", !nativeAndroid && "transition-transform duration-200", isProfileMenuOpen ? "rotate-180 text-[#0cb49f] dark:text-[#0cb49f]" : "")} />
          </div>
        </div>

        <div className={cn("nvu-profile-menu-section-label", isCompany && "nvu-admin-menu-section-label")}>
          {isProfileMenuOpen ? (showCompanySwitch ? "Escolha a empresa" : copy.actionsAriaLabel) : "Páginas e recursos"}
        </div>

        {isProfileMenuOpen ? (
          showCompanySwitch ? (
            <div className={cn("nvu-profile-menu-nav nvu-profile-profile-actions nvu-profile-company-switch-list", isCompany && "nvu-admin-menu-nav nvu-admin-profile-actions nvu-admin-company-switch-list")} aria-label="Empresas disponíveis">
              <div className={cn("nvu-profile-submenu-heading", isCompany && "nvu-admin-submenu-heading")}>
                <span>Trocar de empresa</span>
                <button type="button" onClick={() => onShowCompanySwitch(false)} className={cn("nvu-profile-submenu-back", isCompany && "nvu-admin-submenu-back")} aria-label="Voltar para ações do perfil">
                  <ChevronLeft size={16} />
                </button>
              </div>
              <div className={cn("nvu-profile-company-options", isCompany && "nvu-admin-company-options")}>
                {availableCompanies.map((company) => (
                  <button
                    key={company.companyId}
                    type="button"
                    onClick={() => onCompanySwitch(company.companyId, company.roles)}
                    className={cn("nvu-profile-menu-action w-full flex items-center justify-between text-left", isCompany && "nvu-admin-menu-action", activeCompanyId === company.companyId && "is-selected")}
                  >
                    <span className="flex min-w-0 items-center gap-2 truncate"><Building2 size={16} className="shrink-0" /><span className="truncate">{company.companyName}</span></span>
                    {activeCompanyId === company.companyId && <Check size={16} className="shrink-0 text-green-600 dark:text-green-400" />}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <nav className={cn("nvu-profile-menu-nav nvu-profile-profile-actions", isCompany && "nvu-admin-menu-nav nvu-admin-profile-actions")} aria-label={copy.actionsAriaLabel}>
              {canSwitchRole && (
                <div className={cn("nvu-profile-role-group", isCompany && "nvu-admin-role-group")}>
                  <p className={cn("nvu-profile-action-caption", isCompany && "nvu-admin-action-caption")}>Alternar perfil</p>
                  <button type="button" onClick={() => onSwitchRole("admin")} className={cn("nvu-profile-menu-action", isCompany && "nvu-admin-menu-action", activeRole === "admin" && "is-selected")}>
                    <span className="flex items-center gap-2"><User size={17} />Administrador</span>
                    {activeRole === "admin" && <Check size={16} />}
                  </button>
                  <button type="button" onClick={() => onSwitchRole("driver")} className={cn("nvu-profile-menu-action", isCompany && "nvu-admin-menu-action", activeRole === "driver" && "is-selected")}>
                    <span className="flex items-center gap-2"><LayoutDashboard size={17} />Motorista</span>
                    {activeRole === "driver" && <Check size={16} />}
                  </button>
                </div>
              )}
              <button type="button" onClick={() => onShowCompanySwitch(true)} className={cn("nvu-profile-menu-action", isCompany && "nvu-admin-menu-action")}>
                <span className="flex items-center gap-2"><Building2 size={17} />Trocar de empresa</span>
                <ChevronLeft size={16} className="rotate-180" />
              </button>
              <button type="button" onClick={onProfileEdit} className={cn("nvu-profile-menu-action", isCompany && "nvu-admin-menu-action")}>
                <span className="flex items-center gap-2"><Settings size={17} />Editar perfil</span>
              </button>
            </nav>
          )
        ) : isCompany ? (
          <nav className="nvu-profile-menu-nav nvu-admin-menu-nav flex-1 px-4 py-6 space-y-6 overflow-y-auto" aria-label="Gestão da frota">
            {companyGroups.map((group, index) => (
              <div key={`${group.title ?? "group"}-${index}`}>
                {group.title && <h3 className="nvu-profile-action-caption nvu-admin-group-title">{group.title}</h3>}
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <NavLink key={item.path} to={item.path} end={item.exact} onClick={(event) => (onNavigate ? onNavigate(event, item.path) : onClose())} className={({ isActive }) => cn("nvu-profile-menu-item nvu-admin-menu-item", isActive ? "is-active" : "")}>
                      <span className="flex items-center gap-3"><item.icon size={18} strokeWidth={2} />{item.label}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        ) : (
          <nav className="nvu-profile-menu-nav flex-1 px-4 py-6 space-y-2 overflow-y-auto" aria-label="Páginas e recursos">
            {driverItems.map((item) => (
              <NavLink key={item.path} to={item.path} end={item.exact} onClick={(event) => (onNavigate ? onNavigate(event, item.path) : onClose())} className={({ isActive }) => cn("nvu-profile-menu-item flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium", !nativeAndroid && "transition-colors", isActive ? "bg-[#0cb49f]/10 dark:bg-[#0cb49f]/10 text-[#0cb49f] dark:text-[#0cb49f]" : "text-gray-600 dark:text-[#d4d4d8] hover:bg-gray-50 dark:hover:bg-[#3f3f46] hover:text-gray-900 dark:hover:text-[#f4f4f5]") }>
                <item.icon size={18} />{item.label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className={cn("nvu-profile-menu-footer p-4 border-t border-gray-100 dark:border-[#2A2F3A] flex flex-col gap-2 relative", isCompany && "nvu-admin-menu-footer")}>
          <div className="mx-2 mb-1 p-3 bg-white dark:bg-[#09090b] border border-gray-100 dark:border-[#2A2F3A]/80 shadow-sm dark:shadow-none rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gray-50 dark:bg-[#27272a] border border-gray-100 dark:border-[#2A2F3A] flex items-center justify-center text-gray-500 dark:text-[#a1a1aa]">
                {theme === "dark" ? <Moon size={15} /> : <Sun size={15} />}
              </div>
              <span className="text-[13px] font-bold text-gray-900 dark:text-[#fafafa]">Modo Escuro</span>
            </div>
            <button type="button" onClick={onToggleTheme} className={cn("relative w-10 h-6 rounded-full focus:outline-none focus:ring-2 focus:ring-[#0cb49f] focus:ring-offset-2 dark:focus:ring-offset-[#121213]", !nativeAndroid && "transition-colors", theme === "dark" ? "bg-[#0cb49f]" : "bg-gray-200")} aria-label="Alternar modo escuro">
              <div className={cn("absolute top-1 left-1 w-4 h-4 rounded-full bg-white dark:bg-[#09090b] shadow-sm", !nativeAndroid && "transition-transform", theme === "dark" ? "translate-x-4" : "")} />
            </button>
          </div>
          {isCompany && hasSeniorPanelAccess && (
            <button type="button" onClick={onSeniorPanel} className={cn("nvu-profile-menu-item nvu-admin-menu-item flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 dark:text-[#d4d4d8] hover:bg-gray-50 dark:bg-[#09090b] dark:hover:bg-[#3f3f46] hover:text-gray-900 dark:hover:text-[#f4f4f5]", !nativeAndroid && "transition-colors")}>
              <Crown size={18} />Painel Sênior
            </button>
          )}
          <button type="button" onClick={onLogout} className={cn("nvu-profile-logout-button w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium", !nativeAndroid && "transition-colors", isCompany ? "nvu-admin-logout-button" : "nvu-driver-logout-button")}>
            <LogOut size={16} />Sair
          </button>
        </div>
      </aside>
    </>
  );
}
