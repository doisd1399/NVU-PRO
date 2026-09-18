export interface RawTrip {
  id: string;
  status?: string;
  cancelado?: boolean;
  deleted?: boolean;
  softDeleted?: boolean;
  completedAt?: any;
  createdAt?: any;
  dataFechamento?: any;
  dataLancamento?: any;
  date?: any;
  valor?: string | number;
  value?: string | number;
  totalValue?: string | number;
  ganho?: string | number;
  empresaId?: string;
  empresaNome?: string;
  motoristaId?: string;
  motoristaNome?: string;
  placa?: string;
  [key: string]: any;
}

export interface NormalizedTrip extends RawTrip {
  isValid: boolean;
  metricDate: Date;
  normalizedValor: number;
}

function normalizeStatus(value: unknown): string {
  return String(value || "")
    .trim()
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function parseTripValue(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  // Handles plain numeric strings, Brazilian currency (14.900,00) and
  // international decimal strings without changing already numeric values.
  const cleaned = raw.replace(/[^0-9,.-]/g, "");
  if (!cleaned) return 0;

  let normalized = cleaned;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  if (hasComma && hasDot) {
    // The rightmost separator is the decimal separator.
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if ((cleaned.match(/\./g) || []).length > 1) {
    const lastDot = cleaned.lastIndexOf(".");
    normalized =
      cleaned.slice(0, lastDot).replace(/\./g, "") + cleaned.slice(lastDot);
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getTripMetricDate(trip: RawTrip | any): Date {
  // The completion timestamp is authoritative. Legacy aliases remain as
  // fallbacks so old documents continue to participate in history/ranking.
  const rawDate =
    trip?.completedAt?.toDate?.() ||
    trip?.completedAt ||
    trip?.dataFechamento ||
    trip?.date ||
    trip?.dataLancamento ||
    trip?.createdAt;

  if (!rawDate) return new Date(0);
  if (rawDate instanceof Date) return rawDate;
  if (typeof rawDate?.toDate === "function") return rawDate.toDate();
  if (rawDate?.seconds) return new Date(Number(rawDate.seconds) * 1000);

  const parsed = new Date(rawDate);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

const normalizationCache = new WeakMap<any, NormalizedTrip>();

export function normalizeTrip(trip: RawTrip): NormalizedTrip {
  if (typeof trip === 'object' && trip !== null) {
    if (normalizationCache.has(trip)) {
      return normalizationCache.get(trip);
    }
  }
  
  const status = normalizeStatus(trip.status);

  const isCanceled =
    status === "cancelado" ||
    status === "cancelada" ||
    status === "canceled" ||
    status === "cancelled" ||
    status === "excluido" ||
    status === "excluida" ||
    trip.cancelado === true ||
    trip.deleted === true ||
    trip.softDeleted === true;

  const isCompletedStatus =
    status === "concluida" ||
    status === "concluido" ||
    status === "completed" ||
    status === "finalizado" ||
    status === "finalizada" ||
    status === "entregue";

  const metricDate = getTripMetricDate(trip);
  // Historical records created before the status field existed are completed
  // when they have a usable metric date and are not explicitly canceled. This
  // is the same rule used by the NVU News aggregation.
  const isLegacyCompleted = !status && metricDate.getTime() > 0;

  return {
    ...trip,
    isValid: !isCanceled && (isCompletedStatus || isLegacyCompleted),
    metricDate,
    normalizedValor: parseTripValue(
      trip.valor ?? trip.value ?? trip.totalValue ?? trip.ganho,
    ),
  };
}
