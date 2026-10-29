import { getTripMetricAssessment } from "./tripMetricPolicy";
import { resolveTripCurrency, type TripCurrencyResolution, type TripCurrencyStatus } from "../../functions/src/tripCurrencyResolver";
export { getTripMetricAssessment, getTripMetricDate } from "./tripMetricPolicy";
export { getKnownTripCurrencies, resolveTripCurrency } from "../../functions/src/tripCurrencyResolver";
export { resolveSimulatorCurrency, SIMULATOR_CURRENCY_REGISTRY } from "../../functions/src/simulatorCurrencyRegistry";
export type { TripCurrencyResolution, TripCurrencyStatus } from "../../functions/src/tripCurrencyResolver";

export interface RawTrip {
  id: string;
  status?: string;
  cancelado?: boolean;
  deleted?: boolean;
  softDeleted?: boolean;
  completedAt?: any;
  createdAt?: any;
  localCreatedAt?: any;
  offlineCreatedAt?: any;
  createdAtLocal?: any;
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
  normalizedCurrency?: string;
  currencyStatus?: TripCurrencyStatus;
  currencySource?: string;
}

export interface TripMoneyRecord {
  amount: number;
  amountCents: number | null;
  amountSource: string | null;
  currency?: TripCurrencyResolution["currency"];
  currencyStatus: TripCurrencyResolution["currencyStatus"];
  currencySources: TripCurrencyResolution["currencySources"];
  currencySource?: TripCurrencyResolution["currencySource"];
}

function parseTripValueOrNull(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const raw = String(value ?? "").trim();
  if (!raw) return null;

  // Handles plain numeric strings, Brazilian currency (14.900,00) and
  // international decimal strings without changing already numeric values.
  const cleaned = raw.replace(/[^0-9,.-]/g, "");
  if (!cleaned) return null;

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
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseTripValue(value: unknown): number {
  return parseTripValueOrNull(value) ?? 0;
}

/** Valid integer cents are authoritative; legacy decimal fields are fallback. */
export function parseTripValueRecord(trip: Record<string, unknown>): number {
  return parseTripMoneyRecord(trip).amount;
}

export function parseTripMoneyRecord(trip: Record<string, unknown>): TripMoneyRecord {
  const rawCents = trip.valorCents ?? trip.amountCents ?? trip.earningsCents;
  const hasValidCents = (typeof rawCents === "number" && Number.isSafeInteger(rawCents)) ||
    (typeof rawCents === "string" && /^-?\d+$/.test(rawCents.trim()) && Number.isSafeInteger(Number(rawCents)));
  const decimal = [trip.valor, trip.value, trip.totalValue, trip.ganho]
    .find((value) => value !== null && value !== undefined && String(value).trim() !== "");
  const parsedDecimal = parseTripValueOrNull(decimal);
  const candidateCents = hasValidCents ? Number(rawCents) : parsedDecimal === null ? null : Math.round(parsedDecimal * 100);
  const amountCents = candidateCents !== null && Number.isSafeInteger(candidateCents) ? candidateCents : null;
  const amountSource = amountCents === null ? null : hasValidCents ? "valorCents" : "decimal_fallback";
  return {
    amount: amountCents === null ? 0 : amountCents / 100,
    amountCents,
    amountSource,
    ...resolveTripCurrency(trip),
  };
}

const normalizationCache = new WeakMap<any, NormalizedTrip>();

export function normalizeTrip(trip: RawTrip): NormalizedTrip {
  if (typeof trip === 'object' && trip !== null) {
    if (normalizationCache.has(trip)) {
      return normalizationCache.get(trip);
    }
  }

  const assessment = getTripMetricAssessment(trip);
  const money = parseTripMoneyRecord(trip as Record<string, unknown>);

  return {
    ...trip,
    isValid: assessment.eligible,
    metricDate: assessment.date,
    normalizedValor: money.amount,
    normalizedCurrency: money.currency,
    currencyStatus: money.currencyStatus,
    currencySource: money.currencySource,
  };
}
