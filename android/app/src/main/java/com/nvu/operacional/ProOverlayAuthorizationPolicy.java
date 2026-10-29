package com.nvu.operacional;

/** A temporary Android overlay grant ends with its authorized projection. */
public final class ProOverlayAuthorizationPolicy {
    private ProOverlayAuthorizationPolicy() {}

    public static boolean isAuthorized(Boolean cachedGrant, boolean temporaryGrant, boolean projectionActive) {
        return projectionActive || (Boolean.TRUE.equals(cachedGrant) && !temporaryGrant);
    }
}
