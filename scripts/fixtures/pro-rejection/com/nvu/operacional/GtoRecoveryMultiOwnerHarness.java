package com.nvu.operacional;
import java.util.*;

/** Actual store/policies with synthetic SharedPreferences supplied by the
 * existing harness. No Android bridge, Firebase auth or HTTP is simulated here. */
final class GtoRecoveryMultiOwnerHarness {
 static int assertions=0;
 static void eq(Object actual,Object expected,String label) {
  assertions++; if(!Objects.equals(actual,expected))
   throw new AssertionError(label+" expected="+expected+" actual="+actual);
 }
 static ProRejectionHarness.Prefs seed(ProRejectionHarness.Ctx c,ProRejectionHarness.Prefs index,int owner) {
  String id="synthetic-attempt-owner-"+owner;
  index.data.put("pendingProTripAttemptIds","[\""+id+"\"]");
  ProRejectionHarness.Prefs p=(ProRejectionHarness.Prefs)ProPendingTripStore.entry(c,id);
  p.data.clear();
  p.data.put("driverId","synthetic-owner-"+owner);
  p.data.put("captureAttemptId",id);
  for(String[] binding:new String[][]{{"Job","synthetic-job-"+owner},{"Company","synthetic-company-"+owner},{"Contract","synthetic-contract-"+owner}}) {
   p.data.put("capture"+binding[0]+"Id",binding[1]);
   p.data.put(binding[0].toLowerCase(Locale.ROOT)+"Id",binding[1]);
  }
  p.data.put("captureContextEpoch","global-truck:synthetic:"+owner);
  p.data.put("captureOrigin","Cidade origem "+owner);p.data.put("captureDestination","Cidade destino "+owner);
  p.data.put("captureSimulatorKey","global-truck");p.data.put("captureSimulatorCode","GTO");
  p.data.put("capturePackageId","com.stargamesapps.gto");
  p.data.put("receiptSnapshotVersion",1);p.data.put("receiptAmountCents",575000);
  p.data.put("receiptCurrency","");p.data.put("receiptBonusEvidence","NONE");
  p.data.put("receiptText","CONCLUÍDO\nVALOR A RECEBER: 5.750,00");p.data.put("receiptCapturedAt",1791418810266L+owner);
  p.data.put("queueStatus","FAILED");p.data.put("outboxState","FAILED");p.data.put("nativeAttemptGeneration",5);
  p.data.put("reasonCode","GTO_SERVER_CONTRACT_MISMATCH");
  p.data.put("lastQueueErrorCode","INVALID_ARGUMENT");
  p.data.put("lastQueueError","GTO_PRO_REGISTRATION_FAILED:INVALID_ARGUMENT:Recibo ou contexto GTO inválido.");
  p.data.put("lastQueueCallable","registerGtoProReceipt");p.data.put("lastFailureStage","CALLABLE_REGISTRATION");
  return p;
 }
 public static void main(String[] args) {
  Map<String,Object> capability=new HashMap<>();
  capability.put("compatible",true);capability.put("callable","registerGtoProReceipt");
  capability.put("contractVersion",GtoBackendCompatibilityPolicy.VERSION);capability.put("allowsUnknownCurrency",true);
  eq(GtoBackendCompatibilityPolicy.isCompatible(capability),true,"actual protocol");
  for(Object v:new Object[]{"gto-contract-v1",2,null}) {
   Map<String,Object> invalid=new HashMap<>(capability);invalid.put("contractVersion",v);
   eq(GtoBackendCompatibilityPolicy.isCompatible(invalid),false,"server version checked");
  }
  Map<String,Object> unknownPolicy=new HashMap<>(capability);unknownPolicy.remove("allowsUnknownCurrency");
  eq(GtoBackendCompatibilityPolicy.isCompatible(unknownPolicy),false,"currency capability mandatory");
  for(int owner=1;owner<=4;owner++) {
   ProRejectionHarness.Ctx c=new ProRejectionHarness.Ctx();ProRejectionHarness.Prefs index=new ProRejectionHarness.Prefs();
   ProRejectionHarness.Prefs p=seed(c,index,owner);
   String id=p.getString("captureAttemptId",""),uid=p.getString("driverId","");
   String snapshot=ProPendingTripStore.contractRecoveryFingerprint(p);
   eq(ProPendingTripStore.canRequestContractRecovery(p),true,"owner-independent eligibility");
   eq(ProPendingTripStore.isRetryAllowed(p),false,"no send before compatibility");
   eq(ProPendingTripStore.authorizeSpecificGtoContractMismatch(c,index,id,"other-user",GtoBackendCompatibilityPolicy.VERSION,snapshot),false,"owner guard");
   eq(ProPendingTripStore.authorizeSpecificGtoContractMismatch(c,index,id,uid,"old-version",snapshot),false,"version guard");
   // The current operation/route may have changed since this receipt was captured.
   ((ProRejectionHarness.Prefs)c.getSharedPreferences("nvu_simple_automation",0)).data.put("origin","Next freight city");
   eq(ProPendingTripStore.authorizeSpecificGtoContractMismatch(c,index,id,uid,GtoBackendCompatibilityPolicy.VERSION,snapshot),true,"frozen route wins");
   eq(ProPendingTripStore.requestSpecificGtoContractMismatch(c,index,id,uid),"pending-retry-requested","explicit retry");
   eq(ProPendingTripStore.claim(c,index,id),6,"first claim");
   int generation=p.getInt("nativeAttemptGeneration",0);
   eq(ProPendingTripStore.authorizeSpecificGtoContractMismatch(c,index,id,uid,GtoBackendCompatibilityPolicy.VERSION,snapshot),true,"idempotent authorization");
   eq(ProPendingTripStore.requestSpecificGtoContractMismatch(c,index,id,uid),"pending-already-sending","second tap");
   eq(p.getInt("nativeAttemptGeneration",0),generation,"live callback generation retained");
   eq(ProPendingTripStore.claim(c,index,id),-1,"single live owner");
   // A process restart cannot discard the frozen permit; a stale lease can
   // retry the SAME identity after a lost ACK instead of becoming stuck.
   p.data.put("queueClaimedAt",System.currentTimeMillis()-60000L);
   eq(ProPendingTripStore.claim(c,index,id),7,"stale lease recovery");
   p.data.put("queueStatus","WAITING");p.data.put("outboxState","PENDING_SYNC");
   p.data.put("reasonCode","");p.data.put("lastQueueErrorCode","GTO_PRO_REGISTRATION_FAILED:UNAVAILABLE:network");
   p.data.put("lastQueueError","network");p.data.put("retryAt",0L);
   eq(ProPendingTripStore.claim(c,index,id),8,"transport resume uses same receipt");
   eq(ProPendingTripStore.contractRecoveryFingerprint(p),snapshot,"payload exact across retries");
   eq(p.getInt("receiptAmountCents",0),575000,"cents frozen");
   eq(p.getString("receiptCurrency",""),"","no currency guess");
   // ACK ID may be saved before process death/queue removal. Replaying it
   // must not invalidate the immutable capture permit.
   p.data.put("submissionTripId","nvu_"+p.getString("jobId","")+"_4_ack");
   p.data.put("queueClaimedAt",System.currentTimeMillis()-60000L);
   eq(ProPendingTripStore.claim(c,index,id),9,"durable ACK before crash keeps same attempt recoverable");
   p.data.put("queueStatus","FAILED");p.data.put("outboxState","FAILED");p.data.put("reasonCode","GTO_CURRENCY_CONFLICT");
   eq(ProPendingTripStore.isRetryAllowed(p),false,"structured domain rejection");
   eq(ProPendingTripStore.canRequestContractRecovery(p),false,"domain rejection not offered");
   p=seed(c,index,owner);snapshot=ProPendingTripStore.contractRecoveryFingerprint(p);
   p.data.put("captureOrigin","Altered before callback");
   eq(ProPendingTripStore.authorizeSpecificGtoContractMismatch(c,index,id,uid,GtoBackendCompatibilityPolicy.VERSION,snapshot),false,"asynchronous snapshot guard");
   p=seed(c,index,owner);p.data.put("receiptSnapshotVersion",0);int edits=p.edits;
   eq(ProPendingTripStore.canRequestContractRecovery(p),false,"unfrozen legacy snapshot requires review");
   eq(p.edits,edits,"inspection read-only");
   p=seed(c,index,owner);p.data.put("captureJobId","different-physical-job");
   eq(ProPendingTripStore.canRequestContractRecovery(p),false,"capture/primary binding");
   p=seed(c,index,owner);p.data.put("reasonCode","");
   eq(ProPendingTripStore.canRequestContractRecovery(p),true,"same generic old error without heuristic");
   p=seed(c,index,owner);p.data.put("operationClosed",true);
   eq(ProPendingTripStore.canRequestContractRecovery(p),false,"closed operation");
  }
  System.out.println("PASS "+assertions+" recovery assertions across four synthetic owners; exact payload, protocol, stale lease, no global release");
 }
}
