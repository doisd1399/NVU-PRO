export type OfflineOperationSnapshot = {
  updatedAt: number;
  data: Record<string, unknown>;
};

const KEY = "nvu.offline.operation.snapshot.v2";

// localStorage remains the fast path, but the store is versioned so older
// snapshots cannot overwrite newer offline sessions after reconnect.


export const saveOfflineOperation = (data: Record<string, unknown>) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify({ updatedAt: Date.now(), data }));
};

export const readOfflineOperation = (): OfflineOperationSnapshot | null => {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "null");
    return value?.data ? value : null;
  } catch {
    return null;
  }
};
