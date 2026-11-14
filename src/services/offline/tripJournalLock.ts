const DB_NAME = "nvu-trip-journal-locks", STORE = "mutex", LOCK = "nvu-trip-journal-v505";
const LOCK_TIMEOUT_MS = 8_000;
const unavailable = (cause: unknown) => Object.assign(new Error("TRIP_JOURNAL_LOCK_UNAVAILABLE"), {
  cause, storageFailureReason: "UNAVAILABLE",
});
const timeout = (phase: string) => unavailable(new Error(
  phase === "WEB_LOCK" ? "TRIP_JOURNAL_LOCK_WEB_LOCK_TIMEOUT" :
    phase === "OPEN" ? "TRIP_JOURNAL_LOCK_OPEN_TIMEOUT" : "TRIP_JOURNAL_LOCK_TRANSACTION_TIMEOUT",
));
function indexedDbLock<T>(work: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    let open: IDBOpenDBRequest;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      callback();
    };
    try { open = indexedDB.open(DB_NAME, 1); } catch (error) { reject(unavailable(error)); return; }
    let cancelled = false;
    timer = setTimeout(() => {
      cancelled = true;
      try { open.result?.close(); } catch { /* best effort */ }
      finish(() => reject(timeout("OPEN")));
    }, LOCK_TIMEOUT_MS);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE); };
    open.onerror = () => { cancelled = true; finish(() => reject(unavailable(open.error || new Error("TRIP_JOURNAL_LOCK_OPEN_FAILED")))); };
    open.onblocked = () => { cancelled = true; finish(() => reject(unavailable(new Error("TRIP_JOURNAL_LOCK_BLOCKED")))); };
    open.onsuccess = () => {
      const database = open.result; if (cancelled || settled) { database.close(); return; }
      // Opening and acquiring the transaction have separate deadlines.
      if (timer) clearTimeout(timer);
      timer = undefined;
      let result: T, failure: unknown, completed = false;
      try {
        // A readwrite transaction serializes this store even when it only reads.
        // The mutex must not require another persistent write/quota allocation:
        // the actual trip and outbox commit atomically in OfflineDatabase.
        const transaction = database.transaction(STORE, "readwrite");
        timer = setTimeout(() => {
          if (settled) return;
          cancelled = true;
          // work() commits the journal synchronously. The auxiliary mutex
          // cannot turn that successful commit into a failure.
          finish(() => completed ? resolve(result) : reject(timeout("TRANSACTION")));
          try { transaction.abort(); } catch { /* already completed */ }
          database.close();
        }, LOCK_TIMEOUT_MS);
        database.onversionchange = () => database.close();
        transaction.oncomplete = () => {
          database.close();
          finish(() => completed ? resolve(result) : reject(failure || unavailable(new Error("TRIP_JOURNAL_LOCK_CALLBACK_NOT_RUN"))));
        };
        transaction.onabort = transaction.onerror = () => {
          database.close();
          // An auxiliary transaction failure cannot undo a synchronous journal
          // commit that already succeeded. Domain/write failures still reject.
          if (completed) finish(() => resolve(result));
          else finish(() => reject(failure || unavailable(transaction.error || new Error("TRIP_JOURNAL_LOCK_ABORTED"))));
        };
        const request = transaction.objectStore(STORE).get(LOCK);
        request.onsuccess = () => {
          if (cancelled || settled) return;
          try { result = work(); completed = true; }
          catch (error) {
            failure = error;
            finish(() => reject(error));
            try { transaction.abort(); } catch { /* already inactive */ }
            database.close();
          }
        };
      } catch (error) { database.close(); finish(() => reject(unavailable(error))); }
    };
  });
}
/** Only a durable journal commit accepts a trip; locking is synchronization,
 * never a second persistence authority. */
export async function withTripJournalLock<T>(work: () => T): Promise<T> {
  let entered = false, completed = false, primaryActive = true, result: T;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const commit = () => {
    if (!primaryActive) throw unavailable(new Error("TRIP_JOURNAL_LOCK_CANCELLED"));
    entered = true; result = work(); completed = true; return result;
  };
  try {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (typeof locks?.request === "function") {
      const request = Promise.resolve(locks.request(LOCK, commit));
      // Some Android WebViews expose Web Locks but never settle the request.
      // A bounded acquisition attempt prevents the UI from hanging and makes
      // the IndexedDB mutex the single fallback for the rest of this call.
      request.catch(() => undefined);
      await Promise.race([request, new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(timeout("WEB_LOCK")), LOCK_TIMEOUT_MS);
      })]);
      if (!completed) throw unavailable(new Error("TRIP_JOURNAL_LOCK_CALLBACK_NOT_RUN"));
      return result!;
    }
  } catch (error) {
    primaryActive = false;
    if (completed) return result!;
    // WebViews can also reject with AbortError/UnknownError. If the callback
    // never started, an IndexedDB mutex is safe for any API acquisition error.
    if (entered) throw error;
    if (typeof indexedDB === "undefined") throw unavailable(error);
  } finally {
    primaryActive = false;
    if (timer) clearTimeout(timer);
  }
  if (typeof indexedDB !== "undefined") return indexedDbLock(work);
  return work();
}
