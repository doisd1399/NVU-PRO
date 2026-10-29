import { onAuthTeardown } from "./authLifecycle";

const STORAGE_KEY = "nvu.trips.tombstones.v2";
const LEGACY_STORAGE_KEY = "nvu.trips.tombstones.v1";

let memoryTombstones = new Map<string, number>();
let loaded = false;
let teardownAttached = false;

function normalizeId(value: unknown): string { return String(value || "").trim(); }

function load(): Map<string, number> {
  if (loaded || typeof window === "undefined") return memoryTombstones;
  loaded = true;
  try {
    const storage = window.localStorage;
    const raw = storage.getItem(STORAGE_KEY) || storage.getItem(LEGACY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const entries = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? Object.entries(parsed) : [];
    const next = new Map<string, number>();
    for (const entry of entries) {
      const [rawId, rawAt] = Array.isArray(entry) ? entry : [entry?.id, entry?.deletedAt];
      const id = normalizeId(rawId);
      const deletedAt = Number(rawAt);
      if (id) next.set(id, Number.isFinite(deletedAt) ? deletedAt : Date.now());
    }
    memoryTombstones = next;
  } catch {
    memoryTombstones = new Map();
  }
  return memoryTombstones;
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(load().entries())));
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // A tombstone is still held in memory for the current process.
  }
}

function ensureTeardown(): void {
  if (teardownAttached || typeof window === "undefined") return;
  teardownAttached = true;
  onAuthTeardown(() => {
    // Keep storage; only memory is reset. This is what prevents a stale cache
    // from resurrecting a deleted trip after logout/login or process restart.
    memoryTombstones = new Map();
    loaded = false;
  });
}

export function isTripTombstoned(tripId: unknown): boolean {
  ensureTeardown();
  const id = normalizeId(tripId);
  return Boolean(id && load().has(id));
}

export function markTripTombstoned(tripId: unknown): void {
  ensureTeardown();
  const id = normalizeId(tripId);
  if (!id) return;
  if (load().has(id)) return;
  load().set(id, Date.now());
  persist();
}

export function filterTombstonedTrips<T extends { id?: unknown; tripId?: unknown; canonicalTripId?: unknown }>(trips: readonly T[]): T[] {
  ensureTeardown();
  const tombstones = load();
  return trips.filter((trip) => {
    const id = normalizeId(trip.canonicalTripId || trip.id || trip.tripId);
    return !id || !tombstones.has(id);
  });
}

/** Explicit administrative compaction only; normal app flows never call this. */
export function clearTripTombstone(tripId: unknown): void {
  ensureTeardown();
  const id = normalizeId(tripId);
  if (!id || !load().delete(id)) return;
  persist();
}

export const tripTombstoneContract = {
  storageKey: STORAGE_KEY,
  legacyStorageKey: LEGACY_STORAGE_KEY,
  persistent: true,
} as const;
