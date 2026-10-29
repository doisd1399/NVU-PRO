import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// Executes exact production methods with Android doubles. Not an Android emulator.
const native = "android/app/src/main/java/com/nvu/operacional/";
const fixtures = "scripts/fixtures/native-receipt/";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-compact-menu-"));
const sources=[];
const read=p=>fs.readFileSync(p,"utf8");
const write=(name,code)=>{const file=path.join(tmp,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,code);sources.push(file);};
const slice=(source,start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>=0,start);return source.slice(a,b);};
const pro=read(native+"SimpleAutomationService.java");
const max=read(native+"GtoObserverService.java");
for(const [name,code]of Object.entries(JSON.parse(read(fixtures+"android-stubs.json"))))write(name,code);
write("com/nvu/operacional/PendingOperationStartStore.java",read(native+"PendingOperationStartStore.java"));
const methods = [
 slice(pro,"    public static void setRoute(","    public static void requestReceiptCapture("),
 slice(pro,"    private void applyBubbleCardVisibility(","    private void moveMenuAwayFromStatusChip()"),
 slice(pro,"    private void restoreMenuAfterStatusChip()","    private void toggleMenu()"),
 slice(pro,"    private void openMenu()","    private void addBackToHomeButton("),
 slice(pro,"    private void addActionRow(","    private List<String> readCities()"),
 slice(pro,"    private void showStatus(String","    private GradientDrawable makeNvuBubbleBackground("),
 slice(pro,"    public static void showStatusMessage(","    public static void setRoute("),
 slice(pro,"    private Button menuButton(","    private int pendingTripCountForCurrentScope()"),
 slice(pro,"    private TextView label(","    private void hideCaptureInteractiveOverlaysKeepBubble()")
].join("\n");
write("com/nvu/operacional/ProMenuHarness.java",read(fixtures+"ProMenuHarness.java.template")
 .replace("__COMMON__",read(fixtures+"CommonFields.java.fragment")).replace("__METHODS__",methods));
write("com/nvu/operacional/NativeMenuRuntimeTest.java",read(fixtures+"NativeMenuRuntimeTest.java"));
write("ParseNativeSources.java",read(fixtures+"ParseNativeSources.java"));
const classes=["NativeCompactMenuView","NativeCompactMenuScrollView","NativeRouteReadySnapshot",
 "NativeTripReceipt","NativeTripReceiptPreferences","NativeTripReceiptCardView","NativeReceiptCardLayoutPolicy",
 "NativeOverlayCardVisibility","NativeBubbleVisibility","GtoOverlayLayoutPolicy"];
const run=args=>{const r=spawnSync("java",args,{encoding:"utf8",maxBuffer:4e6});
 if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);assert.equal(r.status,0,"Java command failed");};
try{
 run(["-m","jdk.compiler/com.sun.tools.javac.Main","-encoding","UTF-8","-d",path.join(tmp,"classes"),...sources,...classes.map(c=>native+c+".java")]);
 const preview = process.argv.indexOf("--preview-json");
 const args=preview>=0?[path.resolve(process.argv[preview+1])]:[];
 run(["-cp",path.join(tmp,"classes"),"com.nvu.operacional.NativeMenuRuntimeTest",...args]);
 run(["-cp",path.join(tmp,"classes"),"ParseNativeSources",...classes.map(c=>native+c+".java"),
  native+"SimpleAutomationService.java",native+"GtoObserverService.java",
  "android/app/src/androidTest/java/com/nvu/operacional/NativeCompactMenuInstrumentationTest.java"]);
 const menuPro=slice(pro,"    private void openMenu()","    private void refreshMenuContents()");
 const menuMax=slice(max,"    private void openMenu()","    private void refreshMenuContents()");
 const checks=[
  ["Pro/Max share the compact surface",menuPro.includes("new NativeCompactMenuView(this)")&&menuMax.includes("new NativeCompactMenuView(this)")],
  ["No X row in either menu",!menuPro.includes("addCloseControl")&&!menuMax.includes("addCloseControl")],
  ["Outside dismissal is identity guarded",menuPro.includes("() -> menuView == openedMenu")&&menuMax.includes("if (menuView != openedMenu || destroying) return;")],
  ["Outside input passes to the simulator",menuPro.includes("FLAG_NOT_TOUCH_MODAL")&&menuMax.includes("FLAG_NOT_TOUCH_MODAL")],
  ["Max content height drops the deleted row",!slice(max,"    private void adjustOpenMenuLayoutAfterMeasure()","    private boolean shouldMinimizeMenuForConfirmedExternalApp").includes("getMeasuredHeight() + dp(28)")],
  ["Pro reserves only the real footer",menuPro.includes("routeFooterHeight")&&menuPro.includes("NativeCompactMenuScrollView")],
  ["Native picker does not rebuild after confirmation",pro.includes("showRouteReadyMessage();\n                    return;")],
  ["Bridge shares the same exclusive transition",slice(pro,"    public static void setRoute(","    public static void requestReceiptCapture(").includes("instance.showRouteReadyMessage();")]
 ];
 for(const [name,ok]of checks){assert(ok,name);console.log("PASS integration "+name);}
 console.log(`Native compact menu integration: PASS ${checks.length}/${checks.length}`);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
