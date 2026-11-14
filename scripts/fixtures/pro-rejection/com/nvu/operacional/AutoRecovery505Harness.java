package com.nvu.operacional;
final class AutoRecovery505Harness {
 static void check(boolean value,String label){if(!value)throw new AssertionError(label);}
 public static void main(String[] args){
  ProRejectionHarness.Ctx c=new ProRejectionHarness.Ctx();ProRejectionHarness.Prefs index=new ProRejectionHarness.Prefs();
  ProRejectionHarness.Prefs p=GtoRecoveryMultiOwnerHarness.seed(c,index,9);
  GtoFirebaseRuntime.user=new com.google.firebase.auth.FirebaseUser("synthetic-owner-9");
  SimpleProNativeSubmissionCoordinator.capabilityCompatible=false;
  ProPendingTripStore.recoverAutomatically(c,index);
  check("FAILED".equals(p.getString("queueStatus","")),"incompatible backend must keep saved attempt blocked");
  p.data.put("autoCompatibilityProbeAt505",0L);SimpleProNativeSubmissionCoordinator.capabilityCompatible=true;
  String before=ProPendingTripStore.contractRecoveryFingerprint(p);
  ProPendingTripStore.recoverAutomatically(c,index);
  check("WAITING".equals(p.getString("queueStatus","")),"compatible backend must automatically release exact old failure");
  check(before.equals(ProPendingTripStore.contractRecoveryFingerprint(p)),"evidence must remain immutable");
  check(ProPendingTripJobService.scheduled>0,"recovered attempt must be scheduled");
  p=GtoRecoveryMultiOwnerHarness.seed(c,index,10);GtoFirebaseRuntime.user=new com.google.firebase.auth.FirebaseUser("other-user");
  ProPendingTripStore.recoverAutomatically(c,index);check("FAILED".equals(p.getString("queueStatus","")),"other owner cannot recover a receipt");
  GtoFirebaseRuntime.user=new com.google.firebase.auth.FirebaseUser("synthetic-owner-10");
  p.data.put("lastQueueErrorCode","GTO_PRO_REGISTRATION_FAILED:UNAVAILABLE:network");p.data.put("lastQueueError","network");p.data.put("reasonCode","");
  ProPendingTripStore.recoverAutomatically(c,index);check("WAITING".equals(p.getString("queueStatus","")),"transport FAILED must recover");
  check(p.getLong("retryAt",0L)>System.currentTimeMillis(),"automatic transport recovery must back off");
  p.data.put("queueStatus","FAILED");p.data.put("outboxState","FAILED");p.data.put("serverRetryableExplicit",true);p.data.put("serverRetryable",false);
  ProPendingTripStore.recoverAutomatically(c,index);check("FAILED".equals(p.getString("queueStatus","")),"server nonretryable must stay blocked");
  p=GtoRecoveryMultiOwnerHarness.seed(c,index,11);GtoFirebaseRuntime.user=new com.google.firebase.auth.FirebaseUser("synthetic-owner-11");
  p.data.put("queueStatus","PERMISSION_PAUSED");p.data.put("outboxState","PENDING_SYNC");p.data.put("reasonCode","");p.data.put("lastQueueErrorCode","PERMISSION_DENIED");p.data.put("lastQueueError","server permission");p.data.put("nativeAuthState","MATCH");
  SimpleProNativeSubmissionCoordinator.accessAllowed=false;ProPendingTripStore.recoverAutomatically(c,index);
  check("PERMISSION_PAUSED".equals(p.getString("queueStatus","")),"negative authorization probe keeps pause");
  p.data.put("autoAccessProbeAt505",0L);SimpleProNativeSubmissionCoordinator.accessAllowed=true;ProPendingTripStore.recoverAutomatically(c,index);
  check("WAITING".equals(p.getString("queueStatus","")),"server-confirmed access resumes permission pause");
  check(ProPendingTripStore.claim(c,index,p.getString("captureAttemptId",""))>=0,"old permission code must not veto an authorized resumed claim");
  System.out.println("AUTO_RECOVERY_505_JVM_PASS 11 assertions; real store/policy, controlled Auth and capability boundary");
 }
}
