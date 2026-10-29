import { useLayoutEffect, useRef, useState } from "react";
import { SystemBars, SystemBarsStyle, SystemBarType } from "@capacitor/core";
import { useLocation } from "react-router-dom";
import { useTheme } from "../../hooks/useTheme";
import { isNativeAndroid } from "../../lib/gtoObserver";
import { isProfileCoverPage } from "../../lib/profileCover";
import { useLandscapeWorkspace } from "../../hooks/useLandscapeWorkspace";

/**
 * The NVU theme is the only authority for Android status-bar appearance. This
 * controller intentionally covers every route: overlays, synthetic popstate
 * back navigation and persistent Driver/Admin shells must not leave a previous
 * route's icon mode behind.
 */
export default function NvuStatusBarController() {
  const location = useLocation();
  const { theme } = useTheme();
  const nativeAndroid = isNativeAndroid();
  const landscapeWorkspace = useLandscapeWorkspace();
  const normalizedPathname = location.pathname.replace(/\/+$/, "") || "/";
  const isProfileBannerRoute = (normalizedPathname === "/driver/profile"
    && !isProfileCoverPage(normalizedPathname, location.state))
    || (normalizedPathname === "/admin/fleet" && (location.state as { activeTab?: string } | null)?.activeTab === "company");
  const [profileChromeSettled, setProfileChromeSettled] = useState(false);
  const appliedStatus = useRef<SystemBarsStyle | null>(null);
  const appliedNavigation = useRef<SystemBarsStyle | null>(null);

  // DriverLayout/AdminLayout already own the banner-to-header transition and
  // expose it as data-nvu-hero-chrome. Observe only that profile-scoped marker;
  // no other route can influence this state or the global NVU theme authority.
  useLayoutEffect(() => {
    // The horizontal Painel do motorista uses a solid app bar (no banner image behind it).
    if (!nativeAndroid || !isProfileBannerRoute || landscapeWorkspace) {
      setProfileChromeSettled(false);
      return;
    }

    let frame = 0;
    let disposed = false;
    const readChromeState = () => {
      frame = 0;
      if (disposed) return;
      const header = Array.from(document.querySelectorAll<HTMLElement>("[data-nvu-hero-chrome]")).find(node => node.getClientRects().length > 0);
      const settled = header?.dataset.nvuHeroChrome === "settled";
      setProfileChromeSettled((current) => current === settled ? current : settled);
    };
    const scheduleRead = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(readChromeState);
    };

    readChromeState();
    window.addEventListener("scroll", scheduleRead, { passive: true });
    window.addEventListener("resize", scheduleRead, { passive: true });
    const observer = typeof MutationObserver !== "undefined"
      ? new MutationObserver(scheduleRead)
      : null;
    observer?.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-nvu-hero-chrome"],
      subtree: true,
    });

    return () => {
      disposed = true;
      window.removeEventListener("scroll", scheduleRead);
      window.removeEventListener("resize", scheduleRead);
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [nativeAndroid, isProfileBannerRoute, landscapeWorkspace, normalizedPathname]);

  useLayoutEffect(() => {
    if (!nativeAndroid) return;

    // On the profile banner the background is image-based, so white icons are
    // required. Once the banner leaves the viewport, the profile header owns a
    // light/dark surface and icons follow the persisted NVU theme. This branch
    // is route-scoped; Print, Select Profile and every other route are unchanged.
    const statusBarStyle = isProfileBannerRoute && !profileChromeSettled && !landscapeWorkspace
      ? SystemBarsStyle.Dark
      : theme === "dark"
        ? SystemBarsStyle.Dark
        : SystemBarsStyle.Light;

    if (appliedStatus.current !== statusBarStyle) {
      appliedStatus.current = statusBarStyle;
      void SystemBars.setStyle({ style: statusBarStyle, bar: SystemBarType.StatusBar })
        .catch(() => { if (appliedStatus.current === statusBarStyle) appliedStatus.current = null; });
    }
    // Navigation icons follow the app surface, independently of profile banners.
    const navigationStyle = theme === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light;
    if (appliedNavigation.current !== navigationStyle) {
      appliedNavigation.current = navigationStyle;
      void SystemBars.setStyle({ style: navigationStyle, bar: SystemBarType.NavigationBar })
        .catch(() => { if (appliedNavigation.current === navigationStyle) appliedNavigation.current = null; });
    }
  }, [isProfileBannerRoute, landscapeWorkspace, location.key, nativeAndroid, normalizedPathname, profileChromeSettled, theme]);

  return null;
}
