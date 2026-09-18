import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { useSessionStore } from "../context/AppContext";
import { useNotificationStore } from "../context/NotificationsContext";
import { shouldDisplayNotificationPopup } from "../lib/notificationScope";

const MAX_POPUP_AGE_MS = 60_000;

export default function NotificationToastListener() {
  const { currentUser, activeRole, activeCompanyId } = useSessionStore();
  const {
    notifications,
    notificationsHydrated,
    markNotificationAsRead,
    markNotificationPopupShown,
  } = useNotificationStore();
  const location = useLocation();
  const seen = useRef(new Set<string>());
  const baselineReady = useRef(false);
  const scopeKeyRef = useRef("");

  useEffect(() => {
    const scopeKey = `${currentUser?.id ?? ""}:${activeRole ?? ""}:${activeCompanyId ?? ""}`;

    if (scopeKeyRef.current !== scopeKey) {
      scopeKeyRef.current = scopeKey;
      seen.current.clear();
      baselineReady.current = false;
    }

    if (!notificationsHydrated) return;

    // O primeiro snapshot de cada usuário/perfil/empresa apenas hidrata o sino.
    // Nada que já existia ao abrir a sessão deve surgir como popup repentino.
    if (!baselineReady.current) {
      notifications.forEach((notification) => {
        if (notification.id) seen.current.add(notification.id);
      });
      baselineReady.current = true;
      return;
    }

    const now = Date.now();

    notifications.forEach((notification) => {
      if (!notification.id || seen.current.has(notification.id)) return;
      seen.current.add(notification.id);

      const shouldDisplay = shouldDisplayNotificationPopup(notification, {
        pathname: location.pathname,
        now,
        maxAgeMs: MAX_POPUP_AGE_MS,
      });

      // Em login, seletor de perfil, status e formulários públicos o aviso não
      // deve aparecer depois ao entrar no painel. Ele continua não lido no sino.
      if (!shouldDisplay) {
        if (!notification.lida && !notification.read) {
          void markNotificationPopupShown(notification.id);
        }
        return;
      }

      void markNotificationPopupShown(notification.id);

      const title = notification.title ?? notification.titulo ?? "Nova notificação";
      const message = notification.message ?? notification.mensagem ?? "";

      toast(title, {
        description: message,
        duration: 8000,
        closeButton: true,
        action: {
          label: "Ver",
          onClick: () => {
            void markNotificationAsRead(notification.id);
            window.dispatchEvent(
              new CustomEvent("nvu-notification-open", {
                detail: notification,
              }),
            );
          },
        },
      });
    });
  }, [
    activeCompanyId,
    activeRole,
    currentUser?.id,
    location.pathname,
    markNotificationAsRead,
    markNotificationPopupShown,
    notifications,
    notificationsHydrated,
  ]);

  return null;
}
