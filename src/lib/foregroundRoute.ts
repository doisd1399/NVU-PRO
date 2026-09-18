export const NVU_FOREGROUND_ROUTE_EVENT = "nvu:foreground-route";

const normalizePathname = (pathname?: string | null) => {
  const value = String(pathname || "").trim();
  return value || "/";
};

export const getForegroundPathname = () => {
  if (typeof window === "undefined") return "/";
  return normalizePathname(window.location.pathname);
};

export const announceForegroundRoute = (pathname: string) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<string>(NVU_FOREGROUND_ROUTE_EVENT, {
      detail: normalizePathname(pathname),
    }),
  );
};

/**
 * These screens are intentionally interaction-first. They need only identity,
 * membership/company labels and their own narrowly scoped request data. Large
 * operational/recruitment/notification listeners must stay paused while one
 * of them is visible so Firestore snapshot processing cannot delay a tap.
 */
export const isInteractionFirstRoute = (pathname?: string | null) => {
  const normalized = normalizePathname(pathname);
  return (
    normalized === "/select-profile" ||
    normalized === "/pending-applications" ||
    normalized === "/status"
  );
};

/**
 * ApplicationStatus still consumes the legacy recruitment slice, so only the
 * two screens that already own a dedicated pending-application listener can
 * suspend the broader company recruitment controller entirely.
 */
export const canSuspendCompanyScopedRealtime = (pathname?: string | null) => {
  const normalized = normalizePathname(pathname);
  return (
    normalized === "/select-profile" ||
    normalized === "/pending-applications"
  );
};
