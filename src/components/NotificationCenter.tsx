import React from "react";
import {
  Bell,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  Inbox,
  UserRoundPlus,
  ShieldAlert,
} from "lucide-react";
import type { AppNotification } from "../context/NotificationsContext";
import { notificationTimestampMs } from "../lib/notificationScope";

interface NotificationCenterProps {
  notifications: AppNotification[];
  onRead: (notificationId: string) => Promise<void> | void;
  onOpen: (notification: AppNotification) => void;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  buttonClassName?: string;
}

type NotificationGroup = {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  types: string[];
};

const GROUPS: NotificationGroup[] = [
  {
    id: "work",
    label: "Solicitações de trabalho",
    icon: BriefcaseBusiness,
    types: ["WORK_REQUEST"],
  },
  {
    id: "completed",
    label: "Operações finalizadas",
    icon: CheckCircle2,
    types: ["OPERATION_COMPLETED"],
  },
  {
    id: "recruitment",
    label: "Inscrições do RH",
    icon: UserRoundPlus,
    types: ["RH_APPLICATION"],
  },
  {
    id: "moderation",
    label: "Moderação operacional",
    icon: ShieldAlert,
    types: ["TRIP_DELETED", "DRIVER_SUSPENDED"],
  },
  {
    id: "other",
    label: "Outras notificações",
    icon: Inbox,
    types: [],
  },
];

function notificationType(notification: AppNotification) {
  return notification.type ?? notification.tipo ?? "SYSTEM";
}

function formatNotificationDate(notification: AppNotification) {
  const timestamp = notificationTimestampMs(notification);
  if (!timestamp) return "Agora";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function NotificationCenter({
  notifications,
  onRead,
  onOpen,
  isOpen,
  onToggle,
  onClose,
  buttonClassName,
}: NotificationCenterProps) {
  const unread = React.useMemo(
    () =>
      notifications
        .filter((notification) => !(notification.read ?? notification.lida))
        .sort(
          (a, b) => notificationTimestampMs(b) - notificationTimestampMs(a),
        ),
    [notifications],
  );

  const grouped = React.useMemo(() => {
    const knownTypes = new Set(GROUPS.flatMap((group) => group.types));
    return GROUPS.map((group) => ({
      ...group,
      items: unread.filter((notification) => {
        const type = notificationType(notification);
        return group.id === "other"
          ? !knownTypes.has(type)
          : group.types.includes(type);
      }),
    })).filter((group) => group.items.length > 0);
  }, [unread]);

  return (
    <div className="relative">
      <button
        onClick={() => {
          if (!isOpen && typeof window !== "undefined") {
            window.dispatchEvent(new Event("nvu-notifications-demand"));
          }
          onToggle();
        }}
        aria-label="Abrir notificações"
        className={`nvu-notification-trigger ${buttonClassName ?? "relative p-2 rounded-lg transition-colors"}`}
      >
        <Bell size={20} />
        {unread.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white dark:border-[#09090b]">
            {unread.length > 99 ? "99+" : unread.length}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <button
            aria-label="Fechar notificações"
            className="fixed inset-0 z-40 cursor-default"
            onClick={onClose}
          />
          <div className="nvu-notification-panel fixed left-3 right-3 top-[72px] z-50 max-h-[calc(100dvh-88px)] overflow-hidden rounded-2xl border border-gray-200/80 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#111113]/95 sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[390px] sm:max-h-[72vh]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-white/10">
              <div>
                <h3 className="text-sm font-bold text-gray-950 dark:text-white">Notificações</h3>
                <p className="text-[11px] text-gray-500 dark:text-zinc-400">
                  {unread.length} {unread.length === 1 ? "pendente" : "pendentes"}
                </p>
              </div>
              <Bell data-nvu-notification-card-icon size={17} className="nvu-notification-card-icon text-slate-700 dark:text-zinc-200" />
            </div>

            <div className="max-h-[calc(100dvh-154px)] overflow-y-auto overscroll-contain p-3 space-y-4 sm:max-h-[calc(72vh-66px)]">
              {grouped.length > 0 ? (
                grouped.map((group) => {
                  const GroupIcon = group.icon;
                  return (
                    <section key={group.id}>
                      <div className="flex items-center gap-2 px-1 mb-2">
                        <GroupIcon data-nvu-notification-card-icon size={14} className="nvu-notification-card-icon text-slate-700 dark:text-zinc-200" />
                        <h4 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-zinc-400">
                          {group.label}
                        </h4>
                        <span className="ml-auto text-[10px] font-semibold text-gray-400">
                          {group.items.length}
                        </span>
                      </div>

                      <div className="space-y-2">
                        {group.items.map((notification) => (
                          <button
                            key={`${notification.sourceCollection ?? "notifications"}:${notification.id}`}
                            className="w-full rounded-xl border border-gray-200/80 bg-gray-50/80 p-3 text-left transition hover:border-gray-300 hover:bg-white hover:shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.07]"
                            onClick={() => {
                              void onRead(notification.id);
                              onClose();
                              onOpen(notification);
                            }}
                          >
                            <div className="flex items-start gap-3">
                              <div className="mt-0.5 h-8 w-8 shrink-0 rounded-lg bg-white border border-gray-200 flex items-center justify-center dark:bg-white/[0.06] dark:border-white/10">
                                <GroupIcon data-nvu-notification-card-icon size={16} className="nvu-notification-card-icon text-slate-700 dark:text-zinc-200" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] leading-4 font-bold text-gray-950 dark:text-white">
                                  {notification.title ?? notification.titulo}
                                </p>
                                <p className="mt-1 text-[12px] leading-4 text-gray-600 dark:text-zinc-300">
                                  {notification.message ?? notification.mensagem}
                                </p>
                                <div className="mt-2 flex items-center gap-1.5 text-[10px] font-medium text-gray-400 dark:text-zinc-500">
                                  <Clock3 size={11} />
                                  <span>{formatNotificationDate(notification)}</span>
                                </div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  );
                })
              ) : (
                <div className="py-10 text-center">
                  <Inbox size={24} className="mx-auto text-gray-300 dark:text-zinc-600" />
                  <p className="mt-2 text-sm font-medium text-gray-500 dark:text-zinc-400">
                    Nenhuma notificação pendente.
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
