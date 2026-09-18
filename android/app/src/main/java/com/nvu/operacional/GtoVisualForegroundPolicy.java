package com.nvu.operacional;

/**
 * Conservative policy for using a live GTO freight-list capture as foreground proof.
 *
 * A real list may bridge an OEM that fails to report GTO after MediaProjection returns,
 * but it may never override a positively identified non-GTO foreground application.
 * This keeps notification shade, Recents and other apps neutral to the trip state.
 */
final class GtoVisualForegroundPolicy {
    private GtoVisualForegroundPolicy() {}

    static boolean allowCurrentSessionFreightListProof(
        boolean waitingForFreight,
        boolean projectionActive,
        boolean authorizedCaptureSession,
        boolean packageMatchesGto,
        boolean packageUnknown,
        boolean permissionReturnFromNvu,
        boolean nvuMainActivityForeground,
        boolean transientSurface,
        int freightCount
    ) {
        if (nvuMainActivityForeground || transientSurface) return false;
        return GtoDeterministicFlowPolicy.mayUseCurrentSessionVisualFreightProof(
            waitingForFreight,
            projectionActive,
            authorizedCaptureSession,
            packageMatchesGto,
            packageUnknown,
            permissionReturnFromNvu,
            freightCount
        );
    }

    static boolean allowFreightListProof(
        boolean waitingForFreight,
        boolean projectionActive,
        boolean packageMatchesGto,
        boolean packageUnknown,
        boolean permissionReturnFromNvu,
        int freightCount
    ) {
        return GtoDeterministicFlowPolicy.mayUseVisualFreightProof(
            waitingForFreight,
            projectionActive,
            packageMatchesGto,
            packageUnknown,
            permissionReturnFromNvu,
            freightCount
        );
    }
}
