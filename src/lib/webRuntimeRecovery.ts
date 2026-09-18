const WEB_STATE_VERSION = "nvu-web-state-v5";
const WEB_STATE_VERSION_KEY = "nvu.web.state-version";

const getStorage = (kind: "localStorage" | "sessionStorage"): Storage | null => {
  try {
    return window[kind];
  } catch {
    return null;
  }
};

const removeMatchingKeys = (
  storage: Storage,
  shouldRemove: (key: string) => boolean,
) => {
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && shouldRemove(key)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Firebase e o estado React continuam sendo a fonte de verdade quando o
    // preview restringe o armazenamento do iframe.
  }
};

/**
 * Applies a one-time migration for derived Web caches only.
 * Firebase Auth, UID-scoped session snapshots, active profile and resume route
 * are deliberately preserved; AppContext validates them against the current UID
 * and server memberships after Auth restores.
 */
export function prepareWebRuntime(): void {
  if (typeof window === "undefined") return;

  const local = getStorage("localStorage");
  const session = getStorage("sessionStorage");
  if (!local) return;

  try {
    if (local.getItem(WEB_STATE_VERSION_KEY) === WEB_STATE_VERSION) return;
  } catch {
    return;
  }

  removeMatchingKeys(
    local,
    (key) =>
      key.startsWith("nvu.ranking.snapshot.") ||
      key.startsWith("nvu.public.companies."),
  );

  if (session) {
    removeMatchingKeys(
      session,
      (key) =>
        key === "nvu.chunk-recovery",
    );
  }

  try {
    local.setItem(WEB_STATE_VERSION_KEY, WEB_STATE_VERSION);
  } catch {
    // A sessão limpa em memória continua válida sem persistência.
  }
}
