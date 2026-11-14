import { Capacitor } from "@capacitor/core";

/**
 * Mobile web uses the same visual shell as the Android APK, but it must not be
 * treated as native for plugin, permission, or background-service behavior.
 */
export function isMobileWebAndroidLike(): boolean {
  if (typeof window === "undefined" || Capacitor.isNativePlatform()) return false;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const narrowViewport = window.matchMedia?.("(max-width: 820px)").matches ?? window.innerWidth <= 820;
  return coarsePointer || narrowViewport;
}
