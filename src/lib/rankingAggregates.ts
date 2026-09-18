import type { RankingPageDriverItem } from "./rankingPageEngine";
import { hasSimulatorIdentity, resolveSimulatorId } from "./resolveSimulator";
import { buildRankingUtcPeriodKey } from "./rankingPeriods";

export const RANKING_AGGREGATES_COLLECTION = "ranking_aggregates";
// v4 is reserved for aggregates produced after every live/open period moved
// to the canonical historico_viagens source. Closed-period documents remain a
// performance snapshot, never a competing source for mutable current totals.
export const RANKING_AGGREGATE_SCHEMA_VERSION = 4;
export const RANKING_AGGREGATE_RECONCILE_AFTER_MS = 60 * 60 * 1000;

export type RankingAggregatePeriodType = "semana" | "mes";

export interface RankingAggregateCompanyStat {
  trips: number;
  val: number;
  name?: string;
}

export interface RankingAggregateDriverStat {
  trips: number;
  val: number;
  companyId?: string;
  name?: string;
}

export interface RankingAggregateDocument {
  schemaVersion: number;
  simulatorId: string;
  periodType: RankingAggregatePeriodType;
  periodKey: string;
  complete: boolean;
  sourceTripCount: number;
  companies: Record<string, RankingAggregateCompanyStat>;
  drivers: Record<string, RankingAggregateDriverStat>;
  generatedAt?: unknown;
  updatedAt?: unknown;
  lastReconciledAt?: unknown;
}

export function buildRankingAggregatePeriodKey(
  periodType: RankingAggregatePeriodType,
  referenceDate = new Date(),
) {
  return buildRankingUtcPeriodKey(periodType, referenceDate);
}

export function buildRankingAggregateDocumentId(
  simulatorId: string,
  periodKey: string,
) {
  return `v${RANKING_AGGREGATE_SCHEMA_VERSION}__${encodeURIComponent(
    simulatorId.trim(),
  )}__${periodKey}`
    .replace(/[^a-zA-Z0-9%_.~-]/g, "_")
    .slice(0, 1400);
}

function asFiniteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseCompanyStats(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, RankingAggregateCompanyStat>;
  }

  const result: Record<string, RankingAggregateCompanyStat> = {};
  Object.entries(value as Record<string, unknown>).forEach(([id, raw]) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const record = raw as Record<string, unknown>;
    result[id] = {
      trips: Math.max(0, Math.trunc(asFiniteNumber(record.trips))),
      val: Math.max(0, asFiniteNumber(record.val)),
      name: asText(record.name) || undefined,
    };
  });
  return result;
}

function parseDriverStats(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, RankingAggregateDriverStat>;
  }

  const result: Record<string, RankingAggregateDriverStat> = {};
  Object.entries(value as Record<string, unknown>).forEach(([id, raw]) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const record = raw as Record<string, unknown>;
    result[id] = {
      trips: Math.max(0, Math.trunc(asFiniteNumber(record.trips))),
      val: Math.max(0, asFiniteNumber(record.val)),
      companyId: asText(record.companyId) || undefined,
      name: asText(record.name) || undefined,
    };
  });
  return result;
}

export function parseRankingAggregateDocument(
  value: Record<string, unknown> | undefined,
): RankingAggregateDocument | null {
  if (!value) return null;
  const schemaVersion = asFiniteNumber(value.schemaVersion);
  const simulatorId = asText(value.simulatorId);
  const periodType = asText(value.periodType);
  const periodKey = asText(value.periodKey);

  if (
    schemaVersion !== RANKING_AGGREGATE_SCHEMA_VERSION ||
    !simulatorId ||
    !periodKey ||
    (periodType !== "semana" && periodType !== "mes") ||
    value.complete !== true
  ) {
    return null;
  }

  return {
    schemaVersion,
    simulatorId,
    periodType,
    periodKey,
    complete: true,
    sourceTripCount: Math.max(0, Math.trunc(asFiniteNumber(value.sourceTripCount))),
    companies: parseCompanyStats(value.companies),
    drivers: parseDriverStats(value.drivers),
    generatedAt: value.generatedAt,
    updatedAt: value.updatedAt,
    lastReconciledAt: value.lastReconciledAt,
  };
}

export function rankingAggregateTimestampMs(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();

  const timestamp = value as {
    toDate?: () => Date;
    seconds?: unknown;
    _seconds?: unknown;
  };
  if (typeof timestamp.toDate === "function") {
    return timestamp.toDate().getTime();
  }

  const seconds = Number(timestamp.seconds ?? timestamp._seconds);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;

  const parsed = new Date(value as string | number).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function readEntityText(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" ? value.trim() : "";
}

export function isRankingEligibleCompany(
  company: Record<string, unknown> | undefined,
): boolean {
  if (!company) return false;
  const status = String(
    company.status || company.situacao || company.state || "active",
  )
    .trim()
    .toLocaleLowerCase("pt-BR");
  const deleted =
    company.deleted === true ||
    company.softDeleted === true ||
    company.excluida === true ||
    company.excluido === true ||
    [
      "deleted",
      "excluida",
      "excluido",
      "removed",
      "removida",
      "removido",
    ].includes(status);
  return (
    !deleted &&
    ["active", "approved", "ativo"].includes(status) &&
    hasSimulatorIdentity(company)
  );
}

function stableRankingSort<
  T extends { val: number; trips: number; name?: string; id: string },
>(left: T, right: T): number {
  if (right.val !== left.val) return right.val - left.val;
  if (right.trips !== left.trips) return right.trips - left.trips;
  const nameOrder = String(left.name || "").localeCompare(
    String(right.name || ""),
    "pt-BR",
    { sensitivity: "base", numeric: true },
  );
  return nameOrder || left.id.localeCompare(right.id);
}

function shortDriverName(value: unknown) {
  const parts = String(value || "Motorista Desconhecido")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.slice(0, 2).join(" ") || "Motorista Desconhecido";
}

export function buildCompanyRankingFromAggregate(
  aggregate: RankingAggregateDocument,
  companies: Record<string, unknown>[],
  simulators: Record<string, unknown>[] = [],
) {
  const companiesById = new Map(
    companies
      .map((company) => [readEntityText(company, "id"), company] as const)
      .filter(([id]) => Boolean(id)),
  );

  return Object.entries(aggregate.companies)
    .map(([id, stats]) => {
      const company = companiesById.get(id);
      // Only the current active company catalog can authorize a ranking row.
      if (!isRankingEligibleCompany(company)) return null;
      if (
        resolveSimulatorId(company, simulators, companies) !== aggregate.simulatorId
      ) return null;
      return {
        id,
        name:
          readEntityText(company, "companyName") ||
          readEntityText(company, "name") ||
          stats.name ||
          "Empresa Desconhecida",
        logo:
          readEntityText(company, "logoUrl") ||
          readEntityText(company, "logoURL") ||
          readEntityText(company, "companyLogoURL") ||
          readEntityText(company, "logo"),
        trips: stats.trips,
        val: stats.val,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort(stableRankingSort);
}

export function buildDriverRankingFromAggregate(
  aggregate: RankingAggregateDocument,
  users: Record<string, unknown>[],
  companies: Record<string, unknown>[],
  simulators: Record<string, unknown>[] = [],
  companyMembers: Record<string, unknown>[] = [],
): RankingPageDriverItem[] {
  const usersById = new Map(
    users
      .map((user) => [readEntityText(user, "id"), user] as const)
      .filter(([id]) => Boolean(id)),
  );
  const companiesById = new Map(
    companies
      .map((company) => [readEntityText(company, "id"), company] as const)
      .filter(([id]) => Boolean(id)),
  );
  const activeMembershipByUser = new Map<
    string,
    { companyId: string; joinedAt: number }
  >();
  companyMembers.forEach((membership) => {
    const userId = readEntityText(membership, "userId");
    const companyId = readEntityText(membership, "companyId");
    const status = readEntityText(membership, "status").toLowerCase();
    const roles = Array.isArray(membership.roles)
      ? membership.roles.map((role) => String(role).toLowerCase())
      : [];
    const isDriver =
      roles.includes("driver") ||
      readEntityText(membership, "role").toLowerCase() === "driver";
    const company = companiesById.get(companyId);
    if (
      !userId ||
      !companyId ||
      status !== "active" ||
      !isDriver ||
      !isRankingEligibleCompany(company) ||
      resolveSimulatorId(company, simulators, companies) !== aggregate.simulatorId
    ) {
      return;
    }

    const joinedAtValue = membership.joinedAt;
    const joinedAt =
      joinedAtValue instanceof Date
        ? joinedAtValue.getTime()
        : typeof (joinedAtValue as { toDate?: unknown })?.toDate === "function"
          ? (joinedAtValue as { toDate: () => Date }).toDate().getTime()
          : new Date(joinedAtValue as string | number).getTime() || 0;
    const current = activeMembershipByUser.get(userId);
    if (!current || joinedAt >= current.joinedAt) {
      activeMembershipByUser.set(userId, { companyId, joinedAt });
    }
  });

  return Object.entries(aggregate.drivers)
    .map(([id, stats]): RankingPageDriverItem | null => {
      const user = usersById.get(id);
      const membershipCompanyId = activeMembershipByUser.get(id)?.companyId || "";
      const profileCompanyId =
        readEntityText(user, "companyId") ||
        readEntityText(user, "activeCompanyId");
      const profileCompany = profileCompanyId
        ? companiesById.get(profileCompanyId)
        : undefined;
      const profileCompanyMatchesAggregate = Boolean(
        isRankingEligibleCompany(profileCompany) &&
          resolveSimulatorId(profileCompany, simulators, companies) ===
            aggregate.simulatorId,
      );
      const candidateCompanyId =
        membershipCompanyId ||
        (profileCompanyMatchesAggregate ? profileCompanyId : "") ||
        stats.companyId ||
        "";
      const company = candidateCompanyId
        ? companiesById.get(candidateCompanyId)
        : undefined;
      if (!isRankingEligibleCompany(company)) return null;
      if (
        resolveSimulatorId(company, simulators, companies) !== aggregate.simulatorId
      ) return null;

      return {
        id,
        name: shortDriverName(readEntityText(user, "name") || stats.name),
        logo:
          readEntityText(user, "profilePhotoURL") ||
          readEntityText(user, "photoURL") ||
          readEntityText(user, "photoUrl") ||
          readEntityText(user, "avatar") ||
          readEntityText(user, "profileImage") ||
          readEntityText(user, "imageUrl") ||
          readEntityText(user, "photo"),
        trips: stats.trips,
        val: stats.val,
        companyId: candidateCompanyId,
        companyName:
          readEntityText(company, "companyName") ||
          readEntityText(company, "name"),
      };
    })
    .filter((item): item is RankingPageDriverItem => item !== null)
    .sort(stableRankingSort);
}
