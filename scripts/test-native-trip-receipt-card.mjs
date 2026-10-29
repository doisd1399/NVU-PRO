import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Android fakes exercise scheduling/window ownership, not device pixels.
// Both harnesses embed the exact current production service methods.
const native = "android/app/src/main/java/com/nvu/operacional/";
const fixtures = "scripts/fixtures/native-receipt/";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-receipt-"));
const sources = [];
const read = p => fs.readFileSync(p,"utf8");
const put = (name,code) => {
 const file=path.join(tmp,name);
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,code);sources.push(file);
};
const slice=(s,a,b)=>{
 const start=s.indexOf(a),end=s.indexOf(b,start+a.length);
 if(start<0||end<0)throw new Error("Missing production section "+a);
 return s.slice(start,end);
};
const pro=read(native+"SimpleAutomationService.java");
const max=read(native+"GtoObserverService.java");
const stubs=JSON.parse(read(fixtures+"android-stubs.json"));
for(const [name,code] of Object.entries(stubs))put(name,code);
const common=read(fixtures+"CommonFields.java.fragment");
const embed=(name,methods)=>put("com/nvu/operacional/"+name+".java",
 read(fixtures+name+".java.template").replace("__COMMON__",common).replace("__METHODS__",methods));
embed("ProReceiptHarness",
 slice(pro,"    private void applyBubbleCardVisibility(","    private void moveMenuAwayFromStatusChip()")+
 slice(pro,"    private void restoreMenuAfterStatusChip()","    private void toggleMenu()")+
 slice(pro,"    private void closeMenu()","    private void hideCaptureInteractiveOverlaysKeepBubble()"));
embed("MaxReceiptHarness",
 slice(max,"    private void showTripRegisteredCard(String","    private void announceCurrentTripSubmissionState()")+
 slice(max,"    private void closeMenu(boolean","    private synchronized void clearBubbleReferenceAndRemove(")+
 slice(max,"    private void cancelScheduledStatusChipHide()","    private void requestManualFinishCapture()"));
put("com/nvu/operacional/NativeReceiptRuntimeTest.java",read(fixtures+"NativeReceiptRuntimeTest.java"));
put("ParseNativeSources.java",read(fixtures+"ParseNativeSources.java"));
const names=["NativeTripReceipt","NativeCompactMenuView","NativeRouteReadySnapshot","NativeOverlayCardVisibility","NativeBubbleVisibility",
 "NativeReceiptCardLayoutPolicy","NativeTripReceiptPreferences","NativeTripReceiptCardView","GtoOverlayLayoutPolicy"];
try {
 const run=args=>{
  const result=spawnSync("java",args,{encoding:"utf8",maxBuffer:4e6});
  if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
  if(result.status!==0)throw new Error("Java command failed: "+result.status);
 };
 run(["-m","jdk.compiler/com.sun.tools.javac.Main","-encoding","UTF-8","-d",path.join(tmp,"classes"),
  ...sources,...names.map(n=>native+n+".java")]);
 run(["-cp",path.join(tmp,"classes"),"com.nvu.operacional.NativeReceiptRuntimeTest"]);
 run(["-cp",path.join(tmp,"classes"),"ParseNativeSources",...names.map(n=>native+n+".java"),
  ...["SimpleAutomationService","GtoObserverService","GtoAutoTripSync","GtoTripSubmissionCoordinator"].map(n=>native+n+".java"),
  "android/app/src/androidTest/java/com/nvu/operacional/NativeTripReceiptCardInstrumentationTest.java"]);
 const sync=read(native+"GtoAutoTripSync.java");
 const callback=max.slice(max.indexOf("private GtoAutoTripSync.Listener automaticTripSyncListener()"));
 const checks=[
  ["receipt frozen before queue cleanup",sync.indexOf("NativeTripReceipt receipt =")<sync.indexOf("if (!queue.edit().remove(key).commit())")],
  ["ACK listener forwards immutable receipt",sync.includes("listener.onSynced(sessionId, tripId, receipt);")
   &&read(native+"GtoTripSubmissionCoordinator.java").includes("listener.onSynced(callbackSessionId, tripId, receipt);")],
  ["callback cannot borrow live freight fields",!callback.slice(0,callback.indexOf("public void onPending")).includes('putString("lastRegisteredTripOrigin"')],
  ["global teardown includes receipt cleanup",slice(max,"private synchronized void removeAllOverlays()","private int overlayType()").includes("hideTripRegisteredCard();")],
  ["own receipt excluded from OCR",max.includes("ocrLineOverlapsView(lineRect, tripRegisteredCardView)")],
  ["Pro menu never docks bubble",!slice(pro,"private void adjustProMenuLayoutAfterMeasure()","private void showStatusChip(").includes("bubbleParams.x =")],
  ["Max menu never docks bubble",!slice(max,"private void adjustOpenMenuLayoutAfterMeasure()","private boolean shouldMinimizeMenuForConfirmedExternalApp").includes("bubbleParams.x =")],
  ["both menus close outside without a reserved X row",pro.includes("NativeCompactMenuView.bindOutsideDismiss")&&max.includes("NativeCompactMenuView.bindOutsideDismiss")
   &&!pro.includes("NativeTripReceiptCardView.addCloseControl")&&!max.includes("NativeTripReceiptCardView.addCloseControl")],
  ["new bubble starts hidden during a card",pro.indexOf("applyBubbleCardVisibility(cardVisibility.isSuppressed());",pro.indexOf("private void showBubbleIfAllowed(boolean"))<pro.indexOf("windowManager.addView(bubbleView, bubbleParams);")
   &&max.indexOf("applyBubbleCardVisibility(cardVisibility.isSuppressed());",max.indexOf("private synchronized void showBubbleIfAllowed()"))<max.indexOf("windowManager.addView(bubbleAddedView, bubbleParams);")]
 ];
 for(const [name,pass]of checks){if(!pass)throw new Error(name);console.log("PASS integration "+name);}
 console.log("Native receipt integration: PASS "+checks.length+"/"+checks.length);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
