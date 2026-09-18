import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { legacyNotificationCompatibility } from "../config/legacyNotifications";
import { auth, db } from "../lib/firebase";
import type { NotificationTargetProfile } from "../lib/notificationScope";

export const NOTIFICATION_CREATED_EVENT = "nvu-notification-created";

export type NotificationType =
  | "NEW_OPERATION"
  | "RH_APPLICATION"
  | "WORK_REQUEST"
  | "OPERATION_COMPLETED"
  | "DRIVER_REQUEST_APPROVED"
  | "DRIVER_REQUEST_REJECTED"
  | "JOB_REQUEST_REJECTED"
  | "COMPANY_APPROVED"
  | "COMPANY_REJECTED"
  | "RECRUITMENT_APPROVED"
  | "RECRUITMENT_REJECTED"
  | "TRIP_DELETED"
  | "DRIVER_SUSPENDED"
  | "SYSTEM";

export interface AppNotification {
  id?: string;
  userId: string;
  companyId?: string;
  type: NotificationType;
  title: string;
  message: string;
  targetProfile: NotificationTargetProfile;
  read?: boolean;
  metadata?: Record<string, unknown>;
  /** Chave opcional para evitar duplicação do mesmo evento para o mesmo usuário. */
  dedupeKey?: string;
}

export interface CorporateNotificationInput {
  companyId: string;
  type: Exclude<NotificationType, "NEW_OPERATION">;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
}

function safeDocumentId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 1400);
}

export function buildNotificationPayload(notification: AppNotification) {
  const isRead = notification.read ?? false;
  return {
    userId: notification.userId,
    companyId: notification.companyId ?? null,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    targetProfile: notification.targetProfile,
    metadata: notification.metadata ?? null,
    titulo: notification.title,
    mensagem: notification.message,
    tipo: notification.type,
    lida: isRead,
    actorUserId: auth.currentUser?.uid ?? null,
    read: isRead,
    dedupeKey: notification.dedupeKey ?? null,
    schemaVersion: 3,
    createdAt: serverTimestamp(),
    createdAtIso: new Date().toISOString(),
  };
}

export function shouldFallbackToLegacyNotification(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "").toLowerCase();
  return code === "permission-denied" || code === "firestore/permission-denied";
}

export async function persistNotificationWithFallback<T>(params: {
  writeModern: () => Promise<T>;
  writeLegacy: () => Promise<T>;
  legacyFallbackEnabled?: boolean;
  onModernError?: (error: unknown) => void;
}) {
  try {
    return await params.writeModern();
  } catch (error) {
    // Um timeout ou erro de rede pode ocorrer depois que o Firestore já
    // confirmou a escrita no servidor. Gravar também no legado nesse cenário
    // criaria dois documentos e dois gatilhos para o mesmo evento. O fallback
    // só é seguro quando a coleção moderna foi explicitamente bloqueada.
    if (
      !shouldFallbackToLegacyNotification(error) ||
      params.legacyFallbackEnabled === false
    ) {
      throw error;
    }
    params.onModernError?.(error);
    return params.writeLegacy();
  }
}

export async function createNotification(notification: AppNotification) {
  const { dedupeKey } = notification;
  const payload = buildNotificationPayload(notification);

  const notificationId = dedupeKey
    ? safeDocumentId(`${notification.userId}_${dedupeKey}`)
    : doc(collection(db, "notifications")).id;
  const modernRef = doc(db, "notifications", notificationId);

  const legacyRef = doc(db, "notificacoes", notificationId);
  const persistedRef = await persistNotificationWithFallback({
    legacyFallbackEnabled: legacyNotificationCompatibility.writeFallback,
    writeModern: async () => {
      await setDoc(modernRef, payload, { merge: true });
      return modernRef;
    },
    writeLegacy: async () => {
      await setDoc(legacyRef, payload, { merge: true });
      return legacyRef;
    },
    onModernError: (modernCollectionError) => {
      // Algumas instalações antigas têm regra liberada somente para
      // `notificacoes`. O fallback usa o mesmo ID para não duplicar o aviso.
      console.warn(
        "[NVU Notifications] Coleção moderna indisponível; usando legado.",
        modernCollectionError,
      );
    },
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(NOTIFICATION_CREATED_EVENT, {
        detail: {
          ...notification,
          ...payload,
          id: persistedRef.id,
          sourceCollection: persistedRef.parent.id,
        },
      }),
    );
  }

  return persistedRef;
}

export async function resolveCorporateRecipientIds(companyId: string) {
  const recipientIds = new Set<string>();

  const companySnapshot = await getDoc(doc(db, "frotas", companyId));
  if (companySnapshot.exists()) {
    const company = companySnapshot.data();
    if (typeof company.ownerId === "string" && company.ownerId) {
      recipientIds.add(company.ownerId);
    }
    if (typeof company.userId === "string" && company.userId) {
      recipientIds.add(company.userId);
    }
  }

  const membersSnapshot = await getDocs(
    query(collection(db, "companyMembers"), where("companyId", "==", companyId)),
  );

  membersSnapshot.docs.forEach((memberDocument) => {
    const member = memberDocument.data();
    const roles = Array.isArray(member.roles) ? member.roles : [];
    const isActive = member.status === "active" || member.status == null;
    if (
      isActive &&
      roles.includes("admin") &&
      typeof member.userId === "string" &&
      member.userId
    ) {
      recipientIds.add(member.userId);
    }
  });

  return Array.from(recipientIds);
}

export async function createCorporateNotifications(
  notification: CorporateNotificationInput,
) {
  const recipientIds = await resolveCorporateRecipientIds(notification.companyId);

  await Promise.all(
    recipientIds.map((userId) =>
      createNotification({
        userId,
        companyId: notification.companyId,
        targetProfile: "corporate",
        type: notification.type,
        title: notification.title,
        message: notification.message,
        metadata: notification.metadata,
        dedupeKey: notification.dedupeKey
          ? `${notification.dedupeKey}_${userId}`
          : undefined,
      }),
    ),
  );

  return recipientIds;
}


export async function resolveNotifications(params: {
  companyId?: string | null;
  type: NotificationType;
  metadata?: Record<string, unknown>;
}) {
  const collections = legacyNotificationCompatibility.resolveLegacy
    ? (["notifications", "notificacoes"] as const)
    : (["notifications"] as const);
  const resolvedAtIso = new Date().toISOString();

  await Promise.all(
    collections.map(async (collectionName) => {
      try {
        const constraints = [where("type", "==", params.type)];
        if (params.companyId) {
          constraints.push(where("companyId", "==", params.companyId));
        }
        const snapshot = await getDocs(
          query(collection(db, collectionName), ...constraints),
        );

        const matchingDocuments = snapshot.docs.filter((notificationDocument) => {
          if (!params.metadata) return true;
          const notificationMetadata = notificationDocument.data().metadata;
          if (!notificationMetadata || typeof notificationMetadata !== "object") {
            return false;
          }
          return Object.entries(params.metadata).every(
            ([key, value]) =>
              value === undefined ||
              (notificationMetadata as Record<string, unknown>)[key] === value,
          );
        });

        await Promise.all(
          matchingDocuments.map((notificationDocument) =>
            updateDoc(notificationDocument.ref, {
              read: true,
              lida: true,
              resolvedAt: serverTimestamp(),
              resolvedAtIso,
            }),
          ),
        );
      } catch (error) {
        console.warn(
          `[NVU Notifications] Não foi possível resolver avisos em ${collectionName}.`,
          error,
        );
      }
    }),
  );
}
