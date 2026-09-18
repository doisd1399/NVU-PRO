package com.nvu.operacional;

import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * HF22: sparse circular observer log and last-incident snapshot.
 * This is deliberately outside the decision path: diagnostics can fail without changing
 * freight selection, OCR, capture, durable queue, Firebase or ACK behavior.
 */
final class GtoObserverDiagnostics {
    static final int MAX_EVENTS = 50;
    private static final String KEY_EVENTS = "observerEventLog";

    private GtoObserverDiagnostics() {}

    static void record(SharedPreferences prefs, String code, String detail, String state, String sessionId) {
        if (prefs == null) return;
        try {
            JSONArray old = new JSONArray(prefs.getString(KEY_EVENTS, "[]"));
            JSONArray next = new JSONArray();
            int start = Math.max(0, old.length() - (MAX_EVENTS - 1));
            for (int i = start; i < old.length(); i++) next.put(old.opt(i));
            JSONObject event = new JSONObject();
            event.put("at", System.currentTimeMillis());
            event.put("code", safe(code));
            event.put("detail", safe(detail));
            event.put("state", safe(state));
            event.put("sessionId", safe(sessionId));
            next.put(event);
            prefs.edit()
                .putString(KEY_EVENTS, next.toString())
                .putString("observerLastEventCode", safe(code))
                .putLong("observerLastEventAt", System.currentTimeMillis())
                .apply();
        } catch (Exception ignored) {
            // Diagnostics are never allowed to affect the observer flow.
        }
    }

    static void incident(SharedPreferences prefs, String type, String detail) {
        if (prefs == null) return;
        try {
            JSONObject incident = new JSONObject();
            incident.put("at", System.currentTimeMillis());
            incident.put("type", safe(type));
            incident.put("detail", safe(detail));
            incident.put("state", prefs.getString("tripState", ""));
            incident.put("sessionId", prefs.getString("gtoTripSessionId", ""));
            incident.put("row", prefs.getInt("selectedFreightRow", -1));
            incident.put("selectionIdentity", prefs.getString("selectionIdentityStatus", ""));
            incident.put("selectionSource", prefs.getString("selectionIdentitySource", ""));
            incident.put("reviewField", prefs.getString("reviewRequiredField", ""));
            incident.put("cargo", prefs.getString("selectedCargo", prefs.getString("reviewCargo", "")));
            incident.put("origin", prefs.getString("selectedOrigin", prefs.getString("reviewOrigin", "")));
            incident.put("destination", prefs.getString("selectedDestination", prefs.getString("reviewDestination", "")));
            incident.put("km", prefs.getString("selectedKm", prefs.getString("reviewKm", "")));
            incident.put("value", prefs.getString("selectedValue", prefs.getString("reviewValue", "")));
            incident.put("resultValue", prefs.getString("resultValue", ""));
            incident.put("syncStatus", prefs.getString("gtoTripSyncStatus", ""));
            incident.put("captureStatus", prefs.getString("projectionStatus", ""));
            incident.put("captureLastFrameAt", prefs.getLong("captureLastFrameAt", 0L));
            incident.put("captureLastAnalyzedFrameAt", prefs.getLong("captureLastAnalyzedFrameAt", 0L));
            prefs.edit()
                .putString("observerLastIncident", incident.toString())
                .putLong("observerLastIncidentAt", System.currentTimeMillis())
                .apply();
            record(prefs, "INCIDENT_" + safe(type), detail, prefs.getString("tripState", ""), prefs.getString("gtoTripSessionId", ""));
        } catch (Exception ignored) {
            // Diagnostics are never allowed to affect the observer flow.
        }
    }

    private static String safe(String value) {
        if (value == null) return "";
        String trimmed = value.trim();
        return trimmed.length() <= 320 ? trimmed : trimmed.substring(0, 320);
    }
}
