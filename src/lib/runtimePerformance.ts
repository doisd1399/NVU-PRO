import { Capacitor } from "@capacitor/core";

type NetworkInformationLike = {
  saveData?: boolean;
  effectiveType?: string;
};

type NavigatorWithRuntimeHints = Navigator & {
  connection?: NetworkInformationLike;
  deviceMemory?: number;
};

export type RuntimePerformanceProfile = {
  mobileViewport: boolean;
  embeddedPreview: boolean;
  saveData: boolean;
  slowConnection: boolean;
  lowMemory: boolean;
  lowCpu: boolean;
  constrained: boolean;
  allowSecondaryRouteWarmup: boolean;
  allowRankingWarmup: boolean;
  backgroundImageLimit: number;
  backgroundImageConcurrency: number;
  backgroundWarmupDelayMs: number;
  rankingWarmupDelayMs: number;
};

const isEmbeddedWindow = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

/**
 * Returns conservative runtime limits for non-critical preloads.
 *
 * The NVU frequently runs inside an AI Studio iframe and Android WebViews,
 * where decoding dozens of images or parsing several lazy routes in the
 * background can visibly interrupt the active screen. Critical data and the
 * current user's identity are never disabled; only speculative work is
 * reduced.
 */
export function getRuntimePerformanceProfile(): RuntimePerformanceProfile {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      mobileViewport: false,
      embeddedPreview: false,
      saveData: false,
      slowConnection: false,
      lowMemory: false,
      lowCpu: false,
      constrained: false,
      allowSecondaryRouteWarmup: true,
      allowRankingWarmup: true,
      backgroundImageLimit: 72,
      backgroundImageConcurrency: 3,
      backgroundWarmupDelayMs: 900,
      rankingWarmupDelayMs: 2200,
    };
  }

  const runtimeNavigator = navigator as NavigatorWithRuntimeHints;
  const connection = runtimeNavigator.connection;
  const effectiveType = String(connection?.effectiveType || "").toLowerCase();
  const saveData = Boolean(connection?.saveData);
  const slowConnection = effectiveType === "slow-2g" || effectiveType === "2g";
  const deviceMemory = Number(runtimeNavigator.deviceMemory || 0);
  const hardwareConcurrency = Number(runtimeNavigator.hardwareConcurrency || 0);
  const lowMemory = deviceMemory > 0 && deviceMemory <= 4;
  const lowCpu = hardwareConcurrency > 0 && hardwareConcurrency <= 4;
  const mobileViewport =
    window.matchMedia?.("(max-width: 820px)").matches ||
    window.matchMedia?.("(pointer: coarse)").matches ||
    window.innerWidth <= 820;
  const embeddedPreview = mobileViewport && isEmbeddedWindow();
  const nativeWebView = Capacitor.isNativePlatform();

  // AI Studio's mobile preview runs the editor, iframe, console and app in the
  // same tab. Native Android adds another constrained main thread: speculative
  // route imports, ranking listeners and image decodes compete directly with
  // Firestore/Auth callbacks and administrative taps. Critical visible data is
  // still loaded normally; only non-critical warm-up is disabled.
  const constrained =
    nativeWebView ||
    saveData ||
    slowConnection ||
    lowMemory ||
    lowCpu ||
    embeddedPreview;

  return {
    mobileViewport,
    embeddedPreview,
    saveData,
    slowConnection,
    lowMemory,
    lowCpu,
    constrained,
    allowSecondaryRouteWarmup: !constrained,
    allowRankingWarmup: !constrained,
    backgroundImageLimit: constrained ? 0 : mobileViewport ? 16 : 72,
    backgroundImageConcurrency: mobileViewport ? 2 : 3,
    backgroundWarmupDelayMs: mobileViewport ? 2600 : 900,
    rankingWarmupDelayMs: mobileViewport ? 6200 : 2200,
  };
}

export function canRunSpeculativePreload(): boolean {
  return getRuntimePerformanceProfile().allowSecondaryRouteWarmup;
}
