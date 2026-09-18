package com.nvu.operacional;

/**
 * HF27: breaks the post-consent foreground deadlock on OEMs whose UsageStats keeps
 * reporting NVU/unknown after the transparent MediaProjection host closes. The bridge
 * is armed only from a GTO-verified consent handoff and never overrides a positively
 * identified third-party foreground app or a transient SystemUI surface.
 */
final class GtoProjectionForegroundBridgePolicy {
    private GtoProjectionForegroundBridgePolicy() {}

    static boolean allow(
        boolean verifiedGtoBridge,
        boolean transientSurface,
        boolean packageMatchesGto,
        boolean packageUnknown,
        boolean packageIsNvu,
        boolean nvuMainActivityForeground
    ) {
        if (packageMatchesGto) return true;
        if (!verifiedGtoBridge || transientSurface) return false;
        return packageUnknown || (packageIsNvu && !nvuMainActivityForeground);
    }
}
