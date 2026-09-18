import { onAuthTeardown } from "./authLifecycle";

const STORAGE_KEY = "nvu.trips.tombstones.v1";
const MAX_TOMBSTONES = 500;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

let memoryTombstones = new Map<string, number>();
let loaded = false;
let teardownAttached = false;

function normalizeId(value: unknown): string {
  return String(value || "").trim();
}

function load(): Map<string, number> {
  if (loaded || typeof window === "undefined") return memoryTombstones;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? Object.entries(parsed)
        : [];
    const now = Date.now();
    const next = new Map<string, number>();
    for (const entry of entries) {
      const [rawId, rawAt] = Array.isArray(entry)
        ? entry
        : [entry?.id, entry?.deletedAt];
      const id = normalizeId(rawId);
      const deletedAt = Number(rawAt);
      if (id && Number.isFinite(deletedAt) && now - deletedAt <= MAX_AGE_MS) {
        next.set(id, deletedAt);
      }
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
    const entries = Array.from(load().entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, MAX_TOMBSTONES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Tombstones are a safety cache; Firestore remains authoritative.
  }
}

function ensureTeardown(): void {
  if (teardownAttached || typeof window === "undefined") return;
  teardownAttached = true;
  onAuthTeardown(() => {
    // Keep the persisted IDs across logout so a stale offline snapshot cannot
    // resurrect a deleted document after the same account logs in again.
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
  load().set(id, Date.now());
  persist();
}

export function filterTombstonedTrips<T extends { id?: unknown; tripId?: unknown }>(
  trips: readonly T[],
): T[] {
  ensureTeardown();
  const tombstones = load();
  return trips.filter((trip) => {
    const id = normalizeId(trip.id || trip.tripId);
    return !id || !tombstones.has(id);
  });
}

export function clearTripTombstone(tripId: unknown): void {
  ensureTeardown();
  const id = normalizeId(tripId);
  if (!id || !load().delete(id)) return;
  persist();
}

export const tripTombstoneContract = {
  storageKey: STORAGE_KEY,
  maxTombstones: MAX_TOMBSTONES,
  maxAgeMs: MAX_AGE_MS,
} as const;
