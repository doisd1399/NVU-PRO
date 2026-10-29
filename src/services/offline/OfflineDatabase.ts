import type { CanonicalTrip } from "../../domain/trip/CanonicalTrip";

export type OfflineRecordStatus =
  | "LOCAL_ONLY"
  | "PENDING_SYNC"
  | "SYNCING"
  | "SERVER_CONFIRMED"
  | "CONFLICT";

export interface OfflineTripRecord {
  trip: CanonicalTrip;
  syncStatus: OfflineRecordStatus;
  syncVersion: number;
  clientUpdatedAt: string;
  serverUpdatedAt?: string;
}

type OfflineStorage = Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "removeItem" | "key" | "length">>;
export type DurableOutbox = Record<string, any>;
type Envelope = { schemaVersion: number; records: Record<string, OfflineTripRecord>; outbox?: DurableOutbox };
const LEGACY_QUEUE_KEY = "nvu_sync_queue_v2";

/** Read-only diagnostics share the same authority as the synchronizer. */
export function readCanonicalOutboxSnapshot(storage: Pick<Storage, "getItem">): DurableOutbox {
  const raw = storage.getItem(STORAGE_KEY);
  const envelope = raw ? JSON.parse(raw) : null;
  const queue = envelope?.outbox ?? JSON.parse(storage.getItem(LEGACY_QUEUE_KEY) || "{}");
  if (!queue || typeof queue !== "object" || Array.isArray(queue)) throw new Error("SYNC_QUEUE_INVALID_SHAPE");
  return queue;
}
type OfflineDatabaseDependencies = { storage?: OfflineStorage | null };
const STORAGE_KEY = "nvu_canonical_trips.v2";
const SCHEMA_VERSION = 2;
const validRecord = (value: unknown): value is OfflineTripRecord => Boolean(value && typeof value === "object" &&
  (value as OfflineTripRecord).trip && typeof (value as OfflineTripRecord).trip === "object");

function storageError(code: string, cause: unknown): Error {
  return Object.assign(new Error(code), { cause });
}

function storageFailureReason(cause: unknown): "QUOTA" | "UNAVAILABLE" | "CORRUPT" | "UNKNOWN" {
  const name = String((cause as any)?.name || "");
  const text = `${name} ${String((cause as any)?.message || "")}`;
  // Android WebView/OEM implementations frequently surface a full origin as
  // UnknownError or SQLiteFullException instead of QuotaExceededError.
  if (/quota|space|exceed|sqlitefull|database or disk is full|storage full/i.test(text) ||
      /QuotaExceededError|NS_ERROR_DOM_QUOTA_REACHED|SQLiteFullException/i.test(name)) return "QUOTA";
  if (/unavailable|security|disabled|not supported/i.test(text)) return "UNAVAILABLE";
  if (/invalid|corrupt|json|schema/i.test(text)) return "CORRUPT";
  return "UNKNOWN";
}

function isRetryableCapacityFailure(cause: unknown): boolean {
  const name = String((cause as any)?.name || "");
  const message = String((cause as any)?.message || cause || "");
  return /quota|space|exceed|sqlitefull|database or disk is full|storage full/i.test(`${name} ${message}`) ||
    /QuotaExceededError|NS_ERROR_DOM_QUOTA_REACHED|SQLiteFullException|UnknownError/i.test(name);
}

/** Versioned local store used only by CanonicalTripRepository. */
export class OfflineDatabase {
  private memory = new Map<string, OfflineTripRecord>();
  private storage: OfflineStorage | null;
  private cachedSerialized: string | null | undefined;
  private cachedRecords: Record<string, OfflineTripRecord> | null = null;
  private memoryOutbox: DurableOutbox = {};

  constructor(dependencies: OfflineDatabaseDependencies = {}) {
    if (dependencies.storage !== undefined) {
      this.storage = dependencies.storage;
      return;
    }
    try {
      this.storage = typeof localStorage !== "undefined" ? localStorage : null;
    } catch {
      this.storage = null;
    }
  }

  private requireStorageInBrowser(): void {
    if (!this.storage && typeof localStorage !== "undefined") {
      this.storage = localStorage;
    }
    if (!this.storage && typeof window !== "undefined" && (window as any).localStorage) {
      this.storage = (window as any).localStorage as OfflineStorage;
    }
    if (!this.storage && typeof window !== "undefined") {
      throw new Error("OFFLINE_STORAGE_UNAVAILABLE");
    }
  }

  private read(): Record<string, OfflineTripRecord> {
    this.requireStorageInBrowser();
    if (!this.storage) return Object.fromEntries(this.memory);
    let serialized: string | null;
    try {
      serialized = this.storage.getItem(STORAGE_KEY);
    } catch (cause) {
      throw storageError("OFFLINE_STORAGE_READ_FAILED", cause);
    }
    if (!serialized) return {};
    if (this.cachedRecords && serialized === this.cachedSerialized) return { ...this.cachedRecords };
    try {
      const parsed: unknown = JSON.parse(serialized);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("OFFLINE_STORAGE_INVALID_SHAPE");
      }
      const envelope = parsed as { schemaVersion?: number; records?: Record<string, OfflineTripRecord> };
      if (![1, SCHEMA_VERSION].includes(Number(envelope.schemaVersion)) || !envelope.records || typeof envelope.records !== "object" || Array.isArray(envelope.records)) {
        throw new Error("OFFLINE_STORAGE_SCHEMA_UNSUPPORTED");
      }
      this.cachedSerialized = serialized;
      this.cachedRecords = envelope.records;
      return { ...envelope.records };
    } catch (cause) {
      throw storageError("OFFLINE_STORAGE_DATA_CORRUPT", cause);
    }
  }

  readOutbox(): DurableOutbox {
    this.requireStorageInBrowser();
    try { return this.storage ? readCanonicalOutboxSnapshot(this.storage) : JSON.parse(JSON.stringify(this.memoryOutbox)); }
    catch (cause) { throw storageError("SYNC_QUEUE_STORAGE_READ_FAILED", cause); }
  }

  /** One atomic localStorage replacement commits the record AND send command.
   * Legacy bytes are removed only after the complete new envelope is durable. */
  commitOutbox(outbox: DurableOutbox, record?: OfflineTripRecord): void {
    const data = this.read();
    if (record) {
      const id = String(record.trip.physicalDocumentId || record.trip.canonicalTripId || record.trip.tripId || "").trim();
      if (!id) throw new Error("CANONICAL_TRIP_ID_REQUIRED");
      if (Object.hasOwn(data, id) && !validRecord(data[id])) throw new Error("OFFLINE_STORAGE_RECORD_REQUIRES_REVIEW");
      data[id] = record;
    }
    this.write(data, outbox);
  }

  private write(data: Record<string, OfflineTripRecord>, suppliedOutbox?: DurableOutbox): void {
    this.requireStorageInBrowser();
    const outbox = suppliedOutbox ?? this.readOutbox();
    // Confirmed history is re-fetchable. Pending records, edits, conflicts and
    // receipts are never compacted, even under storage pressure.
    const compact = (aggressive: boolean) => {
      const acknowledged = Object.entries(outbox).filter(([, item]) => item?.state === "SERVER_CONFIRMED" && !item.alternatives?.length)
        .sort((a, b) => String(b[1].confirmedAt || b[1].queuedAt || "").localeCompare(String(a[1].confirmedAt || a[1].queuedAt || "")));
      for (const [id] of acknowledged.slice(aggressive ? 10 : 100)) delete outbox[id];
      const confirmed = Object.entries(data).filter(([id, r]) => validRecord(r) && r.syncStatus === "SERVER_CONFIRMED" &&
        !r.trip.editPending && !r.trip.deleted && !r.trip.historicalReadOnly &&
        (!outbox[id] || outbox[id].state === "SERVER_CONFIRMED"))
        .sort((a, b) => String(b[1].serverUpdatedAt || b[1].clientUpdatedAt).localeCompare(String(a[1].serverUpdatedAt || a[1].clientUpdatedAt)));
      for (const [id] of confirmed.slice(aggressive ? 10 : 250)) delete data[id];
    };
    compact(false);
    if (!this.storage) {
      this.memory = new Map(Object.entries(data));
      this.memoryOutbox = JSON.parse(JSON.stringify(outbox));
      return;
    }
    try {
      const persist = () => {
        const serialized = JSON.stringify({ schemaVersion: SCHEMA_VERSION, records: data, outbox });
        if (this.storage!.getItem(STORAGE_KEY) !== serialized) this.storage!.setItem(STORAGE_KEY, serialized);
      };
      try { persist(); }
      catch (error) {
        if (!isRetryableCapacityFailure(error)) throw error;
        compact(true);
        // Optional ranking/history/page copies share the WebView quota with
        // this journal. Reclaim only explicitly disposable reads; never Auth,
        // operation commands, pending trips, receipts or unfamiliar keys.
        if (this.storage.removeItem && this.storage.key && typeof this.storage.length === "number") {
          const prefixes = ["nvu-ranking-premium-v1:", "nvu-senior-catalog-v1:", "nvu.session.page.v1:", "nvu.trips.v2:", "nvu.persisted.v2.driver-trips."];
          const keys: string[] = [];
          for (let index = 0; index < this.storage.length; index++) {
            const key = this.storage.key(index);
            if (key && prefixes.some(prefix => key.startsWith(prefix))) keys.push(key);
          }
          for (const key of keys) { try { this.storage.removeItem(key); } catch { /* persist below verifies capacity */ } }
        }
        // Android WebView can report UnknownError for a full SQLite-backed
        // localStorage origin. Retry after reclamation instead of surfacing a
        // generic LOCAL_COMMIT while disposable caches still occupy the quota.
        try { persist(); }
        catch (retryError) {
          throw Object.assign(retryError instanceof Error ? retryError : new Error(String(retryError)), {
            storageFailureReason: storageFailureReason(retryError),
            journalPayloadBytes: JSON.stringify({ schemaVersion: SCHEMA_VERSION, records: data, outbox }).length,
          });
        }
      }
      // A failed cleanup is harmless: outbox in the envelope is authoritative.
      try { this.storage.removeItem?.(LEGACY_QUEUE_KEY); } catch { /* already committed */ }
      this.cachedRecords = null;
      this.cachedSerialized = undefined;
    } catch (cause) {
      throw Object.assign(storageError("OFFLINE_STORAGE_WRITE_FAILED", cause), {
        storageFailureReason: storageFailureReason(cause),
        journalPayloadBytes: (() => {
          try { return JSON.stringify({ schemaVersion: SCHEMA_VERSION, records: data, outbox }).length; }
          catch { return -1; }
        })(),
      });
    }
  }

  save(record: OfflineTripRecord): OfflineTripRecord {
    const data = this.read();
    const id = String((record.trip as any).physicalDocumentId || record.trip.canonicalTripId || record.trip.tripId || "").trim();
    if (!id) throw new Error("CANONICAL_TRIP_ID_REQUIRED");
    if (Object.hasOwn(data, id) && !validRecord(data[id])) throw new Error("OFFLINE_STORAGE_RECORD_REQUIRES_REVIEW");
    data[id] = record;
    this.write(data);
    return record;
  }

  saveMany(records: OfflineTripRecord[]): void {
    if (!records.length) return;
    const data = this.read();
    for (const record of records) {
      const id = String((record.trip as any).physicalDocumentId || record.trip.canonicalTripId || record.trip.tripId || "").trim();
      if (!id) throw new Error("CANONICAL_TRIP_ID_REQUIRED");
      data[id] = record;
    }
    this.write(data);
  }

  get(id: string): OfflineTripRecord | undefined {
    const record = this.read()[String(id || "").trim()];
    // Consumers receive an independent record, as they did with full JSON
    // parsing. Mutating a result cannot alter the durable/cache contents.
    return record ? JSON.parse(JSON.stringify(record)) : undefined;
  }

  list(): OfflineTripRecord[] {
    // Isolate malformed legacy rows without deleting their original bytes.
    // A damaged old row cannot disable registration for every healthy row.
    return JSON.parse(JSON.stringify(Object.values(this.read()).filter(validRecord)));
  }

  /** Permanently forget one device-local record. This never contacts the server. */
  remove(id: string): boolean {
    const key = String(id || "").trim();
    if (!key) return false;
    const data = this.read();
    if (!data[key]) return false;
    delete data[key];
    this.write(data);
    return true;
  }

  updateSyncStatus(id: string, status: OfflineRecordStatus): void {
    const data = this.read();
    const item = data[String(id || "").trim()];
    if (!item) return;
    data[String(id || "").trim()] = { ...item, syncStatus: status };
    this.write(data);
  }

  static get storageKey(): string { return STORAGE_KEY; }
  static get schemaVersion(): number { return SCHEMA_VERSION; }
}
