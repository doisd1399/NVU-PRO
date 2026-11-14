package com.nvu.operacional;

/** Executes the actual production PendingTripFailurePolicy, without Android. */
public class RetryClassificationAudit {
  static void check(boolean value, String message) {
    if (!value) throw new AssertionError(message);
    System.out.println("VERIFIED " + message);
  }
  public static void main(String[] args) {
    String evidence = "REQUEST_INVALID:SIMPLE_REGISTRATION_FAILED:INVALID_ARGUMENT:Evidência Simple não confirmada.";
    check(PendingTripFailurePolicy.isPermanentRejection(evidence), "N01 exact Simple evidence failure is terminal and remains saved for review");
    check(!PendingTripFailurePolicy.canRetry("WAITING", "PENDING_SYNC", evidence), "N02 immutable invalid Simple evidence cannot retry without corrected evidence");
    check(PendingTripFailurePolicy.isPermanentRejection("GTO_RECEIPT_INVALID"), "N03 explicit GTO receipt rejection remains terminal");
    check(!PendingTripFailurePolicy.canRetry("FAILED", "FAILED", "GTO_RECEIPT_INVALID"), "N04 terminal GTO rejection cannot retry");
    check(PendingTripFailurePolicy.canRetry("FAILED", "FAILED", "SIMPLE_REGISTRATION_FAILED:UNAVAILABLE:offline"), "N05 old network failure remains recoverable");
    check(PendingTripFailurePolicy.isReconciliationRequired("Reserva sem histórico confirmado; reconciliação necessária."), "N06 inconsistent operation lock requests reconciliation");
  }
}
