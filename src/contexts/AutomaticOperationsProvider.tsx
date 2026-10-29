import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../lib/firebase";
import { useSessionStore, useOperationalStore } from "../context/AppContext";
import { useCompanyStore } from "../context/CompanyContext";
import {
  type DriverQueueView,
  type QueueCatalog,
  type QueuePage,
  type QueueSettings,
} from "../../functions/src/operationalQueueModel";
import {
  OperationalQueueClient,
  collectOperationalQueuePages,
  type QueueMutation,
  type QueueMutationResult,
} from "../application/operation/OperationalQueueClient";
import {
  automaticQueueScope,
  readOperationalQueueCache,
  writeOperationalQueueCache,
} from "../lib/operationalQueueCache";
import { createQueueSignalFallback } from "../lib/queueSignalFallback";
import { operationalRequestId } from "../lib/operationalRequestId";
import type { OperationalPreparation } from "../../functions/src/operationalPreparationModel";

export type QueuePreparationView = OperationalPreparation & {
  companyId: string;
  enabled: boolean;
};
export type OperationalCommandsEnableResult = {
  success: boolean;
  version: number;
  companyId: string;
  ready: boolean;
  enabled: boolean;
};

const readCall = httpsCallable<Record<string, unknown>, any>(
  functions,
  "getOperationalQueues",
  { timeout: 120_000 },
);
const enableCommandsCall = httpsCallable<
  Record<string, unknown>,
  OperationalCommandsEnableResult
>(functions, "prepareCompanyOperationalCommands", { timeout: 120_000 });
const mutationClient = new OperationalQueueClient({
  getUid: () => auth.currentUser?.uid,
  storage: () => window.localStorage,
  randomId: operationalRequestId,
  transport: async (input) =>
    (
      await httpsCallable<
        QueueMutation & { requestId: string },
        QueueMutationResult
      >(functions, "configureOperationalQueues", { timeout: 120_000 })(input)
    ).data,
});
export type AutomaticOperationsStore = {
  scopeKey: string;
  settings: QueueSettings | null;
  view: DriverQueueView | null;
  loading: boolean;
  error: string | null;
  offline: boolean;
  fresh: boolean;
  offlineAvailable: boolean;
  localCommandPending?: boolean;
  refresh: () => Promise<void>;
  loadCatalog: () => Promise<QueueCatalog>;
  loadProgress: (driverId: string) => Promise<DriverQueueView>;
  loadPreparation: () => Promise<QueuePreparationView>;
  enableOperationalCommands: () => Promise<OperationalCommandsEnableResult>;
  save: (
    input: Omit<QueueMutation, "companyId">,
  ) => Promise<QueueMutationResult>;
};
export const AutomaticOperationsContext =
  createContext<AutomaticOperationsStore | null>(null);
export const useOptionalAutomaticOperations = () =>
  useContext(AutomaticOperationsContext);
export function useAutomaticOperations() {
  const value = useOptionalAutomaticOperations();
  if (!value) throw new Error("AutomaticOperationsProvider required");
  return value;
}

/** Owns the queue domain's single signal subscription and whole-snapshot cache.
 * No trip, contract or vehicle listener duplicates the existing data owners. */
export function AutomaticOperationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { currentUser, activeRole } = useSessionStore(),
    { activeCompanyId, companies } = useCompanyStore(),
    { jobs } = useOperationalStore();
  const uid = currentUser?.id || "",
    companyId = activeCompanyId || "",
    company = companies.find((c) => c.id === companyId);
  const simulatorRef = String(
    company?.simulatorId || company?.simulatorName || "unknown",
  );
  const scopeKey = automaticQueueScope(
      uid,
      companyId,
      activeRole || "",
      simulatorRef,
    ),
    configured = company?.automaticQueuesConfigured === true;
  const scope = useRef(scopeKey);
  scope.current = scopeKey;
  const publishedScope = useRef(scopeKey);
  const serverPublished = useRef<string | null>(null);
  const [settings, setSettings] = useState<QueueSettings | null>(null),
    [view, setView] = useState<DriverQueueView | null>(null),
    [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [offline, setOffline] = useState(() => !navigator.onLine),
    [fresh, setFresh] = useState(false),
    [offlineAvailable, setOfflineAvailable] = useState(false);
  const flight = useRef<{
      scope: string;
      task: Promise<void>;
      dirty: boolean;
    } | null>(null),
    catalogFlight = useRef<{
      scope: string;
      task: Promise<QueueCatalog>;
    } | null>(null);
  const current = useCallback(
    () => scope.current === scopeKey && auth.currentUser?.uid === uid,
    [scopeKey, uid],
  );
  const fetchPage = useCallback(
    async (input: Record<string, unknown>) =>
      (await readCall(input)).data as QueuePage,
    [],
  );
  const refresh = useCallback(async (invalidate = false) => {
    if (!scopeKey || !configured || !navigator.onLine) {
      if (scope.current === scopeKey) setFresh(false);
      return;
    }
    if (flight.current?.scope === scopeKey) {
      if (invalidate) flight.current.dirty = true;
      return flight.current.task;
    }
    const holder = { scope: scopeKey, task: Promise.resolve(), dirty: false };
    flight.current = holder;
    holder.task = (async () => {
      if (current()) setLoading(true);
      try {
        do {
          holder.dirty = false;
          if (activeRole === "admin") {
            const result = (await readCall({ companyId, kind: "settings" }))
              .data;
            if (!current()) return;
            if (result?.settings?.companyId !== companyId)
              throw new Error("QUEUE_SETTINGS_SCOPE_INVALID");
            setSettings((previous) =>
              previous && previous.revision > result.settings.revision
                ? previous
                : result.settings,
            );
          } else {
            const result = (await collectOperationalQueuePages(
              fetchPage,
              { companyId, driverId: uid, kind: "driver" },
              current,
            )) as DriverQueueView;
            if (!current()) return;
            serverPublished.current = scopeKey;
            setView(previous => previous?.viewToken === result.viewToken ? previous : result);
            setFresh(true);
            // A complete server response already authorizes the preview. Slow
            // IndexedDB writes must not keep the start button in Loading.
            void writeOperationalQueueCache(scopeKey, result).then(saved => {
              if (current()) setOfflineAvailable(saved);
            }).catch(() => { /* Offline cache is best-effort after publication. */ });
          }
          if (current()) setError(null);
        } while (holder.dirty && current() && navigator.onLine);
      } catch (e: any) {
        if (current()) {
          setError(e?.message || "Não foi possível atualizar a fila.");
          setFresh(false);
        }
      } finally {
        if (flight.current === holder) flight.current = null;
        if (current()) setLoading(false);
      }
    })();
    return holder.task;
  }, [scopeKey, configured, activeRole, companyId, uid, current, fetchPage]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    let disposed = false;
    publishedScope.current = scopeKey;
    serverPublished.current = null;
    setSettings(null);
    setView(null);
    setFresh(false);
    setError(null);
    setLoading(false);
    setOfflineAvailable(false);
    if (!scopeKey || !configured) return;
    if (activeRole === "driver")
      void readOperationalQueueCache(scopeKey).then((cached) => {
        if (
          !disposed &&
          scope.current === scopeKey &&
          serverPublished.current !== scopeKey &&
          cached
        ) {
          // A slow cache read cannot overwrite a server result for this scope.
          setView((previous) => previous || cached.snapshot);
          setOfflineAvailable(true);
        }
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refreshRef.current(true), 40);
    };
    const fallback = createQueueSignalFallback({
      isCurrent: () => !disposed && scope.current === scopeKey,
      canRefresh: () => navigator.onLine && document.visibilityState === "visible",
      refresh: () => refreshRef.current(),
    });
    let lastSignalRevision: number | undefined;
    const stop = onSnapshot(
      doc(db, "operationalQueueSignals", companyId),
      snapshot => {
        fallback.stop();
        const revision = snapshot.data()?.revision;
        if (typeof revision === "number" && revision === lastSignalRevision) return;
        lastSignalRevision = revision;
        schedule();
      },
      (e) => {
        if (disposed || scope.current !== scopeKey) return;
        if (e.code === "permission-denied") {
          // Canonical membership is checked by every callable. Older signal
          // rules may know only the legacy membership projection.
          fallback.start();
          schedule();
        } else setError(e.message);
      },
    );
    schedule();
    return () => {
      disposed = true;
      clearTimeout(timer);
      fallback.stop();
      stop();
    };
  }, [scopeKey, configured, activeRole, companyId]);
  useEffect(() => {
    const update = () => {
      setOffline(!navigator.onLine);
      if (navigator.onLine) void refreshRef.current();
      else setFresh(false);
    };
    const resume = () => {
      if (document.visibilityState === "visible") update();
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  const lifecycle = jobs
    .filter((j) => j.companyId === companyId && j.driverId === uid)
    .map((j) => `${j.id}:${j.status}:${Boolean(j.archived)}`)
    .sort()
    .join("|");
  const priorLifecycle = useRef({ scopeKey, lifecycle });
  useEffect(() => {
    const previous = priorLifecycle.current;
    priorLifecycle.current = { scopeKey, lifecycle };
    if (previous.scopeKey === scopeKey && previous.lifecycle !== lifecycle) {
      if (activeRole === "driver") {
        setFresh(false);
        void refreshRef.current(true);
      }
    }
  }, [lifecycle, activeRole, scopeKey]);
  const loadCatalog = useCallback(async () => {
    if (!current()) throw new Error("QUEUE_SESSION_CHANGED");
    if (catalogFlight.current?.scope === scopeKey)
      return catalogFlight.current.task;
    const task = collectOperationalQueuePages(
      fetchPage,
      { companyId, kind: "catalog" },
      current,
    ) as Promise<QueueCatalog>;
    const holder = { scope: scopeKey, task };
    catalogFlight.current = holder;
    try {
      const value = await task;
      if (current())
        setSettings((previous) =>
          previous && previous.revision > value.settings.revision
            ? previous
            : value.settings,
        );
      return value;
    } finally {
      if (catalogFlight.current === holder) catalogFlight.current = null;
    }
  }, [scopeKey, companyId, current, fetchPage]);
  const loadProgress = useCallback(
    async (driverId: string) =>
      collectOperationalQueuePages(
        fetchPage,
        { companyId, kind: "driver", driverId },
        current,
      ) as Promise<DriverQueueView>,
    [companyId, current, fetchPage],
  );
  const loadPreparation = useCallback(async () => {
    if (!current()) throw new Error("QUEUE_SESSION_CHANGED");
    if (!navigator.onLine) throw new Error("Conecte-se para conferir os trabalhos.");
    const result = (await readCall({ companyId, kind: "preparation" })).data;
    if (!current()) throw new Error("QUEUE_SESSION_CHANGED");
    if (!result?.success || result.version !== 1 || result.companyId !== companyId ||
        typeof result.companyId !== "string" ||
        typeof result.ready !== "boolean" || typeof result.enabled !== "boolean" ||
        !Array.isArray(result.jobs) || !Array.isArray(result.conflicts) ||
        !Array.isArray(result.invalidScopes) || typeof result.token !== "string" || !result.token)
      throw new Error("A conferência não chegou completa. Atualize para tentar novamente.");
    return result as QueuePreparationView;
  }, [companyId, current]);
  const enableOperationalCommands = useCallback(async () => {
    if (!current()) throw new Error("QUEUE_SESSION_CHANGED");
    if (!companyId) throw new Error("Selecione uma empresa antes de continuar.");
    if (!navigator.onLine)
      throw new Error("Conecte-se para habilitar os comandos operacionais.");
    const result = (await enableCommandsCall({ companyId, enable: true })).data;
    if (!current()) throw new Error("QUEUE_SESSION_CHANGED");
    if (
      !result?.success ||
      result.version !== 1 ||
      result.companyId !== companyId ||
      result.ready !== true ||
      result.enabled !== true
    )
      throw new Error(
        "O servidor não confirmou a habilitação dos comandos operacionais.",
      );
    return result;
  }, [companyId, current]);
  const save = useCallback(
    async (input: Omit<QueueMutation, "companyId">) => {
      if (!navigator.onLine)
        throw new Error("Conecte-se para salvar esta configuração.");
      const result = await mutationClient.execute({
        ...input,
        companyId,
      } as QueueMutation);
      if (!current()) throw new Error("QUEUE_SESSION_CHANGED");
      setSettings((previous) =>
        previous && previous.revision > result.settings.revision
          ? previous
          : result.settings,
      );
      // The mutation ACK includes authoritative settings. Revalidation must
      // not delay closing the editor or its confirmed feedback.
      void refreshRef.current();
      return result;
    },
    [companyId, current],
  );
  const sameScope = publishedScope.current === scopeKey;
  const value = useMemo(
    () => ({
      scopeKey,
      settings: sameScope ? settings : null,
      view: sameScope ? view : null,
      loading,
      error: sameScope ? error : null,
      offline,
      fresh: sameScope && fresh,
      offlineAvailable: sameScope && offlineAvailable,
      localCommandPending: jobs.some(job => job.companyId === companyId && job.driverId === uid &&
        ["pending_start", "pending_finish", "start_rejected"].includes(job.operationSyncState || "")),
      refresh,
      loadCatalog,
      loadProgress,
      loadPreparation,
      enableOperationalCommands,
      save,
    }),
    [
      sameScope,
      scopeKey,
      settings,
      view,
      loading,
      error,
      offline,
      fresh,
      offlineAvailable,
      jobs,
      companyId,
      uid,
      refresh,
      loadCatalog,
      loadProgress,
      loadPreparation,
      enableOperationalCommands,
      save,
    ],
  );
  return (
    <AutomaticOperationsContext.Provider value={value}>
      {children}
    </AutomaticOperationsContext.Provider>
  );
}
