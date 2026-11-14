package com.nvu.operacional;

import android.content.SharedPreferences;
import org.json.JSONObject;

/** Local UI metadata is kept separately from queue checksums and backend contracts. */
final class NativeTripReceiptPreferences {
    private static final String P = "registeredReceipt.";
    private NativeTripReceiptPreferences() {}

    static NativeTripReceipt fromAcknowledgement(JSONObject payload, JSONObject snapshot,
        String tripId, int progress) {
        boolean scopedSnapshot = snapshot != null
            && payload.optString("sessionId", "").equals(snapshot.optString("sessionId", ""))
            && payload.optString("driverId", "").equals(snapshot.optString("driverId", ""))
            && payload.optString("companyId", "").equals(snapshot.optString("companyId", ""))
            && payload.optString("jobId", "").equals(snapshot.optString("jobId", ""));
        int total = scopedSnapshot ? snapshot.optInt("jobTotalDeliveries", 0) : 0;
        // Only the acknowledged immutable payload supplies route/value/identity.
        return new NativeTripReceipt(NativeTripReceipt.State.CONFIRMED,
            payload.optString("sessionId", ""), tripId, payload.optString("driverId", ""),
            payload.optString("companyId", ""), payload.optString("jobId", ""), "",
            payload.optString("origin", ""), payload.optString("destination", ""),
            payload.optString("finalValue", ""), progress, total);
    }

    static boolean save(SharedPreferences prefs, NativeTripReceipt receipt) {
        if (prefs == null || receipt == null || receipt.state != NativeTripReceipt.State.CONFIRMED) return false;
        return prefs.edit().putString(P + "sessionId", receipt.sessionId)
            .putString(P + "tripId", receipt.tripId).putString(P + "driverId", receipt.driverId)
            .putString(P + "companyId", receipt.companyId).putString(P + "jobId", receipt.jobId)
            .putString(P + "origin", receipt.origin).putString(P + "destination", receipt.destination)
            .putString(P + "earnings", receipt.earnings).putInt(P + "progress", receipt.progress)
            .putInt(P + "total", receipt.total).commit();
    }

    static NativeTripReceipt read(SharedPreferences prefs, String sessionId) {
        if (prefs == null) return null;
        String storedSession = prefs.getString(P + "sessionId", "");
        if (storedSession.isEmpty() || (!NativeTripReceipt.clean(sessionId).isEmpty()
            && !storedSession.equals(sessionId))) return null;
        NativeTripReceipt receipt = new NativeTripReceipt(NativeTripReceipt.State.CONFIRMED,
            storedSession, prefs.getString(P + "tripId", ""), prefs.getString(P + "driverId", ""),
            prefs.getString(P + "companyId", ""), prefs.getString(P + "jobId", ""), "",
            prefs.getString(P + "origin", ""), prefs.getString(P + "destination", ""),
            prefs.getString(P + "earnings", ""), prefs.getInt(P + "progress", 0),
            prefs.getInt(P + "total", 0));
        return receipt.belongsTo(prefs.getString("driverId", "")) ? receipt : null;
    }
}
