import { onAuthTeardown } from "./authLifecycle";

type ImageCacheEntry = {
  image: HTMLImageElement | null;
  promise: Promise<void>;
  ready: boolean;
};

// Keep enough decoded entries for a ranking switch plus the active workspace.
// A smaller limit caused critical avatars to be evicted between the background
// warm-up and the first paint on large fleets.
const MAX_PRELOADED_IMAGES = 512;

type NvuImageCacheGlobal = typeof globalThis & {
  __nvuPreloadedImages?: Map<string, ImageCacheEntry>;
  __nvuImageReadySubscribers?: Map<string, Set<() => void>>;
};

// Store the registry on globalThis so AI Studio/Vite hot updates do not throw
// away decoded avatars and trigger a visible initials -> photo cycle again.
// The browser/WebView HTTP cache remains the durable layer across full reloads.
const imageCacheGlobal = globalThis as NvuImageCacheGlobal;
const preloadedImages =
  imageCacheGlobal.__nvuPreloadedImages ?? new Map<string, ImageCacheEntry>();
const readySubscribers =
  imageCacheGlobal.__nvuImageReadySubscribers ?? new Map<string, Set<() => void>>();
imageCacheGlobal.__nvuPreloadedImages = preloadedImages;
imageCacheGlobal.__nvuImageReadySubscribers = readySubscribers;

// A WebView can keep this module alive across a sign-out/sign-in cycle. Drop
// the in-memory decoded registry at the auth boundary so a new account never
// reuses another account's URL -> bitmap association.
let authTeardownAttached = false;
if (typeof window !== "undefined" && !authTeardownAttached) {
  authTeardownAttached = true;
  onAuthTeardown(() => {
    preloadedImages.clear();
    readySubscribers.clear();
  });
}

const normalizeImageUrl = (url?: string | null) => url?.trim() || "";

const touchEntry = (url: string, entry: ImageCacheEntry) => {
  preloadedImages.delete(url);
  preloadedImages.set(url, entry);
};

const notifyImageReady = (url: string) => {
  readySubscribers.get(url)?.forEach((subscriber) => subscriber());
};

const evictReadyEntries = () => {
  if (preloadedImages.size <= MAX_PRELOADED_IMAGES) return;

  for (const [url, entry] of preloadedImages) {
    // Never evict an image while its request/decode is still in flight.
    if (!entry.ready) continue;
    preloadedImages.delete(url);
    if (preloadedImages.size <= MAX_PRELOADED_IMAGES) break;
  }
};

const decodeWithTimeout = (image: HTMLImageElement): Promise<void> => {
  if (typeof image.decode !== "function") return Promise.resolve();

  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeoutId);
      resolve();
    };
    const timeoutId = window.setTimeout(finish, 350);

    try {
      Promise.resolve(image.decode()).then(finish).catch(finish);
    } catch {
      finish();
    }
  });
};

export function isImageReady(url?: string | null): boolean {
  const normalizedUrl = normalizeImageUrl(url);
  if (!normalizedUrl) return false;

  const entry = preloadedImages.get(normalizedUrl);
  if (!entry) return false;
  if (
    !entry.ready &&
    entry.image?.complete &&
    entry.image.naturalWidth > 0
  ) {
    entry.ready = true;
    // `isImageReady` is also called during React render. Defer the subscriber
    // notification so a completed background preload cannot call setState
    // synchronously while another component is rendering.
    Promise.resolve().then(() => notifyImageReady(normalizedUrl));
  }
  touchEntry(normalizedUrl, entry);
  return entry.ready;
}

/** Subscribe to readiness without forcing every avatar to poll or remount. */
export function subscribeImageReady(
  url: string | null | undefined,
  subscriber: () => void,
): () => void {
  const normalizedUrl = normalizeImageUrl(url);
  if (!normalizedUrl) return () => {};

  const subscribers = readySubscribers.get(normalizedUrl) ?? new Set();
  subscribers.add(subscriber);
  readySubscribers.set(normalizedUrl, subscribers);

  return () => {
    const current = readySubscribers.get(normalizedUrl);
    current?.delete(subscriber);
    if (current?.size === 0) readySubscribers.delete(normalizedUrl);
  };
}

/**
 * Marks an image that the native <img> element has already rendered. This is
 * useful when the visible image wins the race against the background preloader.
 */
export function rememberImageReady(url?: string | null): void {
  const normalizedUrl = normalizeImageUrl(url);
  if (!normalizedUrl || typeof window === "undefined") return;

  const existing = preloadedImages.get(normalizedUrl);
  if (existing) {
    const becameReady = !existing.ready;
    existing.ready = true;
    touchEntry(normalizedUrl, existing);
    if (becameReady) notifyImageReady(normalizedUrl);
    return;
  }

  preloadedImages.set(normalizedUrl, {
    image: null,
    ready: true,
    promise: Promise.resolve(),
  });
  evictReadyEntries();
  notifyImageReady(normalizedUrl);
}

/**
 * Starts one browser-native preload per URL. Keeping the Image element alive
 * gives Android WebView a better chance of reusing the decoded bitmap during
 * route changes. The browser's own HTTP cache remains available after eviction.
 */
export type ImagePreloadPriority = "high" | "auto" | "low";

export function preloadImage(
  url?: string | null,
  priority: ImagePreloadPriority = "auto",
): Promise<void> {
  const normalizedUrl = normalizeImageUrl(url);
  if (!normalizedUrl || typeof window === "undefined") {
    return Promise.resolve();
  }

  const existing = preloadedImages.get(normalizedUrl);
  if (existing) {
    touchEntry(normalizedUrl, existing);
    return existing.promise;
  }

  const image = new Image();
  image.loading = "eager";
  (image as HTMLImageElement & { fetchPriority?: string }).fetchPriority =
    priority;
  image.decoding = "async";

  const entry: ImageCacheEntry = {
    image,
    ready: false,
    promise: Promise.resolve(),
  };

  entry.promise = new Promise<void>((resolve) => {
    let settled = false;
    const finish = async (loaded: boolean) => {
      if (settled) return;
      settled = true;

      if (loaded) {
        // Some mobile Preview/WebView implementations leave decode() pending
        // indefinitely. Never let that stall the warm-up queue.
        await decodeWithTimeout(image);
        entry.ready = true;
        evictReadyEntries();
        notifyImageReady(normalizedUrl);
      } else if (preloadedImages.get(normalizedUrl) === entry) {
        // Do not permanently cache a transient network failure. A later mount
        // or connectivity recovery must be allowed to retry the same URL.
        preloadedImages.delete(normalizedUrl);
      }

      resolve();
    };

    image.onload = () => void finish(true);
    image.onerror = () => void finish(false);
    image.src = normalizedUrl;
  });

  preloadedImages.set(normalizedUrl, entry);
  evictReadyEntries();
  return entry.promise;
}

/** Warm a bounded number of images at a time so a large fleet does not
 * monopolize the connection or delay Firestore/API requests. */
export function preloadImages(
  urls: Array<string | null | undefined>,
  concurrency = 4,
  priority: ImagePreloadPriority = "auto",
): Promise<void> {
  const uniqueUrls = Array.from(
    new Set(urls.map(normalizeImageUrl).filter(Boolean)),
  );
  if (uniqueUrls.length === 0) return Promise.resolve();

  let cursor = 0;
  const worker = async () => {
    while (cursor < uniqueUrls.length) {
      const url = uniqueUrls[cursor++];
      await preloadImage(url, priority);
    }
  };

  const workerCount = Math.min(Math.max(concurrency, 1), uniqueUrls.length);
  return Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  ).then(() => undefined);
}

/** Clears only the in-memory decoded registry; browser HTTP cache is untouched. */
export function clearImageCache(): void {
  preloadedImages.clear();
  readySubscribers.clear();
}
