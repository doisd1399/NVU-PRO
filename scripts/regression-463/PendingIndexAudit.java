package com.nvu.operacional;
import java.util.*;

/** Actual store, with the same explicit Android storage doubles as the project tests. */
public class PendingIndexAudit {
  public static void main(String[] args) {
    ProRejectionHarness.Ctx context = new ProRejectionHarness.Ctx();
    ProRejectionHarness.Prefs source = new ProRejectionHarness.Prefs();
    String id = "audit-index-attempt-123456";
    source.data.put("captureAttemptId", id);
    source.data.put("captureSimulatorKey", "global-truck");
    source.data.put("captureDriverId", "audit-driver");
    source.data.put("driverId", "audit-driver");
    source.data.put("captureJobId", "audit-job");
    source.data.put("captureCompanyId", "audit-company");
    source.data.put("captureContractId", "audit-contract");
    source.data.put("captureOrigin", "Audit origin");
    source.data.put("captureDestination", "Audit destination");
    source.failCommitNumber = 2; // Durable journal and isolated entry succeed, JSON index fails.
    String result = ProPendingTripStore.enqueue(context, source, "CONCLUÍDO\nVALOR A RECEBER R$ 100,00");
    ProRejectionHarness.equal(result, "", "enqueue reports index failure");
    ProRejectionHarness.equal(ProPendingTripStore.ids(source).size(), 1, "durable journal recovers an unindexed attempt");
    ProRejectionHarness.Prefs stored = (ProRejectionHarness.Prefs)ProPendingTripStore.entry(context, id);
    ProRejectionHarness.equal(stored.getInt("receiptAmountCents", 0), 10000, "isolated receipt actually persisted");
    System.out.println("VERIFIED C23 journal recovers receipt after index commit failure");
    source.failCommitNumber = -1;
    source.data.put("pendingProTripAttemptIds", "invalid-json");
    ProRejectionHarness.equal(ProPendingTripStore.ids(source).size(), 1, "corrupt index silently becomes empty");
    ProRejectionHarness.equal(stored.getInt("receiptAmountCents", 0), 10000, "receipt still exists outside index");
    System.out.println("VERIFIED C24 corrupt queue index retains receipt via durable journal");
    // Crash after journal commit but before isolated receipt commit: incomplete
    // attempt must never be submitted to the server.
    String ghostId = "audit-incomplete-attempt-87654321";
    ProRejectionHarness.Prefs ghostSource = new ProRejectionHarness.Prefs();
    ghostSource.data.put("captureAttemptId", ghostId);
    ghostSource.data.put("captureSimulatorKey", "global-truck");
    ghostSource.data.put("captureDriverId", "audit-driver");
    ghostSource.data.put("captureJobId", "audit-job");
    ghostSource.data.put("captureCompanyId", "audit-company");
    ghostSource.data.put("captureContractId", "audit-contract");
    ghostSource.data.put("captureOrigin", "A");
    ghostSource.data.put("captureDestination", "B");
    ProRejectionHarness.Prefs ghostEntry = (ProRejectionHarness.Prefs)ProPendingTripStore.entry(context, ghostId);
    ghostEntry.failCommitNumber = 1;
    String result2 = ProPendingTripStore.enqueue(context, ghostSource, "CONCLUÍDO\nVALOR A RECEBER R$ 100,00");
    ProRejectionHarness.equal(result2, "", "isolated storage failure reported");
    ProRejectionHarness.equal(ProPendingTripStore.contains(ghostSource, ghostId), true, "journal remembers interrupted attempt");
    ProRejectionHarness.equal(ProPendingTripStore.claim(context, ghostSource, ghostId), -1, "incomplete receipt never claimed");
    System.out.println("VERIFIED C24 crash before receipt commit cannot emit ghost trip");
  }
}
