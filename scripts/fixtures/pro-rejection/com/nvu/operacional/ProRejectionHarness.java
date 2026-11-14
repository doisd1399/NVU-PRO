package com.nvu.operacional;
import android.content.*;
import java.util.*;
public class ProRejectionHarness {
 static class Prefs implements SharedPreferences {
  final Map<String,Object> data=new HashMap<>(); boolean fail=false; int edits=0; int commits=0; int failCommitNumber=-1;
  public String getString(String k,String d){return (String)data.getOrDefault(k,d);}
  public boolean getBoolean(String k,boolean d){return (Boolean)data.getOrDefault(k,d);}
  public int getInt(String k,int d){return ((Number)data.getOrDefault(k,d)).intValue();}
  public long getLong(String k,long d){return ((Number)data.getOrDefault(k,d)).longValue();}
  public boolean contains(String k){return data.containsKey(k);}
  public java.util.Map<String, ?> getAll(){return new HashMap<>(data);}
  public Editor edit(){edits++;return new Edit();}
  class Edit implements Editor {
   final Map<String,Object> next=new HashMap<>(data);
   public Editor clear(){next.clear();return this;}
   public Editor remove(String k){next.remove(k);return this;}
   public Editor putString(String k,String v){next.put(k,v);return this;}
   public Editor putBoolean(String k,boolean v){next.put(k,v);return this;}
   public Editor putInt(String k,int v){next.put(k,v);return this;}
   public Editor putLong(String k,long v){next.put(k,v);return this;}
   public boolean commit(){commits++;if(fail || commits==failCommitNumber)return false;data.clear();data.putAll(next);return true;}
   public void apply(){commit();}
  }
 }
 static class Ctx extends Context {
  final Map<String,Prefs> all=new HashMap<>(); boolean failDelete=false;
  public SharedPreferences getSharedPreferences(String n,int m){return all.computeIfAbsent(n,k->new Prefs());}
  public boolean deleteSharedPreferences(String n){return !failDelete && all.remove(n)!=null;}
 }
 static void equal(Object a,Object b,String message){if(!Objects.equals(a,b))throw new AssertionError(message+" expected="+b+" actual="+a);}
 static Prefs seed(Ctx ctx,Prefs index,String state,String error) {
  index.data.put("pendingProTripAttemptIds","[\"pro-123456789-a1\"]");
  Prefs p=(Prefs)ProPendingTripStore.entry(ctx,"pro-123456789-a1");p.data.clear();
  p.data.put("driverId","driver123456");p.data.put("queueStatus",state);
  p.data.put("outboxState",state.equals("SENDING")?"SYNCING":state.equals("WAITING")?"PENDING_SYNC":state);
  p.data.put("lastQueueErrorCode",error);p.data.put("lastQueueError","Mensagem original");p.data.put("reasonCode","");
  p.data.put("receiptSnapshotVersion",1);p.data.put("receiptAmountCents",256300);p.data.put("receiptCurrency","");
  p.data.put("receiptBonusEvidence","NONE");p.data.put("receiptText","CONCLUÍDO\nVALOR A RECEBER:  2.563,00");
  p.data.put("captureOrigin","Cruz do Oeste");p.data.put("captureDestination","Registro");p.data.put("jobId","job12345678");
  p.data.put("captureAttemptId","pro-123456789-a1");p.data.put("nativeAttemptGeneration",5);
  return p;
 }
 static void preserved(Prefs p,Map<String,Object> before) {
  for(String k:new String[]{"receiptText","receiptAmountCents","receiptCurrency","receiptBonusEvidence","captureOrigin","captureDestination","jobId","captureAttemptId","driverId","lastQueueErrorCode","lastQueueError"})equal(p.data.get(k),before.get(k),"immutable "+k);
 }
 public static void main(String[] args) {
  Ctx c=new Ctx();Prefs i=new Prefs();String id="pro-123456789-a1",uid="driver123456";
  for(String error:new String[]{
   "GTO_PRO_REGISTRATION_FAILED:INVALID_ARGUMENT:Recibo ou contexto GTO inválido.",
   "GTO_PRO_REGISTRATION_FAILED:FAILED_PRECONDITION:Operação encerrada ou sem entregas disponíveis.",
   "NATIVE_RECEIPT_EVIDENCE_CONFLICT",
   "GTO_PRO_REGISTRATION_FAILED:FAILED_PRECONDITION:A tentativa salva diverge do registro anterior."}) {
   Prefs p=seed(c,i,"FAILED",error);Map<String,Object> before=new HashMap<>(p.data);int edits=p.edits;
   equal(ProPendingTripStore.requestRetry(c,i,id,uid),"retry-blocked","terminal retry");equal(p.data,before,"terminal unchanged");equal(p.edits,edits,"no terminal write");
   ProPendingTripStore.recoverLegacyGtoRejection(c,i);equal(p.data,before,"terminal not auto-migrated");
  }
  Prefs p=seed(c,i,"FAILED","UNKNOWN");equal(ProPendingTripStore.requestRetry(c,i,id,uid),"retry-blocked","unknown failure");
  p=seed(c,i,"WAITING","");Map<String,Object> before=new HashMap<>(p.data);
  equal(ProPendingTripStore.requestRetry(c,i,id,"other-user"),"auth-required","owner guard");equal(p.data,before,"foreign owner cannot write");
  p=seed(c,i,"FAILED","GTO_PRO_REGISTRATION_FAILED:UNAVAILABLE:network");before=new HashMap<>(p.data);
  equal(ProPendingTripStore.requestRetry(c,i,id,uid),"pending-retry-requested","recoverable failure");preserved(p,before);equal(p.getString("queueStatus",""),"WAITING","released status");
  equal(ProPendingTripStore.claim(c,i,id),6,"first claim");equal(ProPendingTripStore.claim(c,i,id),-1,"second owner cannot claim");
  p=seed(c,i,"SENDING","");p.data.put("queueClaimedAt",System.currentTimeMillis());before=new HashMap<>(p.data);
  equal(ProPendingTripStore.requestRetry(c,i,id,uid),"pending-already-sending","live claim guard");equal(p.data,before,"live claim unchanged");
  p.data.put("queueClaimedAt",System.currentTimeMillis()-60000L);before=new HashMap<>(p.data);
  equal(ProPendingTripStore.requestRetry(c,i,id,uid),"pending-retry-requested","stale claim release");equal(p.getInt("nativeAttemptGeneration",0),6,"invalidate stale callback");preserved(p,before);
  p=seed(c,i,"WAITING","");p.fail=true;before=new HashMap<>(p.data);
  equal(ProPendingTripStore.requestRetry(c,i,id,uid),"retry-unavailable","failed disk write");equal(p.data,before,"failed commit preserves queue");p.fail=false;
  p=seed(c,i,"FAILED","GTO_PRO_REGISTRATION_FAILED:FAILED_PRECONDITION:OPERATION_RECONCILIATION_REQUIRED");before=new HashMap<>(p.data);
  ProPendingTripStore.recoverLegacyGtoRejection(c,i);equal(p.getString("queueStatus",""),"WAITING","reconciliation recoverable");
  for(String k:new String[]{"receiptText","receiptAmountCents","receiptCurrency","captureOrigin","captureDestination","captureAttemptId","jobId"})equal(p.data.get(k),before.get(k),"migration frozen");
  // R4: only the exact old contract mismatch can be authorized after a
  // separate authenticated compatibility probe; the same immutable attempt is
  // then claimed once and cannot be fanned out by a second owner.
  p=seed(c,i,"FAILED","GTO_PRO_REGISTRATION_FAILED:INVALID_ARGUMENT:Recibo ou contexto GTO inválido.");
  p.data.put("outboxState","FAILED");
  p.data.put("reasonCode","GTO_SERVER_CONTRACT_MISMATCH");
  p.data.put("lastQueueCallable","registerGtoProReceipt");
  p.data.put("lastFailureStage","CALLABLE_REGISTRATION");
  p.data.put("companyId","company123456"); p.data.put("contractId","contract123456");
  p.data.put("captureCompanyId","company123456"); p.data.put("captureContractId","contract123456");
  p.data.put("captureJobId","job12345678");
  p.data.put("captureContextEpoch","global-truck:12345678");
  p.data.put("captureSimulatorKey","global-truck"); p.data.put("captureSimulatorCode","GTO");
  p.data.put("capturePackageId","com.stargamesapps.gto");
  equal(ProPendingTripStore.isSpecificGtoContractMismatchCandidate(p),true,"R4 exact candidate");
  equal(ProPendingTripStore.isRetryAllowed(p),false,"R4 starts blocked");
  equal(ProPendingTripStore.authorizeSpecificGtoContractMismatch(c,i,id,uid,"gto-contract-v2",
    ProPendingTripStore.contractRecoveryFingerprint(p)),true,"recovery authorized");
  equal(ProPendingTripStore.isRetryAllowed(p),true,"R4 authorized retry");
  equal(ProPendingTripStore.requestSpecificGtoContractMismatch(c,i,id,uid),"pending-retry-requested","R4 request");
  equal(ProPendingTripStore.claim(c,i,id),6,"R4 one claim");
  equal(ProPendingTripStore.claim(c,i,id),-1,"R4 no duplicate claim");
  equal(p.getString("receiptText",""),"CONCLUÍDO\nVALOR A RECEBER:  2.563,00","R4 receipt frozen");

  String raw="CONCLUÍDO\nVALOR A RECEBER:  2.563,00";
  equal(GtoProReceiptValidationPolicy.validate("job12345678","company123456","contract123456",id,"global-truck:12345678","Cruz do Oeste","Registro",raw,256300,"NONE",""),"","native no currency accepted");
  equal(GtoProReceiptValidationPolicy.validate("job12345678","short","contract123456",id,"global-truck:12345678","Cruz do Oeste","Registro",raw,256300,"NONE",""),"GTO_CONTEXT_INVALID","backend ID format");
  equal(GtoProReceiptValidationPolicy.validate("job12345678","company123456","contract123456",id,"global-truck:12345678","Cruz do Oeste","Registro",raw,256301,"NONE",""),"GTO_AMOUNT_INVALID","frozen amount matches OCR");
  equal(GtoProReceiptValidationPolicy.validate("job12345678","company123456","contract123456",id,"global-truck:12345678","Cruz do Oeste","Registro",raw,256300,"NONE","simple_driver123456_web1"),"","adopted Web ID can be retried");
  equal(GtoProReceiptValidationPolicy.validate("job12345678","company123456","contract123456",id,"global-truck:12345678","Cruz do Oeste","Registro",raw,256300,"NONE","nvu_anotherjob_slot"),"GTO_PREVIOUS_TRIP_INVALID","foreign operation prefix rejected");
  equal(GtoProReceiptValidationPolicy.validate("job12345678","company123456","contract123456",id,"global-truck:12345678","Cruz do Oeste","Registro",raw,256300,"NONE","simple_bad/path"),"GTO_PREVIOUS_TRIP_INVALID","malformed Web ID rejected");
  equal(ProPendingTripStore.requestRetry(c,i,"missing-attempt",uid),"pending-not-found","missing row never claims sending");
  System.out.println("PASS native store: rejection, owner, migration, immutable retry, disk failure, stale claim, single owner");
  StringJoiner output=new StringJoiner(",","[","]");
  for(String sample:args)output.add(String.valueOf(GtoProReceiptValidationPolicy.readAmountCents(sample)));
  System.out.println(output);
 }
}
