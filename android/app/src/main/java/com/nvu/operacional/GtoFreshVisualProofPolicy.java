package com.nvu.operacional;

/**
 * Foreground-scoped freshness for visual GTO evidence.
 *
 * A recent visual proof may bridge a short UsageStats delay only while the current
 * foreground owner is unknown or the exact GTO package. It must never keep analysis
 * active over a known external app, the NVU Activity, or a transient system surface.
 */
final class GtoFreshVisualProofPolicy {
    private GtoFreshVisualProofPolicy() {}

    static boolean isUsable(
        long proofAt,
        long now,
        long freshnessWindowMs,
        String currentPackage,
        String gtoPackage,
        String nvuPackage,
        boolean transientSurfaceActive,
        boolean nvuMainActivityForeground
    ) {
        if (transientSurfaceActive || nvuMainActivityForeground) return false;
        if (proofAt <= 0L || now < proofAt || freshnessWindowMs < 0L) return false;
        String current = currentPackage == null ? "" : currentPackage.trim();
        String gto = gtoPackage == null ? "" : gtoPackage.trim();
        String nvu = nvuPackage == null ? "" : nvuPackage.trim();
        boolean knownExternalPackage = !current.isEmpty()
            && !current.equals(gto)
            && !current.equals(nvu);
        if (knownExternalPackage) return false;
        return now - proofAt <= freshnessWindowMs;
    }
}
