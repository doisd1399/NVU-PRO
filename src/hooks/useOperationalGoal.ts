import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { onIdTokenChanged } from "firebase/auth";
import { auth, db } from "../lib/firebase";
import { isAuthTeardownActive, onAuthTeardown } from "../lib/authLifecycle";
import { managementCacheKey, pendingManagementGoalScopes, readManagementCache, writeManagementCache, type ManagementCacheScope } from "../lib/managementOfflineCache";
import { accessManagedGoal } from "../services/operationalGoalAccess";

type GoalRecord = { targetAmount: number; pending: boolean; revision: number; periodKey: string };
type GoalState = { target: number; loading: boolean; error: string; pending: boolean; cached: boolean };
type Entry = { scope: ManagementCacheScope; documentId: string; state: GoalState; record: GoalRecord | null; listeners: Set<() => void>; stop?: () => void; release?: ReturnType<typeof setTimeout>; sending: boolean; closed: boolean; lastReadAttempt: number; denied: boolean; managed: boolean; reading: boolean; lastManagedRead: number };
const entries = new Map<string, Entry>();
const empty: GoalState = { target: 0, loading: false, error: "", pending: false, cached: false };
function publish(entry: Entry, next: Partial<GoalState>) {
  if (entry.closed) return;
  if (Object.entries(next).every(([key, value]) => entry.state[key as keyof GoalState] === value)) return;
  entry.state = { ...entry.state, ...next }; entry.listeners.forEach(notify => notify());
}
function entryFor(scope: ManagementCacheScope, documentId: string) {
  const key = managementCacheKey("goal", scope);
  if (!key || isAuthTeardownActive()) return null;
  let entry = entries.get(key);
  if (!entry) {
    const cached = readManagementCache<GoalRecord>("goal", scope)?.value;
    const record = cached && Number.isFinite(cached.targetAmount) && cached.targetAmount >= 0 ? cached : null;
    entry = { scope, documentId, record, state: { target: record?.targetAmount || 0, loading: !record && navigator.onLine, pending: Boolean(record?.pending), error: "", cached: Boolean(record) }, listeners: new Set(), sending: false, closed: false, lastReadAttempt: 0, denied: false, managed: false, reading: false, lastManagedRead: 0 };
    entries.set(key, entry);
  }
  return entry;
}
const permissionError = (error: unknown) => /permission-denied|unauthenticated/.test(String((error as { code?: unknown })?.code));
function managedError(entry: Entry, error: unknown) {
  const code = String((error as { code?: unknown })?.code);
  const unavailableBackend = /not-found|unimplemented/.test(code);
  entry.denied = permissionError(error) || unavailableBackend || /failed-precondition|invalid-argument/.test(code);
  publish(entry, { loading: false, error: unavailableBackend
    ? "O serviço de metas precisa ser atualizado no servidor. A última meta foi preservada."
    : permissionError(error) ? "Seu vínculo não permite gerenciar a meta desta empresa. Confira o acesso com o administrador."
      : "Não foi possível sincronizar a meta. Os dados deste aparelho foram preservados." });
}
async function readManaged(entry: Entry, force = false) {
  if (entry.closed || entry.reading || entry.denied || isAuthTeardownActive() || !navigator.onLine || auth.currentUser?.uid !== entry.scope.viewerId) return;
  // No polling and no read on every route reveal. Resume can refresh a stale
  // managed snapshot in the background; a save always returns its own ACK.
  if (!force && Date.now() - entry.lastManagedRead < 120_000) return;
  entry.reading = true; entry.lastManagedRead = Date.now();
  try {
    const data = await accessManagedGoal(entry.scope, entry.documentId);
    if (entry.closed || isAuthTeardownActive() || auth.currentUser?.uid !== entry.scope.viewerId) return;
    entry.denied = false;
    if (entry.record?.pending) { publish(entry, { loading: false, error: "" }); return; }
    entry.record = { targetAmount: data.targetAmount, periodKey: data.periodKey, pending: false, revision: Date.now() };
    const cached = writeManagementCache("goal", entry.scope, entry.record);
    publish(entry, { target: data.targetAmount, pending: false, loading: false, error: "", cached });
  } catch (error) {
    if (!entry.closed && auth.currentUser?.uid === entry.scope.viewerId) managedError(entry, error);
  } finally {
    entry.reading = false;
    if (!entry.closed && !entry.denied && entry.record?.pending) void send(entry);
  }
}
async function send(entry: Entry) {
  const record = entry.record;
  if (entry.closed || entry.denied || entry.sending || !record?.pending || !navigator.onLine || auth.currentUser?.uid !== entry.scope.viewerId) return;
  entry.sending = true;
  try {
    if (entry.managed) await accessManagedGoal(entry.scope, entry.documentId, record.targetAmount);
    else {
      try {
        await setDoc(doc(db, "operationalGoals", entry.documentId), {
          companyId: entry.scope.companyId, simulatorId: entry.scope.simulatorId, periodKey: record.periodKey,
          targetAmount: record.targetAmount, currency: "BRL", updatedBy: entry.scope.viewerId, updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (error) {
        if (!permissionError(error)) throw error;
        entry.managed = true; entry.stop?.(); entry.stop = undefined;
        await accessManagedGoal(entry.scope, entry.documentId, record.targetAmount);
      }
    }
    if (entry.closed || isAuthTeardownActive() || auth.currentUser?.uid !== entry.scope.viewerId) return;
    entry.lastManagedRead = Date.now();
    if (entry.record?.revision === record.revision) {
      entry.record = { ...record, pending: false };
      const cached = writeManagementCache("goal", entry.scope, entry.record);
      publish(entry, { target: record.targetAmount, pending: false, loading: false, error: cached ? "" : "Meta sincronizada. Armazenamento local indisponível.", cached });
    }
  } catch (error) {
    if (entry.managed) managedError(entry, error);
    else publish(entry, { loading: false, error: "Meta salva neste aparelho. A sincronização será tentada ao reconectar." });
  } finally {
    entry.sending = false;
    if (!entry.closed && entry.record?.pending && entry.record.revision !== record.revision) void send(entry);
  }
}
function listen(entry: Entry) {
  if (entry.stop || entry.denied || entry.closed || isAuthTeardownActive() || auth.currentUser?.uid !== entry.scope.viewerId) return;
  if (entry.managed) { void readManaged(entry); return; }
  if (Date.now() - entry.lastReadAttempt < 15_000) return;
  entry.lastReadAttempt = Date.now();
  entry.stop = onSnapshot(doc(db, "operationalGoals", entry.documentId), { includeMetadataChanges: true }, snapshot => {
    if (entry.closed) return;
    if (entry.record?.pending) { publish(entry, { loading: false }); return; }
    // An empty SDK memory cache does not prove the server has no goal.
    const fromCache = snapshot.metadata.fromCache;
    if (fromCache && (entry.state.cached || !snapshot.exists())) { publish(entry, { loading: false }); return; }
    const data = snapshot.data();
    const target = snapshot.exists() ? Math.max(0, Number(data?.targetAmount) || 0) : 0;
    entry.record = { targetAmount: target, pending: false, revision: Date.now(), periodKey: data?.periodKey || "" };
    const cached = writeManagementCache("goal", entry.scope, entry.record);
    publish(entry, { target, pending: false, loading: false, error: "", cached });
  }, error => {
    // A listener rejected by the server is terminal; reconnect may retry.
    entry.stop?.(); entry.stop = undefined;
    if (permissionError(error)) {
      entry.managed = true;
      void readManaged(entry, true);
    } else publish(entry, { loading: false, error: "Consulta pendente. Os dados salvos foram preservados." });
  });
}
function subscribe(entry: Entry | null, notify: () => void) {
  if (!entry) return () => {};
  ensureGoalLifecycle();
  clearTimeout(entry.release); entry.listeners.add(notify); listen(entry); void send(entry);
  return () => {
    entry.listeners.delete(notify);
    if (!entry.listeners.size) entry.release = setTimeout(() => { if (!entry.listeners.size) { entry.stop?.(); entry.stop = undefined; } }, 120_000);
  };
}
let stopTokenObserver: (() => void) | undefined;
function reconnectGoals(tokenChanged = false) {
  for (const entry of entries.values()) {
    if (auth.currentUser?.uid !== entry.scope.viewerId) { entry.stop?.(); entry.stop = undefined; continue; }
    if (tokenChanged) { entry.denied = false; entry.lastManagedRead = 0; }
    if (entry.listeners.size) {
      if (tokenChanged && !entry.stop) entry.lastReadAttempt = 0;
      listen(entry);
    }
    void send(entry);
  }
}
function ensureGoalLifecycle() {
  // A cached profile can mount before Firebase restores its UID. Wait for Auth
  // rather than leaving a terminal unauthenticated listener until reconnect.
  stopTokenObserver ??= onIdTokenChanged(auth, () => reconnectGoals(true));
}
onAuthTeardown(() => { entries.forEach(entry => { entry.closed = true; entry.stop?.(); clearTimeout(entry.release); }); entries.clear(); stopTokenObserver?.(); stopTokenObserver = undefined; });
if (typeof window !== "undefined") {
  window.addEventListener("online", () => reconnectGoals());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) reconnectGoals(); });
}

export function useOperationalGoal(scope: ManagementCacheScope, documentId: string, canManage: boolean) {
  const entry = canManage ? entryFor(scope, documentId) : null;
  const subscribeEntry = useCallback((notify: () => void) => subscribe(entry, notify), [entry]);
  const previousEntry = useRef(entry);
  const state = useSyncExternalStore(subscribeEntry, () => entry?.state || empty, () => empty);
  useEffect(() => {
    const previous = previousEntry.current;
    if (previous && previous !== entry && !previous.listeners.size) {
      clearTimeout(previous.release); previous.stop?.(); previous.stop = undefined;
    }
    previousEntry.current = entry;
  }, [entry]);
  useEffect(() => {
    if (!entry) return;
    for (const savedScope of pendingManagementGoalScopes(scope.viewerId, scope.companyId)) {
      const saved = entryFor(savedScope, savedScope.periodId);
      if (saved) void send(saved);
    }
  }, [entry]);
  const save = (amount: number, periodKey: string) => {
    if (!entry || !Number.isFinite(amount) || amount <= 0 || amount > 1e15 || auth.currentUser?.uid !== scope.viewerId) throw new Error("Verifique sua permissão e informe uma meta maior que zero.");
    const record: GoalRecord = { targetAmount: amount, pending: true, revision: Math.max(Date.now(), (entry.record?.revision || 0) + 1), periodKey: entry.record?.periodKey || periodKey };
    // No acknowledgement is invented: pending remains visible until setDoc resolves.
    if (!writeManagementCache("goal", scope, record)) throw new Error("Não foi possível salvar a meta neste aparelho. Libere espaço e tente novamente.");
    entry.record = record;
    publish(entry, { target: amount, pending: true, loading: false, error: entry.denied ? "Meta salva neste aparelho. A sincronização aguarda a regularização do acesso ao serviço." : "", cached: true });
    void send(entry);
  };
  const retry = useCallback(async () => {
    if (!entry || entry.closed || auth.currentUser?.uid !== entry.scope.viewerId) return;
    try { await auth.currentUser.getIdToken(true); }
    catch { return; } // Preserve the last confirmed value and the real error.
    entry.denied = false; entry.lastReadAttempt = 0; entry.lastManagedRead = 0;
    listen(entry); void send(entry);
  }, [entry]);
  return { ...state, save, retry };
}
