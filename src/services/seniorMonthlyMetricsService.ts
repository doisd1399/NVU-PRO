import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";

export type SeniorCompanyMonthlyMetric = {
  tripCount: number;
  earnings: number;
};

export const SENIOR_METRICS_CACHE_VERSION = "canonical-trip-v1";

export type SeniorMonthlyMetricsResult = {
  periodKey: string;
  companies: Record<string, SeniorCompanyMonthlyMetric>;
};

type CallableMetric = {
  companyId?: unknown;
  tripCount?: unknown;
  earnings?: unknown;
};

type CallableResult = {
  success?: unknown;
  periodKey?: unknown;
  periodTimeZone?: unknown;
  periodPolicy?: unknown;
  companies?: unknown;
};

/**
 * Busca somente contadores e ganhos agregados por empresa.
 * O payload da callable não contém nem devolve documentos de viagens.
 */
export async function getSeniorMonthlyMetrics(): Promise<SeniorMonthlyMetricsResult> {
  const callable = httpsCallable<Record<string, never>, CallableResult>(
    functions,
    "getSeniorMonthlyMetrics",
  );
  const response = await callable({});
  const data = response.data;

  if (
    data?.success !== true ||
    data.periodTimeZone !== "America/Sao_Paulo" ||
    data.periodPolicy !== "SAO_PAULO_CALENDAR" ||
    typeof data.periodKey !== "string"
  ) {
    throw new Error("O servidor retornou métricas mensais incompatíveis.");
  }

  const companies: Record<string, SeniorCompanyMonthlyMetric> = Object.create(null);
  if (!Array.isArray(data.companies)) {
    throw new Error("O servidor retornou uma lista inválida de métricas.");
  }

  for (const raw of data.companies as CallableMetric[]) {
    const companyId = typeof raw?.companyId === "string" ? raw.companyId.trim() : "";
    const tripCount = Number(raw?.tripCount);
    const earnings = Number(raw?.earnings);
    if (
      !companyId ||
      !Number.isInteger(tripCount) ||
      tripCount < 0 ||
      !Number.isFinite(earnings) ||
      earnings < 0
    ) {
      throw new Error("O servidor retornou uma métrica mensal inválida.");
    }
    companies[companyId] = { tripCount, earnings };
  }

  return { periodKey: data.periodKey, companies };
}
