package com.nvu.operacional;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

/**
 * HF42 crash-safe escrow for a semantically certified GTO delivery result.
 *
 * The immutable freight/session snapshot lives in GtoAutoTripSync. This store keeps the
 * terminal result proof independently from volatile observer preferences, so a service
 * restart, stale UI state or lifecycle reset cannot turn a delivery that already showed
 * the real GTO result into an unproven/cancelled trip.
 */
final class GtoResultProofStore {
    private static final String PREFS = "nvu_gto_result_proof_v1";
    private static final String PREFIX = "proof_";
    private static final String ACTIVE_SESSION = "active_protected_session";

    private GtoResultProofStore() {}

    static boolean certify(
        Context context,
        String sessionId,
        String observedValue,
        String snapshotPath,
        long certifiedAt
    ) {
        String session = clean(sessionId);
        if (context == null || session.isEmpty()) return false;
        SharedPreferences store = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject previous = read(store.getString(PREFIX + session, ""));
        JSONObject proof = previous == null ? new JSONObject() : previous;
        try {
            proof.put("sessionId", session);
            proof.put("certified", true);
            if (!proof.has("certifiedAt") || proof.optLong("certifiedAt", 0L) <= 0L) {
                proof.put("certifiedAt", certifiedAt > 0L ? certifiedAt : System.currentTimeMillis());
            }
            String value = clean(observedValue);
            if (!value.isEmpty()) proof.put("observedValue", value);
            String path = clean(snapshotPath);
            if (!path.isEmpty()) proof.put("snapshotPath", path);
            if (!proof.has("watchedAdEvidence")) proof.put("watchedAdEvidence", false);
            if (!proof.has("resolution")) proof.put("resolution", "PENDING_TERMINAL_EVIDENCE");
        } catch (Exception error) {
            return false;
        }
        return store.edit()
            .putString(PREFIX + session, proof.toString())
            .putString(ACTIVE_SESSION, session)
            .commit();
    }

    static boolean markWatchedAd(Context context, String sessionId, String evidence) {
        return updateResolution(context, sessionId, "REJECTED_WATCHED_AD", true, evidence);
    }

    static boolean markNormalResolved(Context context, String sessionId, String source) {
        return updateResolution(context, sessionId, "NORMAL_RESOLVED", false, source);
    }

    private static boolean updateResolution(
        Context context,
        String sessionId,
        String resolution,
        boolean watchedAd,
        String evidence
    ) {
        String session = clean(sessionId);
        if (context == null || session.isEmpty()) return false;
        SharedPreferences store = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject proof = read(store.getString(PREFIX + session, ""));
        if (proof == null || !proof.optBoolean("certified", false)) return false;
        try {
            proof.put("resolution", clean(resolution));
            proof.put("resolvedAt", System.currentTimeMillis());
            proof.put("watchedAdEvidence", watchedAd);
            String detail = clean(evidence);
            if (!detail.isEmpty()) proof.put("resolutionEvidence", detail);
        } catch (Exception error) {
            return false;
        }
        SharedPreferences.Editor editor = store.edit().putString(PREFIX + session, proof.toString());
        if (session.equals(clean(store.getString(ACTIVE_SESSION, "")))) {
            editor.remove(ACTIVE_SESSION);
        }
        return editor.commit();
    }

    static String protectedSessionId(Context context) {
        if (context == null) return "";
        SharedPreferences store = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String session = clean(store.getString(ACTIVE_SESSION, ""));
        return isProtectedPending(context, session) ? session : "";
    }

    static boolean hasCertified(Context context, String sessionId) {
        JSONObject proof = proof(context, sessionId);
        return proof != null && proof.optBoolean("certified", false);
    }

    /** Returns the immutable local screenshot path associated with this exact session. */
    static String snapshotPath(Context context, String sessionId) {
        JSONObject proof = proof(context, sessionId);
        if (proof == null || !proof.optBoolean("certified", false)) return "";
        return clean(proof.optString("snapshotPath", ""));
    }

    /**
     * HF64 recovery-only accessor. The proof store captures the value that was present on
     * the semantically certified Concluído screen before any later UI/lifecycle transition.
     * Returning it here lets terminal recovery prefer the actual result amount over the
     * immutable offered-value fallback when a runtime SharedPreferences commit was lost.
     */
    static String certifiedObservedValue(Context context, String sessionId) {
        JSONObject proof = proof(context, sessionId);
        if (proof == null || !proof.optBoolean("certified", false)) return "";
        return clean(proof.optString("observedValue", ""));
    }

    static boolean hasWatchedAdEvidence(Context context, String sessionId) {
        JSONObject proof = proof(context, sessionId);
        return proof != null && proof.optBoolean("certified", false)
            && proof.optBoolean("watchedAdEvidence", false);
    }

    static boolean isProtectedPending(Context context, String sessionId) {
        JSONObject proof = proof(context, sessionId);
        if (proof == null || !proof.optBoolean("certified", false)) return false;
        String resolution = clean(proof.optString("resolution", ""));
        return !"NORMAL_RESOLVED".equals(resolution) && !"REJECTED_WATCHED_AD".equals(resolution);
    }

    /** Restores proof-only fields; immutable freight identity is restored separately. */
    static boolean restoreToRuntime(Context context, SharedPreferences runtime, String sessionId) {
        if (context == null || runtime == null) return false;
        JSONObject proof = proof(context, sessionId);
        if (proof == null || !proof.optBoolean("certified", false)) return false;
        String session = clean(sessionId);
        SharedPreferences.Editor editor = runtime.edit()
            .putBoolean("resultCertifiedLatched", true)
            .putLong("resultCertifiedAt", proof.optLong("certifiedAt", 0L))
            .putString("resultCertifiedSessionId", session)
            .putBoolean("resultWatchedAdEvidence", proof.optBoolean("watchedAdEvidence", false));
        String observedValue = clean(proof.optString("observedValue", ""));
        if (!observedValue.isEmpty() && clean(runtime.getString("resultValue", "")).isEmpty()) {
            editor.putString("resultValue", observedValue);
        }
        String snapshotPath = clean(proof.optString("snapshotPath", ""));
        if (!snapshotPath.isEmpty() && clean(runtime.getString("resultSnapshotPath", "")).isEmpty()) {
            editor.putString("resultSnapshotPath", snapshotPath);
        }
        return editor.commit();
    }

    static void clear(Context context, String sessionId) {
        String session = clean(sessionId);
        if (context == null || session.isEmpty()) return;
        SharedPreferences store = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = store.edit().remove(PREFIX + session);
        if (session.equals(clean(store.getString(ACTIVE_SESSION, "")))) editor.remove(ACTIVE_SESSION);
        editor.commit();
    }

    private static JSONObject proof(Context context, String sessionId) {
        String session = clean(sessionId);
        if (context == null || session.isEmpty()) return null;
        SharedPreferences store = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject proof = read(store.getString(PREFIX + session, ""));
        if (proof == null || !session.equals(clean(proof.optString("sessionId", "")))) return null;
        return proof;
    }

    private static JSONObject read(String raw) {
        String value = clean(raw);
        if (value.isEmpty()) return null;
        try { return new JSONObject(value); } catch (Exception ignored) { return null; }
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
