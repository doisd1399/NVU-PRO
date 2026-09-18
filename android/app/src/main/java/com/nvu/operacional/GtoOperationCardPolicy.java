package com.nvu.operacional;

import java.util.Locale;

/**
 * Pure, deterministic authority policy for the floating Operation card.
 *
 * Android persistence and overlay code adapt their data into ContextSnapshot,
 * but authority selection and summary formatting live here so the production
 * behavior can be exercised without Android, Firebase or a freight session.
 */
final class GtoOperationCardPolicy {
    static final String AUTH_DEDICATED = "DEDICATED_OPERATION_CONTEXT";
    static final String AUTH_LIVE = "LIVE_OPERATION_CONTEXT";
    static final String AUTH_SESSION = "SESSION_SNAPSHOT_FALLBACK";
    static final String AUTH_NONE = "NO_VALID_OPERATION_CONTEXT";

    static final class ContextSnapshot {
        final String jobId;
        final String driverId;
        final String companyId;
        final String contractId;
        final String operationName;
        final String contractName;
        final String jobStatus;
        final int jobProgress;
        final int jobTotalDeliveries;
        final String vehicleName;
        final String trailerName;
        final long contextRevision;

        ContextSnapshot(
            String jobId,
            String driverId,
            String companyId,
            String contractId,
            String operationName,
            String contractName,
            String jobStatus,
            int jobProgress,
            int jobTotalDeliveries,
            String vehicleName,
            String trailerName,
            long contextRevision
        ) {
            this.jobId = clean(jobId);
            this.driverId = clean(driverId);
            this.companyId = clean(companyId);
            this.contractId = clean(contractId);
            this.operationName = clean(operationName);
            this.contractName = clean(contractName);
            this.jobStatus = clean(jobStatus);
            this.jobProgress = Math.max(0, jobProgress);
            this.jobTotalDeliveries = Math.max(0, jobTotalDeliveries);
            this.vehicleName = clean(vehicleName);
            this.trailerName = clean(trailerName);
            this.contextRevision = Math.max(0L, contextRevision);
        }
    }

    static final class Resolution {
        final String authority;
        final ContextSnapshot snapshot;

        Resolution(String authority, ContextSnapshot snapshot) {
            this.authority = clean(authority);
            this.snapshot = snapshot;
        }
    }

    private GtoOperationCardPolicy() {}

    static Resolution resolve(
        ContextSnapshot active,
        ContextSnapshot dedicated,
        ContextSnapshot live,
        ContextSnapshot session
    ) {
        if (isUsableForActive(dedicated, active)
            && revisionMatches(dedicated, active)) {
            return new Resolution(AUTH_DEDICATED, dedicated);
        }
        // Live persisted preferences are the current bridge commit. They must be
        // preferred over the immutable freight/session snapshot when the dedicated
        // display copy is missing, stale or from an older schema/revision.
        if (isUsableForActive(live, active)) {
            return new Resolution(AUTH_LIVE, live);
        }
        if (isUsableForActive(session, active)) {
            return new Resolution(AUTH_SESSION, session);
        }
        return new Resolution(AUTH_NONE, null);
    }

    static boolean isUsableForActive(ContextSnapshot candidate, ContextSnapshot active) {
        if (candidate == null || active == null || active.jobId.isEmpty()) return false;
        if (candidate.jobId.isEmpty() || !active.jobId.equals(candidate.jobId)) return false;
        if (!sameWhenActive(active.driverId, candidate.driverId)) return false;
        if (!sameWhenActive(active.companyId, candidate.companyId)) return false;
        if (!sameWhenActive(active.contractId, candidate.contractId)) return false;
        return !displayName(candidate).isEmpty();
    }

    static boolean revisionMatches(ContextSnapshot dedicated, ContextSnapshot active) {
        if (dedicated == null || active == null) return false;
        if (active.contextRevision <= 0L) return true;
        return dedicated.contextRevision == active.contextRevision;
    }

    static String displayName(ContextSnapshot snapshot) {
        if (snapshot == null) return "";
        return !snapshot.operationName.isEmpty()
            ? snapshot.operationName
            : snapshot.contractName;
    }

    static String renderSummary(ContextSnapshot snapshot) {
        if (snapshot == null || displayName(snapshot).isEmpty()) {
            return "Operação atual indisponível\nContexto local não disponível.";
        }
        String operation = displayName(snapshot);
        String normalized = operation.toLowerCase(Locale.ROOT);
        if (!normalized.startsWith("operação") && !normalized.startsWith("operacao")) {
            operation = "Operação " + operation;
        }
        int total = snapshot.jobTotalDeliveries;
        int progress = total > 0
            ? Math.min(snapshot.jobProgress, total)
            : snapshot.jobProgress;
        String trips = total > 0
            ? String.format(Locale.ROOT, total >= 10 ? "%02d/%02d" : "%d/%d", progress, total)
            : "—";
        String percentage = total > 0
            ? Math.min(100, Math.max(0, Math.round((progress * 100f) / total))) + "%"
            : "—";
        return operation
            + "\nViagens " + trips
            + "\nVeículo " + valueOrDash(snapshot.vehicleName)
            + "\nReboque " + valueOrDash(snapshot.trailerName)
            + "\nProgresso " + percentage;
    }

    private static boolean sameWhenActive(String active, String candidate) {
        String required = clean(active);
        return required.isEmpty() || required.equals(clean(candidate));
    }

    private static String valueOrDash(String value) {
        String clean = clean(value);
        return clean.isEmpty() ? "—" : clean;
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
