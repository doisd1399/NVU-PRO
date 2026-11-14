import { normalizeCompanyDescription } from "../lib/companyProfileDescription";

export interface CompanyDescriptionRecord {
  viewerId: string;
  companyId: string;
  revision: string;
  text: string;
  status: "pending" | "synced";
  failed?: boolean;
}
const PREFIX = "nvu-company-description:v1:";
const writes = new Map<string, Promise<unknown>>();
export const COMPANY_DESCRIPTION_CHANGED = "nvu:company-description-changed";
export const companyDescriptionKey = (uid: string, companyId: string) => PREFIX + [uid, companyId].map(encodeURIComponent).join(":");

function valid(value: any): value is CompanyDescriptionRecord {
  return Boolean(value && typeof value.viewerId === "string" && value.viewerId && typeof value.companyId === "string" && value.companyId &&
    typeof value.revision === "string" && value.revision && typeof value.text === "string" &&
    value.text === normalizeCompanyDescription(value.text) && ["pending", "synced"].includes(value.status));
}
export function readCompanyDescription(uid: string, companyId: string): CompanyDescriptionRecord | null {
  try {
    const row = JSON.parse(localStorage.getItem(companyDescriptionKey(uid, companyId)) || "null");
    return valid(row) && row.viewerId === uid && row.companyId === companyId ? row : null;
  } catch { return null; }
}
function write(record: CompanyDescriptionRecord): void {
  if (!valid(record)) throw new Error("A descrição é inválida.");
  // A successful save always means durable storage, never a memory-only draft.
  try { localStorage.setItem(companyDescriptionKey(record.viewerId, record.companyId), JSON.stringify(record)); }
  catch { throw new Error("Não foi possível salvar a descrição neste aparelho."); }
  window.dispatchEvent(new CustomEvent(COMPANY_DESCRIPTION_CHANGED, { detail: { key: companyDescriptionKey(record.viewerId, record.companyId) } }));
}
async function locked<T>(key: string, run: () => T | Promise<T>): Promise<T> {
  const previous = writes.get(key) || Promise.resolve();
  const execute = () => navigator.locks?.request ? navigator.locks.request("company-description-store:" + key, run) : run();
  const task = previous.catch(() => undefined).then(execute);
  writes.set(key, task);
  try { return await task; } finally { if (writes.get(key) === task) writes.delete(key); }
}
export function putCompanyDescription(record: CompanyDescriptionRecord): Promise<void> {
  return locked(companyDescriptionKey(record.viewerId, record.companyId), () => write(record));
}
export function updateCompanyDescription(record: CompanyDescriptionRecord, changes: Partial<Pick<CompanyDescriptionRecord, "status" | "failed">>): Promise<void> {
  return locked(companyDescriptionKey(record.viewerId, record.companyId), () => {
    const current = readCompanyDescription(record.viewerId, record.companyId);
    if (current?.revision === record.revision) write({ ...current, ...changes });
  });
}
export function pendingCompanyDescriptions(uid: string): CompanyDescriptionRecord[] {
  const result: CompanyDescriptionRecord[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      try {
        const row = JSON.parse(localStorage.getItem(key) || "null");
        if (valid(row) && row.viewerId === uid && row.status === "pending" && key === companyDescriptionKey(uid, row.companyId)) result.push(row);
      } catch { /* One corrupt row must not block the other companies. */ }
    }
  } catch { /* An unavailable store never becomes a successful save. */ }
  return result;
}

/** Injectable synchronizer: acknowledgements cannot replace a newer draft. */
export function createCompanyDescriptionSync(deps: {
  uid: () => string | undefined; generation: () => number; online: () => boolean;
  publish: (record: CompanyDescriptionRecord) => Promise<void>;
}) {
  const running = new Map<string, Promise<void>>();
  async function sync(record: CompanyDescriptionRecord): Promise<void> {
    const session = deps.generation(), key = companyDescriptionKey(record.viewerId, record.companyId) + ":" + session;
    const currentSession = () => deps.uid() === record.viewerId && deps.generation() === session;
    if (!currentSession() || !deps.online()) return;
    const previous = running.get(key);
    if (previous) { await previous; return sync(record); }
    const publishLatest = async () => {
      while (currentSession() && deps.online()) {
        const current = readCompanyDescription(record.viewerId, record.companyId);
        if (!current || current.status !== "pending") return;
        try {
          if (!currentSession()) return;
          await deps.publish(current);
          if (!currentSession()) return;
          await updateCompanyDescription(current, { status: "synced", failed: false });
        } catch {
          if (currentSession()) await updateCompanyDescription(current, { failed: true });
          return; // Explicit retry/reconnect, never a permission-error spin loop.
        }
      }
    };
    const task = navigator.locks?.request
      ? navigator.locks.request("company-description-publish:" + companyDescriptionKey(record.viewerId, record.companyId), publishLatest)
      : publishLatest();
    running.set(key, task);
    try { await task; } finally { if (running.get(key) === task) running.delete(key); }
  }
  async function drain(): Promise<void> {
    const uid = deps.uid();
    if (!uid || !deps.online()) return;
    await Promise.all(pendingCompanyDescriptions(uid).map(sync));
  }
  return { sync, drain };
}
