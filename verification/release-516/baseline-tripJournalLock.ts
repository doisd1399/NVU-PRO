const DB_NAME = "nvu-trip-journal-locks", STORE = "mutex", LOCK = "nvu-trip-journal-v505";
function indexedDbLock<T>(work: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1); let cancelled = false;
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE); };
    open.onerror = () => reject(open.error || new Error("TRIP_JOURNAL_LOCK_OPEN_FAILED"));
    open.onblocked = () => { cancelled = true; reject(new Error("TRIP_JOURNAL_LOCK_BLOCKED")); };
    open.onsuccess = () => {
      const database = open.result; if (cancelled) { database.close(); return; }
      let result: T, failure: unknown;
      try {
        const transaction = database.transaction(STORE, "readwrite");
        transaction.oncomplete = () => { database.close(); resolve(result); };
        transaction.onabort = transaction.onerror = () => { database.close(); reject(failure || transaction.error || new Error("TRIP_JOURNAL_LOCK_ABORTED")); };
        const request = transaction.objectStore(STORE).put(1, LOCK);
        request.onsuccess = () => { try { result = work(); } catch (error) { failure = error; transaction.abort(); } };
      } catch (error) { database.close(); reject(error); }
    };
  });
}
/** Preserve cross-context serialization when Web Locks rejects the WebView origin. */
export async function withTripJournalLock<T>(work: () => T): Promise<T> {
  let entered = false; const commit = () => { entered = true; return work(); };
  try { const locks = typeof navigator !== "undefined" ? navigator.locks : undefined; if (locks?.request) return await locks.request(LOCK, commit); }
  catch (error) {
    // A callback/domain exception must never execute the commit twice.
    if (entered || !["SecurityError", "NotAllowedError", "NotSupportedError", "InvalidStateError"].includes(String((error as any)?.name))) throw error;
    if (typeof indexedDB === "undefined") throw Object.assign(new Error("TRIP_JOURNAL_LOCK_UNAVAILABLE"), { cause: error, storageFailureReason: "UNAVAILABLE" });
  }
  if (typeof indexedDB !== "undefined") return indexedDbLock(commit);
  return commit();
}
