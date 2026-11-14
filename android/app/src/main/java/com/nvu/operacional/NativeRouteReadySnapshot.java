package com.nvu.operacional;

import android.content.SharedPreferences;

/** Presentation-only identity of an already accepted Pro route. No business writes. */
final class NativeRouteReadySnapshot {
    static final String MESSAGE = "Tudo preparado, podemos partir.";
    private final String driverId, companyId, jobId, origin, destination;
    private final long tripStartedAt, routeUpdatedAt;

    private NativeRouteReadySnapshot(SharedPreferences prefs) {
        driverId = prefs.getString("driverId", "");
        companyId = prefs.getString("companyId", "");
        jobId = prefs.getString("jobId", "");
        origin = prefs.getString("origin", "");
        destination = prefs.getString("destination", "");
        tripStartedAt = prefs.getLong("tripStartedAt", 0L);
        routeUpdatedAt = prefs.getLong("routeUpdatedAt", 0L);
    }

    static NativeRouteReadySnapshot capture(SharedPreferences prefs) {
        if (prefs == null || !"TRIP_ACTIVE".equals(prefs.getString("simpleState", ""))
            || prefs.getBoolean("operationClosed", false)) return null;
        String origin = prefs.getString("origin", "").trim();
        String destination = prefs.getString("destination", "").trim();
        if (origin.isEmpty() || destination.isEmpty() || origin.equalsIgnoreCase(destination)) return null;
        return new NativeRouteReadySnapshot(prefs);
    }

    boolean isCurrent(SharedPreferences prefs) {
        return prefs != null && "TRIP_ACTIVE".equals(prefs.getString("simpleState", ""))
            && !prefs.getBoolean("operationClosed", false)
            && driverId.equals(prefs.getString("driverId", ""))
            && companyId.equals(prefs.getString("companyId", ""))
            && jobId.equals(prefs.getString("jobId", ""))
            && origin.equals(prefs.getString("origin", ""))
            && destination.equals(prefs.getString("destination", ""))
            && tripStartedAt == prefs.getLong("tripStartedAt", 0L)
            && routeUpdatedAt == prefs.getLong("routeUpdatedAt", 0L);
    }
}
