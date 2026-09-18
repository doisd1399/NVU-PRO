import {
  preloadImages,
} from "./imageCache";
import {
  isAuthTeardownActive,
  onAuthTeardown,
} from "./authLifecycle";

type RankingUserRecord = {
  [key: string]: unknown;
  id?: unknown;
};

const PHOTO_FIELDS = [
  "profilePhotoURL",
  "photoURL",
  "photoUrl",
  "avatar",
  "profileImage",
  "imageUrl",
  "photo",
] as const;
// A large admin fleet can contain hundreds of historical users. The ranking is
// intentionally warmed before navigation, so keep a generous but bounded
// manifest. The first visible rows are still requested first by the browser's
// normal priority scheduler.
// Warm only the first viewport-sized set before navigation. Remaining photos
// are requested lazily by the visible ranking rows and scroll position.
const MAX_RANKING_WARM_URLS = 96;
const PHOTO_MANIFEST_VERSION = "v3";
const PHOTO_MANIFEST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// A first authenticated session can need several Firestore `in` chunks plus
// the first visible avatar batch. Keep the current screen covered long enough
// for that complete snapshot to settle; this is only a safety valve for
// offline/permission failures, not the normal path.
const WARMUP_TIMEOUT_MS = 8_000;

/**
 * The ranking can discover the same driver through more than one route:
 * AppContext may already know the active company's users while the scoped
 * ranking listener is still resolving the global participants. Keep a small
 * id -> URL registry so either route can start the image request early.
 *
 * This registry intentionally contains only URLs, never names or metrics. It
 * is cleared when the authenticated session is torn down, so a new account
 * cannot inherit another account's profile mapping.
 */
const photoByDriverId = new Map<string, string>();
let teardownListenerAttached = false;

type RankingWarmupSession = {
  uid: string;
  sourceReady: boolean;
  pendingTasks: number;
  manifestStarted: boolean;
  settled: boolean;
  promise: Promise<void>;
  resolve: () => void;
};

type RankingWarmupGlobal = typeof globalThis & {
  __nvuRankingWarmupSessions?: Map<string, RankingWarmupSession>;
};

const warmupGlobal = globalThis as RankingWarmupGlobal;
const warmupSessions =
  warmupGlobal.__nvuRankingWarmupSessions ??
  new Map<string, RankingWarmupSession>();
warmupGlobal.__nvuRankingWarmupSessions = warmupSessions;

function ensureTeardownListener() {
  if (teardownListenerAttached || typeof window === "undefined") return;
  teardownListenerAttached = true;
  onAuthTeardown(() => {
    photoByDriverId.clear();
    warmupSessions.clear();
  });
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveRankingUserPhoto(
  user: unknown,
): string {
  const record =
    user && typeof user === "object"
      ? (user as RankingUserRecord)
      : undefined;
  for (const field of PHOTO_FIELDS) {
    const value = readText(record?.[field]);
    if (value) return value;
  }
  return "";
}

function normalizeIds(ids: Array<string | null | undefined>) {
  return Array.from(
    new Set(ids.map((id) => String(id || "").trim()).filter(Boolean)),
  );
}

function readManifestKey(uid: string) {
  return `nvu.ranking.photo-manifest.${PHOTO_MANIFEST_VERSION}.${uid}`;
}

function readPersistedPhotoManifest(uid: string): string[] {
  if (typeof window === "undefined" || !uid) return [];
  try {
    const raw = window.localStorage.getItem(readManifestKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      savedAt?: number;
      urls?: unknown;
    };
    if (
      !parsed ||
      !Number.isFinite(parsed.savedAt) ||
      Date.now() - Number(parsed.savedAt) > PHOTO_MANIFEST_MAX_AGE_MS ||
      !Array.isArray(parsed.urls)
    ) {
      window.localStorage.removeItem(readManifestKey(uid));
      return [];
    }
    return Array.from(
      new Set(
        parsed.urls
          .filter((url): url is string => typeof url === "string")
          .map((url) => url.trim())
          .filter(Boolean),
      ),
    ).slice(0, MAX_RANKING_WARM_URLS);
  } catch {
    return [];
  }
}

function persistPhotoManifest(uid: string, urls: string[]) {
  if (typeof window === "undefined" || !uid || urls.length === 0) return;
  try {
    window.localStorage.setItem(
      readManifestKey(uid),
      JSON.stringify({
        savedAt: Date.now(),
        urls: Array.from(new Set(urls)).slice(0, MAX_RANKING_WARM_URLS),
      }),
    );
  } catch {
    // Storage is an optimization only; the in-memory/browser HTTP cache still
    // provides the normal warm path in restricted Preview environments.
  }
}

function createWarmupSession(uid: string): RankingWarmupSession {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return {
    uid,
    sourceReady: false,
    pendingTasks: 0,
    manifestStarted: false,
    settled: false,
    promise,
    resolve,
  };
}

function getOrCreateWarmupSession(uid: string): RankingWarmupSession {
  const existing = warmupSessions.get(uid);
  if (existing) return existing;
  const created = createWarmupSession(uid);
  warmupSessions.set(uid, created);
  return created;
}

function settleWarmupSession(session: RankingWarmupSession) {
  if (session.settled || !session.sourceReady || session.pendingTasks > 0) {
    return;
  }
  session.settled = true;
  session.resolve();
}

/**
 * Starts a new account-scoped warm-up barrier. It is deliberately independent
 * of the Ranking page component, so the first click can wait for work that
 * started while the user was still on the home screen.
 */
export function beginRankingWarmupSession(uid: string): void {
  ensureTeardownListener();
  if (!uid || isAuthTeardownActive()) return;

  const current = warmupSessions.get(uid);
  if (!current) {
    warmupSessions.set(uid, createWarmupSession(uid));
  }

  const session = getOrCreateWarmupSession(uid);
  if (!session.manifestStarted) {
    session.manifestStarted = true;
    // Reuse the URL manifest from the previous app run immediately. This does
    // not display stale data; it only asks the browser/WebView to fill its
    // cache before the ranking is opened.
    const persistedUrls = readPersistedPhotoManifest(uid);
    if (persistedUrls.length > 0) {
      registerRankingWarmupTask(uid, preloadImages(persistedUrls, 4));
    }
  }
}

/**
 * Registers asynchronous work in the startup barrier. Failures are swallowed
 * by design: an unavailable photo must fall back to initials rather than
 * blocking navigation forever.
 */
export function registerRankingWarmupTask(
  uid: string,
  task: Promise<unknown> | unknown,
): void {
  ensureTeardownListener();
  if (!uid || isAuthTeardownActive()) return;
  const session = getOrCreateWarmupSession(uid);
  session.pendingTasks += 1;
  Promise.resolve(task)
    .catch(() => undefined)
    .finally(() => {
      session.pendingTasks = Math.max(0, session.pendingTasks - 1);
      settleWarmupSession(session);
    });
}

/**
 * Marks the Firestore sources as complete for the current startup snapshot.
 * Image tasks registered before this call are awaited by navigation.
 */
export function markRankingWarmupSourcesReady(uid: string): void {
  ensureTeardownListener();
  if (!uid || isAuthTeardownActive()) return;
  const session = getOrCreateWarmupSession(uid);
  session.sourceReady = true;
  settleWarmupSession(session);
}

/**
 * The navigation shell uses this as a short, account-scoped barrier. In the
 * normal case it is already resolved before the user taps Ranking. The timeout
 * is only a safety valve for offline/permission failures and never leaves the
 * app stuck on the previous route.
 */
export function waitForRankingWarmup(
  uid: string | null | undefined,
  timeoutMs = WARMUP_TIMEOUT_MS,
): Promise<void> {
  ensureTeardownListener();
  if (!uid || isAuthTeardownActive()) return Promise.resolve();
  const session = getOrCreateWarmupSession(uid);
  if (session.settled) return Promise.resolve();

  return Promise.race([
    session.promise,
    new Promise<void>((resolve) => {
      const schedule =
        typeof window !== "undefined" ? window.setTimeout : setTimeout;
      schedule(resolve, Math.max(0, timeoutMs));
    }),
  ]).then(() => undefined);
}

/**
 * Persists and immediately warms a set of profile URLs learned by the global
 * startup listener. URLs are kept per authenticated UID, never in a shared
 * key, so another account cannot inherit a profile mapping.
 */
export function registerRankingPhotoUrls(
  uid: string,
  urls: Array<string | null | undefined>,
  concurrency = 4,
): Promise<void> {
  ensureTeardownListener();
  if (!uid || isAuthTeardownActive()) return Promise.resolve();
  const normalized = Array.from(
    new Set(
      urls
        .filter((url): url is string => typeof url === "string")
        .map((url) => url.trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_RANKING_WARM_URLS);
  if (normalized.length === 0) return Promise.resolve();

  const previous = readPersistedPhotoManifest(uid);
  persistPhotoManifest(
    uid,
    Array.from(new Set([...normalized, ...previous])).slice(
      0,
      MAX_RANKING_WARM_URLS,
    ),
  );
  const task = preloadImages(normalized, concurrency);
  registerRankingWarmupTask(uid, task);
  return task;
}

/**
 * Registers profiles as soon as a Firestore/user-context snapshot arrives and
 * starts the browser preload immediately. The call is intentionally
 * best-effort: image failures must never delay ranking data or navigation.
 */
export function warmRankingUserProfiles(
  users: Array<unknown>,
  concurrency = 4,
): Promise<void> {
  ensureTeardownListener();
  if (isAuthTeardownActive()) return Promise.resolve();

  const urls: string[] = [];
  users.forEach((user) => {
    const record =
      user && typeof user === "object"
        ? (user as RankingUserRecord)
        : undefined;
    const id = String(record?.id || "").trim();
    const photo = resolveRankingUserPhoto(user);
    if (id && photo) photoByDriverId.set(id, photo);
    if (photo) urls.push(photo);
  });

  return preloadImages(
    Array.from(new Set(urls)).slice(0, MAX_RANKING_WARM_URLS),
    concurrency,
  );
}

/**
 * Warms any URLs already learned for the requested participant IDs. This is
 * used on ranking-filter changes before the next classification is committed.
 */
export function warmRankingPhotosForIds(
  ids: Array<string | null | undefined>,
  concurrency = 4,
): Promise<void> {
  ensureTeardownListener();
  if (isAuthTeardownActive()) return Promise.resolve();

  const urls = normalizeIds(ids)
    .map((id) => photoByDriverId.get(id) || "")
    .filter(Boolean);
  return preloadImages(
    Array.from(new Set(urls)).slice(0, MAX_RANKING_WARM_URLS),
    concurrency,
  );
}

/**
 * Reuses URLs already registered by AppContext or a ranking listener.
 * Navigation shells call this on pointer/focus without subscribing to the
 * entire operational store (which would make every vehicle/job update
 * rerender the shell).
 */
export function warmRegisteredRankingPhotos(concurrency = 4): Promise<void> {
  ensureTeardownListener();
  if (isAuthTeardownActive()) return Promise.resolve();
  return preloadImages(
    Array.from(new Set(photoByDriverId.values())).slice(
      0,
      MAX_RANKING_WARM_URLS,
    ),
    concurrency,
  );
}

export function getCachedRankingPhoto(
  id: string | null | undefined,
): string {
  ensureTeardownListener();
  return photoByDriverId.get(String(id || "").trim()) || "";
}
