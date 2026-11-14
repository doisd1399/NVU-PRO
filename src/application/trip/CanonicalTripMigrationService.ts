const MIGRATION_KEY = "nvu.canonical.migration.v14";
const MIGRATION_VERSION = 14 as const;
const LEGACY_PREFIXES = [
  // These are disposable projections. Pending offline trips and edits are
  // durable user data and must never be removed by a cache migration.
  "nvu.persisted.v2.active-operation.",
  "nvu.persisted.v3.active-operation.",
  "nvu.ranking.snapshot.v2.",
];

export type CanonicalMigrationReport = {
  version: 14;
  valid: boolean;
  removedKeys: string[];
  checkedAt: string;
};

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Startup gate for the canonical data source. Legacy snapshots are acceleration
 * artifacts, not input data; removing them before hydration prevents deleted or
 * pre-canonical records from reappearing after a cold restart.
 */
export class CanonicalTripMigrationService {
  validateStartup(): CanonicalMigrationReport {
    const storage = getStorage();
    const removedKeys: string[] = [];
    if (storage) {
      // One-time cleanup of misleading operation/ranking projections. Preserve
      // trip history for offline viewing and every durable sync queue.
      try {
        const previous = JSON.parse(storage.getItem(MIGRATION_KEY) || "null");
        if (Number(previous?.version) >= MIGRATION_VERSION) {
          return { version: MIGRATION_VERSION, valid: true, removedKeys, checkedAt: new Date().toISOString() };
        }
      } catch { /* an invalid marker still requires the migration */ }
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (!key || key === MIGRATION_KEY) continue;
        if (LEGACY_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix))) {
          try {
            storage.removeItem(key);
            removedKeys.push(key);
          } catch {
            // The canonical repository never reads these schema keys.
          }
        }
      }
      try {
        storage.setItem(
          MIGRATION_KEY,
          JSON.stringify({ version: MIGRATION_VERSION, checkedAt: new Date().toISOString() }),
        );
      } catch {
        // The in-memory repository still enforces tombstones and schema checks.
      }
    }
    return {
      version: MIGRATION_VERSION,
      valid: true,
      removedKeys,
      checkedAt: new Date().toISOString(),
    };
  }

  async runBackfill(companyId: string) {
    return {
      migrated: 0,
      companyId: String(companyId || "").trim(),
      source: "CANONICAL_TRIP_REPOSITORY",
    };
  }
}

export const canonicalTripMigrationService = new CanonicalTripMigrationService();
export const canonicalTripMigrationContract = {
  storageKey: MIGRATION_KEY,
  version: MIGRATION_VERSION,
  legacyPrefixes: LEGACY_PREFIXES,
} as const;
