package com.nvu.operacional;

import android.content.SharedPreferences;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Immutable scope obtained only after an authenticated Source.SERVER read. */
final class CompletedOperationScope {
    final String driverId;
    final String jobId;
    final String companyId;
    final String contractId;

    private CompletedOperationScope(String driver, String job, String company, String contract) {
        driverId = driver; jobId = job; companyId = company; contractId = contract;
    }

    static CompletedOperationScope verified(String authenticatedUid, String jobId, String ownerId,
                                             String companyId, String contractId, String status) {
        String uid = clean(authenticatedUid), job = clean(jobId), owner = clean(ownerId);
        String company = clean(companyId), contract = clean(contractId);
        if (uid.isEmpty() || !uid.equals(owner) || !job.matches("[A-Za-z0-9_-]{1,180}")
            || company.isEmpty() || contract.isEmpty() || !"completed".equalsIgnoreCase(clean(status))) return null;
        return new CompletedOperationScope(uid, job, company, contract);
    }

    boolean matches(SharedPreferences entry) {
        return driverId.equals(clean(entry.getString("driverId", "")))
            && jobId.equals(clean(entry.getString("jobId", "")))
            && companyId.equals(clean(entry.getString("companyId", "")))
            && contractId.equals(clean(entry.getString("contractId", "")))
            && capturedMatches(entry, "captureDriverId", driverId)
            && capturedMatches(entry, "captureJobId", jobId)
            && capturedMatches(entry, "captureCompanyId", companyId)
            && capturedMatches(entry, "captureContractId", contractId);
    }

    String markerKey() {
        try {
            StringBuilder value = new StringBuilder();
            for (String part : new String[]{driverId, jobId, companyId, contractId})
                value.append(part.length()).append(':').append(part);
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(value.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder("completedProOperation:");
            for (byte b : hash) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static boolean capturedMatches(SharedPreferences entry, String key, String expected) {
        String captured = clean(entry.getString(key, ""));
        return captured.isEmpty() || expected.equals(captured);
    }
    private static String clean(String value) { return value == null ? "" : value.trim(); }
}
