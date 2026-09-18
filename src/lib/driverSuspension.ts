export const TRIP_DELETION_REASON_OPTIONS = [
  "Print fora do padrão",
  "Print escuro",
  "Print suspeito",
  "Print dentro do veículo",
  "Veículo sem pintura",
  "Print com ganhos dobrado",
] as const;

export const DRIVER_SUSPENSION_REASON_OPTIONS = [
  "Múltiplas viagens fora do padrão",
  "Quebra das regras da plataforma",
] as const;

export const DRIVER_SUSPENSION_DURATION_OPTIONS = [24, 48, 72] as const;

export type DriverSuspensionDurationHours =
  (typeof DRIVER_SUSPENSION_DURATION_OPTIONS)[number];

export interface OperationalSuspensionSnapshot {
  active: boolean;
  endsAt: Date | null;
  startsAt: Date | null;
  durationHours: number | null;
  reasons: string[];
  message: string;
  companyId: string;
  tripId: string;
  createdBy: string;
}

export function firestoreValueToDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === "object" && value !== null) {
    const candidate = value as {
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
    };
    if (typeof candidate.toDate === "function") {
      try {
        const date = candidate.toDate();
        return Number.isNaN(date.getTime()) ? null : date;
      } catch {
        return null;
      }
    }
    const seconds = candidate.seconds ?? candidate._seconds;
    if (typeof seconds === "number") {
      const date = new Date(seconds * 1000);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }

  if (typeof value === "number" || typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

export function getOperationalSuspension(
  user: Record<string, any> | null | undefined,
  nowMs = Date.now(),
): OperationalSuspensionSnapshot {
  const nested =
    user?.operationalSuspension && typeof user.operationalSuspension === "object"
      ? user.operationalSuspension
      : {};

  const endsAt = firestoreValueToDate(
    user?.operationalSuspendedUntil ?? nested.endsAt,
  );
  const startsAt = firestoreValueToDate(
    user?.operationalSuspendedAt ?? nested.startsAt,
  );
  const reasons = Array.isArray(nested.reasons)
    ? nested.reasons.map((reason: unknown) => String(reason || "").trim()).filter(Boolean)
    : Array.isArray(user?.operationalSuspensionReasons)
      ? user.operationalSuspensionReasons
          .map((reason: unknown) => String(reason || "").trim())
          .filter(Boolean)
      : [];

  return {
    active: Boolean(endsAt && endsAt.getTime() > nowMs),
    endsAt,
    startsAt,
    durationHours:
      Number(nested.durationHours ?? user?.operationalSuspensionDurationHours) ||
      null,
    reasons,
    message: String(
      nested.message ?? user?.operationalSuspensionMessage ?? "",
    ).trim(),
    companyId: String(nested.companyId ?? "").trim(),
    tripId: String(nested.tripId ?? "").trim(),
    createdBy: String(nested.createdBy ?? "").trim(),
  };
}

export function isOperationallySuspended(
  user: Record<string, any> | null | undefined,
  nowMs = Date.now(),
) {
  return getOperationalSuspension(user, nowMs).active;
}

export function formatSuspensionRemaining(endsAt: Date | null, nowMs = Date.now()) {
  if (!endsAt) return "00:00:00";
  const remainingSeconds = Math.max(
    0,
    Math.ceil((endsAt.getTime() - nowMs) / 1000),
  );
  const days = Math.floor(remainingSeconds / 86_400);
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  const clock = [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  return days > 0 ? `${days}d ${clock}` : clock;
}

export function formatSuspensionEnd(endsAt: Date | null) {
  if (!endsAt) return "Data não disponível";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(endsAt);
}
