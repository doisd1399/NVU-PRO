import { useLayoutEffect, useRef, useState } from "react";
import { SystemBars, SystemBarsStyle, SystemBarType } from "@capacitor/core";
import { useLocation } from "react-router-dom";
import { useTheme } from "../../hooks/useTheme";
import { isNativeAndroid } from "../../lib/gtoObserver";
import { isProfileCoverPage } from "../../lib/profileCover";
import { useLandscapeWorkspace } from "../../hooks/useLandscapeWorkspace";

/** Height of the status bar plus a margin, in CSS px: a banner that starts above this line is under the status bar. */
function statusBarZone(): number {
  let inset = 0;
  try {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px)";
    document.body.appendChild(probe);
    inset = probe.offsetHeight;
    probe.remove();
  } catch { /* Fall back to a typical status bar height. */ }
  return Math.max(inset, 24) + 12;
}

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
  // True only while the banner photo really reaches the status bar. Below the app bar the status bar sits on the page surface.
  const [heroUnderStatusBar, setHeroUnderStatusBar] = useState(false);
  const appliedStatus = useRef<SystemBarsStyle | null>(null);
  const appliedNavigation = useRef<SystemBarsStyle | null>(null);

  // DriverLayout/AdminLayout already own the banner-to-header transition and
  // expose it as data-nvu-hero-chrome. Observe only that profile-scoped marker;
  // no other route can influence this state or the global NVU theme authority.
  useLayoutEffect(() => {
    // The horizontal Painel do motorista uses a solid app bar (no banner image behind it).
    if (!nativeAndroid || !isProfileBannerRoute || landscapeWorkspace) {
      setProfileChromeSettled(false);
      setHeroUnderStatusBar(false);
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
      const hero = Array.from(document.querySelectorAll<HTMLElement>(".nvu-profile-hero, .nvu-cover-hero")).find(node => node.getClientRects().length > 0);
      const under = Boolean(hero) && hero!.getBoundingClientRect().top < statusBarZone();
      setHeroUnderStatusBar((current) => current === under ? current : under);
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

    // While the banner PHOTO is under the status bar the background is image-based, so white icons are required.
    // When the banner starts below the app bar (the page surface is behind the status bar) or once it has scrolled
    // away, the header owns a light/dark surface and the icons follow the persisted NVU theme: dark icons on light. This branch
    // is route-scoped; Print, Select Profile and every other route are unchanged.
    const statusBarStyle = isProfileBannerRoute && !profileChromeSettled && heroUnderStatusBar && !landscapeWorkspace
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
  }, [heroUnderStatusBar, isProfileBannerRoute, landscapeWorkspace, location.key, nativeAndroid, normalizedPathname, profileChromeSettled, theme]);

  return null;
}
