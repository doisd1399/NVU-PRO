package com.nvu.operacional;

/**
 * Scope for mutating GTO actions derived from a current visual context.
 *
 * A confirmed visual layout is actionable only while the observer is not in an
 * explicit outside-GTO pause, not behind the NVU Activity/transient surface, and
 * no known unrelated package owns the foreground. An empty owner is retained as
 * an OEM-tolerated uncertainty; the current visual/transaction gates remain required.
 */
final class GtoVisualActionContextPolicy {
    private GtoVisualActionContextPolicy() {}

    static boolean allows(
        boolean analysisPausedOutsideGto,
        boolean transientSurfaceActive,
        boolean nvuMainActivityForeground,
        String currentPackage,
        String gtoPackage,
        String nvuPackage
    ) {
        if (analysisPausedOutsideGto || transientSurfaceActive || nvuMainActivityForeground) return false;
        String current = currentPackage == null ? "" : currentPackage.trim();
        String gto = gtoPackage == null ? "" : gtoPackage.trim();
        String nvu = nvuPackage == null ? "" : nvuPackage.trim();
        if (current.isEmpty()) return true;
        return current.equals(gto) || current.equals(nvu);
    }
}
