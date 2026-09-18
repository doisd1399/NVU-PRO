const CHUNK_RECOVERY_KEY = "nvu.chunk-recovery";
const PUBLISHED_BUILD_KEY = "nvu.published-build.v1";
const BUILD_CHECK_INTERVAL_MS = 15_000;
const INITIAL_BUILD_CHECK_DELAY_MS = 2_000;
const CHUNK_ERROR_PATTERNS = [
  "chunkloaderror",
  "loading chunk",
  "failed to fetch dynamically imported module",
  "importing a module script failed",
  "error loading dynamically imported module",
];

const stringifyReason = (reason: unknown) => {
  if (reason instanceof Error) return `${reason.name} ${reason.message}`.toLowerCase();
  if (typeof reason === "string") return reason.toLowerCase();
  try {
    return JSON.stringify(reason).toLowerCase();
  } catch {
    return String(reason).toLowerCase();
  }
};

const isChunkLoadFailure = (reason: unknown) => {
  const message = stringifyReason(reason);
  return CHUNK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
};

const readRecoveryTimestamp = () => {
  try {
    return Number(sessionStorage.getItem(CHUNK_RECOVERY_KEY) || 0);
  } catch {
    return 0;
  }
};

const writeRecoveryTimestamp = (value: number) => {
  try {
    sessionStorage.setItem(CHUNK_RECOVERY_KEY, String(value));
  } catch {
    // O reload ainda recupera o chunk quando o preview restringe storage.
  }
};

const clearRecoveryTimestamp = () => {
  try {
    sessionStorage.removeItem(CHUNK_RECOVERY_KEY);
  } catch {
    // Limpeza best-effort.
  }
};

const readPublishedBuild = () => {
  try {
    return sessionStorage.getItem(PUBLISHED_BUILD_KEY) || "";
  } catch {
    return "";
  }
};

const writePublishedBuild = (buildId: string) => {
  try {
    sessionStorage.setItem(PUBLISHED_BUILD_KEY, buildId);
  } catch {
    // O preview pode restringir storage; a checagem continua válida na sessão.
  }
};

let buildCheckInFlight = false;
let lastBuildCheckAt = 0;

/**
 * A página pode permanecer viva dentro do WebView enquanto o Netlify recebe
 * um deploy. Revalidar o manifesto ao retomar evita deixar o APK exibindo o
 * bundle anterior até uma reinicialização manual.
 */
const checkPublishedBuild = async () => {
  const now = Date.now();
  if (
    buildCheckInFlight ||
    now - lastBuildCheckAt < BUILD_CHECK_INTERVAL_MS ||
    typeof window === "undefined"
  ) {
    return;
  }

  buildCheckInFlight = true;
  lastBuildCheckAt = now;
  try {
    const response = await fetch(
      `/nvu-build.json?runtime-verification=${now}`,
      {
        cache: "no-store",
        credentials: "same-origin",
      },
    );
    if (!response.ok) return;

    const manifest = (await response.json()) as { buildId?: unknown };
    const remoteBuildId =
      typeof manifest.buildId === "string" ? manifest.buildId.trim() : "";
    if (!remoteBuildId) return;

    const knownBuildId = readPublishedBuild();
    if (!knownBuildId) {
      writePublishedBuild(remoteBuildId);
      return;
    }

    if (knownBuildId !== remoteBuildId) {
      // Save before reloading so the new page does not enter a reload loop.
      writePublishedBuild(remoteBuildId);
      window.location.reload();
    }
  } catch {
    // A transient offline/preview response must never interrupt the app.
  } finally {
    buildCheckInFlight = false;
  }
};

const recoverFromDeployChunkMismatch = (reason: unknown) => {
  if (!isChunkLoadFailure(reason)) return;

  const now = Date.now();
  const lastRecovery = readRecoveryTimestamp();
  if (Number.isFinite(lastRecovery) && now - lastRecovery < 60_000) return;

  writeRecoveryTimestamp(now);
  window.location.reload();
};

/**
 * A Netlify deploy can replace hashed lazy-route chunks while an already-open
 * tab/WebView still holds the previous index in memory. Recover once by
 * reloading the current URL; the HTML response is no-cache, so the next load
 * receives the new asset map without forcing the user to sign out.
 */
export const installDeployRecovery = () => {
  const handleError = (event: ErrorEvent) => {
    recoverFromDeployChunkMismatch(event.error || event.message);
  };
  const handleRejection = (event: PromiseRejectionEvent) => {
    recoverFromDeployChunkMismatch(event.reason);
  };
  const handleVisible = () => {
    if (document.visibilityState === "visible") {
      void checkPublishedBuild();
    }
  };

  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleRejection);
  document.addEventListener("visibilitychange", handleVisible);
  window.addEventListener("focus", handleVisible);

  window.setTimeout(() => {
    clearRecoveryTimestamp();
    void checkPublishedBuild();
  }, INITIAL_BUILD_CHECK_DELAY_MS);

  return () => {
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleRejection);
    document.removeEventListener("visibilitychange", handleVisible);
    window.removeEventListener("focus", handleVisible);
  };
};
