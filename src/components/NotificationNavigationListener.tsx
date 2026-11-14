import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionStore } from "../context/AppContext";
import { notificationDestination } from "../lib/notificationNavigation";
import { isAuthTeardownActive } from "../lib/authLifecycle";

export default function NotificationNavigationListener() {
  const { currentUser, activeCompanyId, activeRole, switchRole } = useSessionStore();
  const navigate = useNavigate();
  const version = useRef(0);
  const companyRef = useRef(activeCompanyId);
  companyRef.current = activeCompanyId;
  const [pending, setPending] = useState<(NonNullable<ReturnType<typeof notificationDestination>> & { userId: string }) | null>(null);
  useEffect(() => {
    ++version.current;
    setPending(null);
    const open = async (event: Event) => {
      if (isAuthTeardownActive()) return;
      const epoch = ++version.current;
      const detail = (event as CustomEvent).detail;
      const record = detail?.notification?.data || detail;
      const userId = currentUser?.id || "";
      const target = notificationDestination(record, userId);
      if (!target) return;
      const requested = { ...target, companyId: target.companyId || companyRef.current || "", userId };
      if (!requested.companyId) return;
      try {
        await switchRole(requested.role, requested.companyId);
        if (version.current === epoch && !isAuthTeardownActive()) setPending(requested);
      } catch { /* Keep the existing authorized context on failure. */ }
    };
    window.addEventListener("nvu-notification-open", open);
    window.addEventListener("nvu-push-opened", open);
    return () => {
      version.current++;
      window.removeEventListener("nvu-notification-open", open);
      window.removeEventListener("nvu-push-opened", open);
    };
  }, [currentUser?.id, switchRole]);
  useEffect(() => {
    if (!pending || pending.userId !== currentUser?.id || activeCompanyId !== pending.companyId || activeRole !== pending.role) return;
    navigate(pending.path, pending.activeTab ? { state: { activeTab: pending.activeTab } } : undefined);
    setPending(null);
  }, [pending, currentUser?.id, activeRole, activeCompanyId, navigate]);
  return null;
}
