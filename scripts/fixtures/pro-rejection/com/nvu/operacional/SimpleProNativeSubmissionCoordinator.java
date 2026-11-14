package com.nvu.operacional;
import java.util.Locale;
/** Only the coordinator dependency is a double; the store and policies are real. */
final class SimpleProNativeSubmissionCoordinator {
 interface AccessRecoveryListener { void onResult(boolean allowed); }
 static boolean accessAllowed=false;
 static void probeCompanyAccess(android.content.Context c,String company,AccessRecoveryListener l){l.onResult(accessAllowed);}
 interface CompatibilityListener { void onResult(boolean compatible, boolean unavailable); }
 static boolean capabilityCompatible=false;
 static void probeGtoBackendCompatibility(android.content.Context c,CompatibilityListener l){l.onResult(capabilityCompatible,false);}
 static final class Receipt {
  final int amountCents; final String currency,bonusEvidence;
  Receipt(int c,String m,boolean e,String b){amountCents=c;currency=m;bonusEvidence=b;}
 }
 static Receipt parseReceipt(String sim,String raw){
  Long cents=GtoProReceiptValidationPolicy.readAmountCents(raw);
  return cents==null?null:new Receipt(cents.intValue(),"",true,"NONE");
 }
 static boolean isPermissionFailureReason(String reason){return reason!=null&&reason.toLowerCase(Locale.ROOT).contains("permission_denied");}
}
