import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
  type QuerySnapshot,
} from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { legacyNotificationCompatibility } from "../config/legacyNotifications";
import { NOTIFICATION_CREATED_EVENT } from "../services/notificationService";
import { isAuthTeardownActive } from "../lib/authLifecycle";
import {
  isNotificationVisibleForContext,
  normalizeNotificationForUi,
  notificationIdentity,
  notificationTimestampMs,
} from "../lib/notificationScope";

export interface AppNotification {
  id: string;
  userId: string;
  companyId?: string | null;
  targetProfile?: "driver" | "corporate";
  titulo: string;
  title?: string;
  mensagem: string;
  message?: string;
  tipo: string;
  type?: string;
  lida: boolean;
  read?: boolean;
  createdAt?: unknown;
  createdAtIso?: string;
  dataHora?: unknown;
  data?: unknown;
  popupShownAt?: unknown;
  popupShownAtIso?: string;
  dedupeKey?: string | null;
  metadata?: Record<string, unknown>;
  sourceCollection?: "notifications" | "notificacoes";
}

export interface NotificationStoreType {
  notifications: AppNotification[];
  notificationsHydrated: boolean;
  markNotificationAsRead: (notificationId: string) => Promise<void>;
  markNotificationPopupShown: (notificationId: string) => Promise<void>;
}

interface NotificationsProviderProps {
  children: ReactNode;
  userId: string | null;
  activeRole: "admin" | "driver" | null;
  activeCompanyId: string | null;
  enabled: boolean;
}

const MAX_LIVE_NOTIFICATIONS = 200;
const MAX_LEGACY_NOTIFICATIONS = 120;
const MAX_RECENT_LEGACY_NOTIFICATIONS = 50;

type NotificationCollection = "notifications" | "notificacoes";

const NotificationStoreContext = createContext<NotificationStoreType | undefined>(
  undefined,
);

export const NotificationsProvider: React.FC<NotificationsProviderProps> = ({
  children,
  userId,
  activeRole,
  activeCompanyId,
  enabled,
}) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const notificationsRef = useRef<AppNotification[]>([]);
  const [notificationsHydrated, setNotificationsHydrated] = useState(false);
  const [legacyHistoryDemanded, setLegacyHistoryDemanded] = useState(false);
  const notificationScopeRef = useRef<string | null>(null);
  const subscriptionGenerationRef = useRef(0);

  useEffect(() => {
    const requestLegacyNotificationHistory = () => {
      setLegacyHistoryDemanded(true);
    };
    window.addEventListener(
      "nvu-notifications-demand",
      requestLegacyNotificationHistory,
    );
    return () =>
      window.removeEventListener(
        "nvu-notifications-demand",
        requestLegacyNotificationHistory,
      );
  }, []);

  const replaceNotifications = useCallback((next: AppNotification[]) => {
    notificationsRef.current = next;
    setNotifications(next);
  }, []);

  useEffect(() => {
    const generation = ++subscriptionGenerationRef.current;
    const canPublish = () =>
      subscriptionGenerationRef.current === generation &&
      Boolean(userId) &&
      auth.currentUser?.uid === userId &&
      !isAuthTeardownActive();

    const notificationScope = `${userId ?? ""}:${activeRole ?? ""}:${activeCompanyId ?? ""}`;
    const sameScope = notificationScopeRef.current === notificationScope;
    notificationScopeRef.current = notificationScope;
    // Preserve the current snapshot while the same scope is merely re-subscribed
    // (for example, when legacy history is demanded). A real account/role/company
    // change still clears it immediately to avoid cross-scope data leakage.
    if (!sameScope) replaceNotifications([]);

    if (!userId) {
      setNotificationsHydrated(false);
      return;
    }

    if (!enabled) {
      setNotificationsHydrated(true);
      return;
    }

    setNotificationsHydrated(false);

    const sourceSnapshots = new Map<NotificationCollection, AppNotification[]>();
    const localNotifications = new Map<string, AppNotification>();
    const initializedSources = new Set<NotificationCollection>();
    const legacyHistoryEnabled =
      legacyNotificationCompatibility.readHistory && legacyHistoryDemanded;
    const legacySourceEnabled =
      legacyHistoryEnabled || legacyNotificationCompatibility.listenRealtime;
    const requiredSources = new Set<NotificationCollection>(["notifications"]);
    if (legacySourceEnabled) requiredSources.add("notificacoes");

    const normalizeDocuments = (
      collectionName: NotificationCollection,
      documents: Array<{ id: string; data: () => Record<string, unknown> }>,
    ) =>
      documents.map((notificationDocument) => {
        const normalized = normalizeNotificationForUi(
          notificationDocument.id,
          notificationDocument.data(),
        );
        return {
          ...normalized,
          sourceCollection: collectionName,
        } as AppNotification;
      });

    const publishNotifications = () => {
      if (!canPublish()) return;

      const byLogicalIdentity = new Map<string, AppNotification>();
      // A escrita local é uma aceleração de UI; qualquer snapshot confirmado
      // do Firestore prevalece quando o mesmo evento já foi refletido no servidor.
      for (const notification of localNotifications.values()) {
        byLogicalIdentity.set(
          notificationIdentity(notification, notification.id),
          notification,
        );
      }
      // A coleção moderna sempre prevalece quando o mesmo evento existe nas
      // duas estruturas de compatibilidade.
      for (const source of ["notificacoes", "notifications"] as const) {
        for (const notification of sourceSnapshots.get(source) ?? []) {
          byLogicalIdentity.set(
            notificationIdentity(notification, notification.id),
            notification,
          );
        }
      }

      const merged = Array.from(byLogicalIdentity.values())
        .filter((notification) =>
          isNotificationVisibleForContext(notification, {
            userId,
            activeRole,
            activeCompanyId,
          }),
        )
        .sort(
          (a, b) => notificationTimestampMs(b) - notificationTimestampMs(a),
        );

      replaceNotifications(merged);
    };

    const handleLocalNotification = (event: Event) => {
      if (!canPublish()) return;
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (!detail || detail.userId !== userId) return;
      const normalized = {
        ...normalizeNotificationForUi(
          String(detail.id || "").trim(),
          detail,
        ),
        userId: String(detail.userId),
      } as AppNotification;
      if (!normalized.id) return;
      if (!isNotificationVisibleForContext(normalized, {
        userId,
        activeRole,
        activeCompanyId,
      })) return;
      localNotifications.set(normalized.id, normalized);
      publishNotifications();
    };

    window.addEventListener(NOTIFICATION_CREATED_EVENT, handleLocalNotification);

    const markSourceInitialized = (source: NotificationCollection) => {
      initializedSources.add(source);
      const allRequiredSourcesInitialized = Array.from(requiredSources).every(
        (requiredSource) => initializedSources.has(requiredSource),
      );
      if (allRequiredSourcesInitialized && canPublish()) {
        setNotificationsHydrated(true);
      }
    };

    const publishModernSnapshot = (snap: QuerySnapshot<DocumentData>) => {
      if (!canPublish()) return;
      sourceSnapshots.set(
        "notifications",
        normalizeDocuments("notifications", snap.docs),
      );
      publishNotifications();
      markSourceInitialized("notifications");
    };

    let unsubscribeModernFallback: () => void = () => {};
    let modernFallbackStarted = false;
    const unsubscribeModern = onSnapshot(
      query(
        collection(db, "notifications"),
        where("userId", "==", userId),
        where("read", "==", false),
        limit(MAX_LIVE_NOTIFICATIONS),
      ),
      publishModernSnapshot,
      (error) => {
        if (modernFallbackStarted || !canPublish()) return;
        modernFallbackStarted = true;
        console.warn(
          "[NVU Notifications] Consulta otimizada indisponível; usando fallback limitado.",
          error,
        );
        unsubscribeModernFallback = onSnapshot(
          query(
            collection(db, "notifications"),
            where("userId", "==", userId),
            limit(MAX_LIVE_NOTIFICATIONS),
          ),
          publishModernSnapshot,
          (fallbackError) => {
            if (canPublish()) {
              console.error(
                "[NVU Notifications] Falha ao ler notifications:",
                fallbackError,
              );
              markSourceInitialized("notifications");
            }
          },
        );
      },
    );

    let unsubscribeLegacyLive: () => void = () => {};

    if (legacySourceEnabled) {
      let legacyHistoryNotifications: AppNotification[] = [];
      const liveLegacyNotifications = new Map<string, AppNotification>();

      const mergeLegacyNotifications = () => {
        const merged = new Map<string, AppNotification>();
        legacyHistoryNotifications.forEach((notification) =>
          merged.set(notification.id, notification),
        );
        liveLegacyNotifications.forEach((notification, id) =>
          merged.set(id, notification),
        );
        sourceSnapshots.set("notificacoes", Array.from(merged.values()));
        publishNotifications();
      };

      if (legacyHistoryEnabled) {
        const legacyHistoryQuery = query(
          collection(db, "notificacoes"),
          where("userId", "==", userId),
          where("lida", "==", false),
          limit(MAX_LEGACY_NOTIFICATIONS),
        );
        const legacyHistoryFallbackQuery = query(
          collection(db, "notificacoes"),
          where("userId", "==", userId),
          limit(MAX_LEGACY_NOTIFICATIONS),
        );

        const hydrateLegacyHistory = async () => {
          try {
            let snap: QuerySnapshot<DocumentData>;
            try {
              snap = await getDocs(legacyHistoryQuery);
            } catch (optimizedError) {
              console.warn(
                "[NVU Notifications] Consulta legada otimizada indisponível; usando fallback limitado.",
                optimizedError,
              );
              snap = await getDocs(legacyHistoryFallbackQuery);
            }

            if (!canPublish()) return;
            legacyHistoryNotifications = normalizeDocuments(
              "notificacoes",
              snap.docs,
            );
            mergeLegacyNotifications();
            markSourceInitialized("notificacoes");
          } catch (error) {
            if (canPublish()) {
              console.warn(
                "[NVU Notifications] Falha ao hidratar histórico legado:",
                error,
              );
              legacyHistoryNotifications = [];
              mergeLegacyNotifications();
              markSourceInitialized("notificacoes");
            }
          }
        };
        void hydrateLegacyHistory();
      }

      if (legacyNotificationCompatibility.listenRealtime) {
        const legacyLiveStartAt = new Date(Date.now() - 5_000);
        const legacyLiveQuery = query(
          collection(db, "notificacoes"),
          where("userId", "==", userId),
          where("createdAt", ">=", legacyLiveStartAt),
          limit(MAX_RECENT_LEGACY_NOTIFICATIONS),
        );

        unsubscribeLegacyLive = onSnapshot(
          legacyLiveQuery,
          (snap) => {
            if (!canPublish()) return;
            liveLegacyNotifications.clear();
            normalizeDocuments("notificacoes", snap.docs).forEach((notification) =>
              liveLegacyNotifications.set(notification.id, notification),
            );
            mergeLegacyNotifications();
            if (!legacyNotificationCompatibility.readHistory) {
              markSourceInitialized("notificacoes");
            }
          },
          (error) => {
            if (canPublish()) {
              console.warn(
                "[NVU Notifications] Realtime legado recente indisponível:",
                error,
              );
              if (!legacyNotificationCompatibility.readHistory) {
                markSourceInitialized("notificacoes");
              }
            }
          },
        );
      }
    }

    return () => {
      window.removeEventListener(NOTIFICATION_CREATED_EVENT, handleLocalNotification);
      unsubscribeModern();
      unsubscribeModernFallback();
      unsubscribeLegacyLive();
    };
  }, [
    activeCompanyId,
    activeRole,
    enabled,
    legacyHistoryDemanded,
    replaceNotifications,
    userId,
  ]);

  const markNotificationAsRead = useCallback(
    async (notificationId: string) => {
      const notification = notificationsRef.current.find(
        (item) => item.id === notificationId,
      );
      if (!notification || !userId || auth.currentUser?.uid !== userId) return;

      setNotifications((current) => {
        const next = current.map((item) =>
          item.id === notificationId
            ? { ...item, read: true, lida: true }
            : item,
        );
        notificationsRef.current = next;
        return next;
      });

      try {
        const sourceCollection = notification.sourceCollection ?? "notifications";
        await updateDoc(doc(db, sourceCollection, notificationId), {
          read: true,
          lida: true,
        });
      } catch (error) {
        console.warn("[NVU Notifications] Falha ao marcar como lida:", error);
      }
    },
    [userId],
  );

  const markNotificationPopupShown = useCallback(
    async (notificationId: string) => {
      const notification = notificationsRef.current.find(
        (item) => item.id === notificationId,
      );
      if (
        !notification ||
        notification.popupShownAt ||
        notification.popupShownAtIso ||
        !userId ||
        auth.currentUser?.uid !== userId
      ) {
        return;
      }

      const popupShownAtIso = new Date().toISOString();
      setNotifications((current) => {
        const next = current.map((item) =>
          item.id === notificationId ? { ...item, popupShownAtIso } : item,
        );
        notificationsRef.current = next;
        return next;
      });

      try {
        const sourceCollection = notification.sourceCollection ?? "notifications";
        await updateDoc(doc(db, sourceCollection, notificationId), {
          popupShownAt: serverTimestamp(),
          popupShownAtIso,
        });
      } catch (error) {
        console.warn(
          "[NVU Notifications] Falha ao persistir popup exibido:",
          error,
        );
      }
    },
    [userId],
  );

  const value = useMemo<NotificationStoreType>(
    () => ({
      notifications,
      notificationsHydrated,
      markNotificationAsRead,
      markNotificationPopupShown,
    }),
    [
      markNotificationAsRead,
      markNotificationPopupShown,
      notifications,
      notificationsHydrated,
    ],
  );

  return (
    <NotificationStoreContext.Provider value={value}>
      {children}
    </NotificationStoreContext.Provider>
  );
};

export const useNotificationStore = () => {
  const context = useContext(NotificationStoreContext);
  if (!context) {
    throw new Error("useNotificationStore must be used within NotificationsProvider");
  }
  return context;
};
