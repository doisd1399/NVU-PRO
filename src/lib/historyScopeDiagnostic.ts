import type { TripReadCoverage, TripReadCoverageStatus } from "./tripReadCoverage";
import { AUTH_TEARDOWN_EVENT } from "./authLifecycle";

export type HistoryScopeDiagnostic = {
  view: "reports" | "history";
  authenticatedUserPresent: boolean;
  activeCompanySelected: boolean;
  currentUserActiveCompanyMember: boolean;
  activeCompanyMemberCount: number;
  role: "admin" | "driver" | "manager" | "other";
  period: "semanal" | "mensal" | "todos" | "hoje" | "semana" | "mes" | "data";
  mode: "empresa" | "funcionarios" | "driver" | "company";
  driverFilterActive: boolean;
  simulatorFilter: "all" | "selected";
  sourceRows: number;
  eligibleRows: number;
  periodGroups?: number;
  visibleGroups?: number;
  identityRows?: number;
  visibleRows?: number;
  filteredRows?: number;
  sourceKind?: "hook" | "override";
  embeddedOperation?: boolean;
  loading: boolean;
  hasError: boolean;
  cacheMetadata: "not_exposed_by_history_hook" | "exposed";
  selectedCompanyId?: string | null;
  selectedDriverId?: string | null;
  authenticatedUserId?: string | null;
  customStartDate?: string;
  customEndDate?: string;
  coverage?: TripReadCoverageStatus;
  readCoverage?: TripReadCoverage | null;
};

declare global {
  interface Window {
    __NVU_ENABLE_HISTORY_SCOPE_DIAGNOSTICS__?: boolean;
    __NVU_HISTORY_SCOPE_CORRELATION__?: typeof getHistoryScopeCorrelation;
  }
}

const scopeReferences = new Map<string, string>();
const privateCorrelations = new Map<string, { kind: "company" | "viewer" | "driver"; value: string }>();
let diagnosticWindow: Window | undefined;
export function clearHistoryScopeDiagnostics() {
  scopeReferences.clear();
  privateCorrelations.clear();
  if (typeof window !== "undefined") {
    delete window.__NVU_HISTORY_SCOPE_CORRELATION__;
    delete window.__NVU_ENABLE_HISTORY_SCOPE_DIAGNOSTICS__;
  }
}
function scopeReference(kind: "company" | "viewer" | "driver", value?: string | null): string | undefined {
  const clean = String(value || "").trim();
  if (!clean) return undefined;
  const key = `${kind}:${clean}`;
  if (!scopeReferences.has(key)) {
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const reference = `scope-${random}`;
    scopeReferences.set(key, reference);
    privateCorrelations.set(reference, { kind, value: clean });
  }
  return scopeReferences.get(key);
}

/** Explicit local lookup for the authorized operator; never added to logs/files. */
export function getHistoryScopeCorrelation(reference: string) {
  if (typeof window === "undefined" || window.__NVU_ENABLE_HISTORY_SCOPE_DIAGNOSTICS__ !== true) return null;
  const correlation = privateCorrelations.get(reference);
  return correlation ? { ...correlation } : null;
}

/**
 * Optional, local-only diagnostics for resolving count discrepancies.
 * Disabled unless the operator explicitly sets
 * window.__NVU_ENABLE_HISTORY_SCOPE_DIAGNOSTICS__ = true in DevTools.
 * Never transmits or records raw UID, company/driver IDs, names, e-mail,
 * trip values, tokens, or error messages.
 */
export function emitHistoryScopeDiagnostic(
  input: HistoryScopeDiagnostic,
): boolean {
  if (typeof window === "undefined" || window.__NVU_ENABLE_HISTORY_SCOPE_DIAGNOSTICS__ !== true) {
    return false;
  }
  if (diagnosticWindow !== window) {
    diagnosticWindow?.removeEventListener?.(AUTH_TEARDOWN_EVENT, clearHistoryScopeDiagnostics);
    diagnosticWindow = window;
    window.addEventListener?.(AUTH_TEARDOWN_EVENT, clearHistoryScopeDiagnostics);
  }

  const safeCount = (value: number) => Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
  const read = input.readCoverage;
  const selectedCompanyRef = scopeReference("company", input.selectedCompanyId);
  const queryCompanyRefs = (read?.scope.companyIds || []).map((value) => scopeReference("company", value)!);
  // Correlation requires an explicit local lookup and is not part of exported evidence.
  window.__NVU_HISTORY_SCOPE_CORRELATION__ = getHistoryScopeCorrelation;
  const safeRecord = {
    type: "NVU_HISTORY_SCOPE_DIAGNOSTIC",
    capturedAt: new Date().toISOString(),
    view: input.view,
    authenticatedUserPresent: input.authenticatedUserPresent,
    activeCompanySelected: input.activeCompanySelected,
    currentUserActiveCompanyMember: input.currentUserActiveCompanyMember,
    role: input.role, period: input.period, mode: input.mode,
    driverFilterActive: input.driverFilterActive, simulatorFilter: input.simulatorFilter,
    loading: input.loading, hasError: input.hasError, cacheMetadata: input.cacheMetadata,
    ...(input.sourceKind === undefined ? {} : { sourceKind: input.sourceKind }),
    ...(input.embeddedOperation === undefined ? {} : { embeddedOperation: input.embeddedOperation }),
    selectedCompanyRef,
    queryCompanyRefs,
    selectedDriverRef: scopeReference("driver", input.selectedDriverId),
    viewerRef: scopeReference("viewer", read?.scope.authenticatedUserId || input.authenticatedUserId),
    readScopeVerified: Boolean(read),
    scopeMatchesSelection: read && selectedCompanyRef ? queryCompanyRefs.includes(selectedCompanyRef) : null,
    coverage: input.coverage || "unknown",
    ...(input.customStartDate === undefined ? {} : { customStartDate: input.customStartDate }),
    ...(input.customEndDate === undefined ? {} : { customEndDate: input.customEndDate }),
    sourceRows: safeCount(input.sourceRows),
    eligibleRows: safeCount(input.eligibleRows),
    activeCompanyMemberCount: safeCount(input.activeCompanyMemberCount),
    ...(input.periodGroups === undefined ? {} : { periodGroups: safeCount(input.periodGroups) }),
    ...(input.visibleGroups === undefined ? {} : { visibleGroups: safeCount(input.visibleGroups) }),
    ...(input.identityRows === undefined ? {} : { identityRows: safeCount(input.identityRows) }),
    ...(input.visibleRows === undefined ? {} : { visibleRows: safeCount(input.visibleRows) }),
    ...(input.filteredRows === undefined ? {} : { filteredRows: safeCount(input.filteredRows) }),
    ...(read ? {
      readGeneration: safeCount(read.generation), expectedSources: safeCount(read.expectedSources),
      respondedSources: safeCount(read.respondedSources), confirmedSources: safeCount(read.confirmedSources),
      failedSources: safeCount(read.failedSources), physicalRows: safeCount(read.physicalRows),
      projectedRows: safeCount(read.projectedRows), unverifiedProjectionRows: safeCount(read.unverifiedProjectionRows),
      ...(read.unobservedProjectionRows === undefined ? {} : { unobservedProjectionRows: safeCount(read.unobservedProjectionRows) }),
      ...(read.pendingLocalRows === undefined ? {} : { pendingLocalRows: safeCount(read.pendingLocalRows) }),
      rejectedRows: safeCount(read.rejectedRows), fromCache: read.fromCache,
      hasPendingWrites: read.hasPendingWrites, atomic: false,
      sources: read.sources.map((source) => ({
        alias: ({ companyId: "company_primary", empresaId: "company_legacy", driverId: "driver_primary", motoristaId: "driver_legacy" } as const)[source.field],
        status: source.status, rows: safeCount(source.rows),
      })),
    } : {}),
  };
  console.info("[NVU_HISTORY_SCOPE_DIAGNOSTIC]", safeRecord);
  return true;
}
