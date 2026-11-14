import { onAuthTeardown } from "./authLifecycle";

export const SENIOR_CATALOG_CACHE_PREFIX = "nvu-senior-catalog-v1:";
type Catalog = { companies: any[]; members: any[]; users: any[]; totalCount: number | null };
const memory = new Map<string, Catalog>();
const companyFields = "id companyName ownerName ownerId userId email ownerEmail cnpj status situacao state deleted softDeleted excluida excluido logoUrl logoURL companyLogoURL simulatorId simulatorName simulator createdAt".split(" ");
const memberFields = "id userId companyId name email roles status".split(" ");
const userFields = "id name email status".split(" ");
const pick = (record: any, fields: string[]) => Object.fromEntries(fields.filter(key => record[key] !== undefined).map(key => [key, record[key]]));
const validRecords = (records: unknown, max: number): records is any[] => Array.isArray(records) && records.length <= max && records.every(record => record && typeof record === "object" && !Array.isArray(record) && typeof record.id === "string" && record.id.trim());
const storage = () => { try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; } };

export function readSeniorPanelCache(viewerId: string): Catalog | null {
  if (!viewerId) return null;
  if (memory.has(viewerId)) return memory.get(viewerId)!;
  try {
    const value = JSON.parse(storage()?.getItem(SENIOR_CATALOG_CACHE_PREFIX + encodeURIComponent(viewerId)) || "null");
    if (value?.version !== 1 || value.viewerId !== viewerId || !Number.isFinite(value.savedAt) || value.savedAt <= 0 ||
      !validRecords(value.companies, 60) || !validRecords(value.members, 500) || !validRecords(value.users, 500) ||
      !(value.totalCount === null || (Number.isInteger(value.totalCount) && value.totalCount >= 0))) return null;
    memory.set(viewerId, value);
    return value;
  } catch { return null; }
}

export function writeSeniorPanelCache(viewerId: string, catalog: Catalog) {
  if (!viewerId) return;
  const companies = catalog.companies.slice(0, 60).map(record => pick(record, companyFields));
  const ids = new Set(companies.map(record => record.id));
  const members = catalog.members.filter(record => ids.has(record.companyId)).slice(0, 500).map(record => pick(record, memberFields));
  const userIds = new Set([...companies.map(record => record.ownerId || record.userId), ...members.map(record => record.userId)]);
  const value = { companies, members, users: catalog.users.filter(record => userIds.has(record.id)).slice(0, 500).map(record => pick(record, userFields)), totalCount: catalog.totalCount };
  memory.clear(); memory.set(viewerId, value);
  try {
    const target = storage(), key = SENIOR_CATALOG_CACHE_PREFIX + encodeURIComponent(viewerId);
    if (!target) return;
    const oldKeys = Array.from({ length: target.length }, (_, i) => target.key(i)).filter((item): item is string => Boolean(item?.startsWith(SENIOR_CATALOG_CACHE_PREFIX) && item !== key));
    oldKeys.forEach(item => target.removeItem(item));
    target.setItem(key, JSON.stringify({ version: 1, viewerId, savedAt: Date.now(), ...value }));
  } catch { /* Memory remains available when persistent storage is full. */ }
}

onAuthTeardown(() => {
  memory.clear();
  try {
    const target = storage();
    if (!target) return;
    const keys = Array.from({ length: target.length }, (_, i) => target.key(i)).filter((key): key is string => Boolean(key?.startsWith(SENIOR_CATALOG_CACHE_PREFIX)));
    keys.forEach(key => target.removeItem(key));
  } catch { /* No persistent storage in private mode. */ }
});
