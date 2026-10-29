/** Bounded, versioned snapshots. The authenticated viewer is part of every key. */
export type ManagementCacheScope = { viewerId: string; companyId: string; simulatorId: string; periodId: string };
const prefix = "nvu-management-v1:";
export function managementCacheKey(kind: "summary" | "goal", scope: ManagementCacheScope) {
  if (!scope.viewerId || !scope.companyId || !scope.simulatorId || !scope.periodId) return "";
  return `${prefix}${encodeURIComponent(scope.viewerId)}:${kind}:${[scope.companyId, scope.simulatorId, scope.periodId].map(encodeURIComponent).join(":")}`;
}
export function readManagementCache<T>(kind: "summary" | "goal", scope: ManagementCacheScope): { value: T; savedAt: number } | null {
  const key = managementCacheKey(kind, scope);
  if (!key) return null;
  try {
    const record = JSON.parse(localStorage.getItem(key) || "null");
    return record?.version === 1 && Number.isFinite(record.savedAt) && record.value && typeof record.value === "object" ? record : null;
  } catch { return null; }
}
export function writeManagementCache<T>(kind: "summary" | "goal", scope: ManagementCacheScope, value: T): boolean {
  const key = managementCacheKey(kind, scope);
  if (!key) return false;
  try {
    const owner = `${prefix}${encodeURIComponent(scope.viewerId)}:${kind}:`;
    const keys = Object.keys(localStorage).filter(item => item.startsWith(owner) && item !== key);
    // Pending goals must survive pruning until the server acknowledges them.
    const removable = keys.filter(item => { try { return !JSON.parse(localStorage.getItem(item) || "{}").value?.pending; } catch { return true; } });
    removable.sort((a, b) => {
      try { return (JSON.parse(localStorage.getItem(a) || "{}").savedAt || 0) - (JSON.parse(localStorage.getItem(b) || "{}").savedAt || 0); } catch { return 0; }
    });
    while (keys.length >= 32 && removable.length) {
      const oldest = removable.shift()!; localStorage.removeItem(oldest); keys.splice(keys.indexOf(oldest), 1);
    }
    localStorage.setItem(key, JSON.stringify({ version: 1, savedAt: Date.now(), value }));
    return true;
  } catch { return false; }
}

/** Resume saved goals for this viewer/company, including other saved periods. */
export function pendingManagementGoalScopes(viewerId: string, companyId: string): ManagementCacheScope[] {
  if (!viewerId || !companyId) return [];
  try {
    const owner = `${prefix}${encodeURIComponent(viewerId)}:goal:${encodeURIComponent(companyId)}:`;
    return Object.keys(localStorage).filter(key => key.startsWith(owner)).flatMap(key => {
      const parts = key.split(":");
      if (parts.length !== 6) return [];
      const scope = { viewerId, companyId, simulatorId: decodeURIComponent(parts[4]), periodId: decodeURIComponent(parts[5]) };
      return readManagementCache<{ pending?: boolean }>("goal", scope)?.value.pending === true ? [scope] : [];
    });
  } catch { return []; }
}
