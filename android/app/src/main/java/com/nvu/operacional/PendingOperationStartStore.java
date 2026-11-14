package com.nvu.operacional;

import android.content.Context;
import android.content.SharedPreferences;

/** Local ordering barrier only. It never authorizes a remote operation/trip. */
final class PendingOperationStartStore {
    private static final String PREFS = "nvu_operation_start_barriers_v1";
    private static String key(String driver, String company, String job) {
        return driver.length() + ":" + driver + company.length() + ":" + company + job.length() + ":" + job;
    }
    static boolean set(Context context, String driver, String company, String job, boolean pending) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String id = key(driver, company, job);
        if (prefs.getBoolean(id, false) == pending) return true;
        return prefs.edit().putBoolean(id, pending).commit();
    }
    static boolean setCapturePaused(Context context, String driver, String company, String job, boolean paused) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String id = "capture:" + key(driver, company, job);
        if (prefs.getBoolean(id, false) == paused) return true;
        return prefs.edit().putBoolean(id, paused).commit();
    }
    /** Pauses only new capture. Existing immutable receipts still upload. */
    static boolean capturePaused(Context context, SharedPreferences current) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("capture:" + key(
            current.getString("driverId", ""), current.getString("companyId", ""), current.getString("jobId", "")), false);
    }
    static boolean blocks(Context context, SharedPreferences receipt) {
        return blocks(context, binding(receipt, "Driver"), binding(receipt, "Company"), binding(receipt, "Job"));
    }
    static boolean blocks(Context context, String driver, String company, String job) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(key(driver, company, job), false);
    }
    private static String binding(SharedPreferences receipt, String name) {
        String captured = receipt.getString("capture" + name + "Id", "");
        return captured == null || captured.trim().isEmpty()
            ? receipt.getString(name.substring(0, 1).toLowerCase(java.util.Locale.ROOT) + name.substring(1) + "Id", "")
            : captured;
    }
}
