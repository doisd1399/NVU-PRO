export type NotificationTargetProfile = "driver" | "corporate";

export interface NotificationScopeRecord {
  userId?: string;
  companyId?: string | null;
  dedupeKey?: string | null;
  targetProfile?: NotificationTargetProfile;
  type?: string;
  tipo?: string;
  title?: string;
  titulo?: string;
  message?: string;
  mensagem?: string;
  read?: boolean;
  lida?: boolean;
  createdAt?: unknown;
  createdAtIso?: string;
  dataHora?: unknown;
  data?: unknown;
  popupShownAt?: unknown;
  popupShownAtIso?: string;
}

export function resolveActiveNotificationProfile(
  activeRole: string | null | undefined,
): NotificationTargetProfile | null {
  if (activeRole === "driver") return "driver";
  if (activeRole === "admin") return "corporate";
  return null;
}

export function inferNotificationTargetProfile(
  notification: NotificationScopeRecord,
): NotificationTargetProfile {
  if (
    notification.targetProfile === "driver" ||
    notification.targetProfile === "corporate"
  ) {
    return notification.targetProfile;
  }

  switch (notification.type) {
    case "NEW_OPERATION":
    case "DRIVER_REQUEST_APPROVED":
    case "DRIVER_REQUEST_REJECTED":
    case "JOB_REQUEST_REJECTED":
    case "RECRUITMENT_APPROVED":
    case "RECRUITMENT_REJECTED":
      return "driver";
    case "RH_APPLICATION":
    case "WORK_REQUEST":
    case "OPERATION_COMPLETED":
    case "COMPANY_APPROVED":
    case "COMPANY_REJECTED":
      return "corporate";
  }

  switch (notification.tipo) {
    case "solicitacao":
    case "admin":
      return "corporate";
    case "approved":
    case "rejected":
      return "driver";
  }

  return "driver";
}

function timestampFromValue(value: unknown): number {
  if (!value) return 0;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  if (typeof value === "object") {
    const timestamp = value as {
      toMillis?: () => number;
      toDate?: () => Date;
      seconds?: number;
      nanoseconds?: number;
    };

    if (typeof timestamp.toMillis === "function") {
      const millis = timestamp.toMillis();
      return Number.isFinite(millis) ? millis : 0;
    }

    if (typeof timestamp.toDate === "function") {
      const millis = timestamp.toDate().getTime();
      return Number.isFinite(millis) ? millis : 0;
    }

    if (typeof timestamp.seconds === "number") {
      return timestamp.seconds * 1000;
    }
  }

  return 0;
}

export function notificationTimestampMs(
  notification: NotificationScopeRecord,
): number {
  return (
    timestampFromValue(notification.createdAt) ||
    timestampFromValue(notification.createdAtIso) ||
    timestampFromValue(notification.dataHora) ||
    timestampFromValue(notification.data)
  );
}

export function notificationIdentity(
  notification: NotificationScopeRecord,
  documentId: string,
): string {
  const dedupeKey =
    typeof notification.dedupeKey === "string"
      ? notification.dedupeKey.trim()
      : "";

  if (dedupeKey) {
    return `event:${notification.userId ?? "unknown"}:${dedupeKey}`;
  }

  return `document:${documentId}`;
}

export function notificationPopupWasShown(
  notification: NotificationScopeRecord,
): boolean {
  return Boolean(
    timestampFromValue(notification.popupShownAt) ||
      timestampFromValue(notification.popupShownAtIso),
  );
}


export function isOperationalNotificationRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/driver") ||
    pathname === "/ranking" || pathname.endsWith("/ranking")
  );
}

export function shouldDisplayNotificationPopup(
  notification: NotificationScopeRecord,
  params: {
    pathname: string;
    now?: number;
    maxAgeMs?: number;
  },
): boolean {
  if (notification.read ?? notification.lida ?? false) return false;
  if (notificationPopupWasShown(notification)) return false;
  if (!isOperationalNotificationRoute(params.pathname)) return false;

  const createdAtMs = notificationTimestampMs(notification);
  if (!createdAtMs) return false;

  const now = params.now ?? Date.now();
  const maxAgeMs = params.maxAgeMs ?? 60_000;
  return now >= createdAtMs && now - createdAtMs <= maxAgeMs;
}

export function isNotificationVisibleForContext(
  notification: NotificationScopeRecord,
  params: {
    userId: string;
    activeRole: string | null | undefined;
    activeCompanyId: string | null | undefined;
  },
): boolean {
  if (!notification.userId || notification.userId !== params.userId) {
    return false;
  }

  const activeProfile = resolveActiveNotificationProfile(params.activeRole);
  if (!activeProfile) return false;

  const targetProfile = inferNotificationTargetProfile(notification);
  if (targetProfile !== activeProfile) {
    return false;
  }

  // Uma notificação vinculada a empresa só pertence ao contexto quando a
  // empresa ativa já foi escolhida e coincide com o documento.
  if (notification.companyId) {
    if (!params.activeCompanyId) return false;
    if (notification.companyId !== params.activeCompanyId) return false;
  }

  return true;
}

export function normalizeNotificationForUi<T extends NotificationScopeRecord>(
  id: string,
  notification: T,
) {
  const title = notification.title ?? notification.titulo ?? "Notificação";
  const message = notification.message ?? notification.mensagem ?? "";
  const read = notification.read ?? notification.lida ?? false;
  const type = notification.type ?? notification.tipo ?? "SYSTEM";
  const legacyCreatedAtIso =
    typeof notification.createdAtIso === "string"
      ? notification.createdAtIso
      : typeof notification.dataHora === "string"
        ? notification.dataHora
        : typeof notification.data === "string"
          ? notification.data
          : undefined;

  return {
    ...notification,
    id,
    title,
    titulo: title,
    message,
    mensagem: message,
    read,
    lida: read,
    type,
    tipo: type,
    createdAtIso: legacyCreatedAtIso,
    targetProfile: inferNotificationTargetProfile(notification),
  };
}
