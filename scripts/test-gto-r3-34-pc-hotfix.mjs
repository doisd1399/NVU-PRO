import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const gradle = read("android/app/build.gradle");
const money = read("android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java");
const resolver = read("android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const plugin = read("android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java");
const dashboard = read("src/pages/driver/Dashboard.tsx");
const history = read("src/pages/driver/TripHistory.tsx");
const dialog = read("src/components/GtoWorkModeDialog.tsx");
const launcher = read("src/services/gtoWorkLauncher.ts");
const functionsTs = read("functions/src/gtoTrips.ts");
const functionsJs = read("functions/lib/gtoTrips.js");

check("hotfix remains based on R3.34 Android identity", Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0) >= 62 && Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/) || [])[1] || 0) >= 62);
check("Windows Gradle Java compile is pinned to UTF-8", gradle.includes("options.encoding = 'UTF-8'"));
check("native money display is grouped pt-BR with cents", money.includes('"R$ %s,%02d"') && money.includes("groupThousands(whole)"));
check("approved destination spellings have conservative first priority", ["Itapetuna", "Nova Macaé", "Registro", "Águas Velhas", "Faz Areia Dourada", "Cruz do Oeste", "Cooperativa Agro Grão", "Curitiba", "Lages", "Lauro Muller"].every((name) => resolver.includes(`"${name}"`)) && resolver.includes("PREFERRED_DESTINATION_NEAR_MATCH") && resolver.includes("tie"));
check("selected-row OCR never silently rewrites destination spelling", !service.includes("finalDestination = resolveTrustedDestination(canonical.destination)") && !service.includes("option.destination = destinationResolution.value") && service.includes("destination OCR stays literal"));
check("unresolved destination conflict retries selected row before field review without reselection", service.includes("hasUnresolvedDestinationOneEditConflict") && service.includes("scheduleFocusedFreightConflictRetry") && service.includes("A releitura focalizada não confirmou um campo com segurança") && service.includes("GtoFreightReviewPolicy.DESTINATION"));
check("web seeds approved spellings and excludes OCR history", dashboard.includes("GTO_PREFERRED_DESTINATIONS") && dashboard.includes("trustedGtoCitiesJson") && dashboard.includes("contract?.deliveries?.forEach") && !/currentOperationTrips\.forEach[\s\S]{0,300}trustedGtoCities/.test(dashboard));
check("native bridge stores expected/trusted city context", (plugin.includes('putString("trustedGtoCitiesJson"') || plugin.includes('putStringIfPresent(editor, call, "trustedGtoCitiesJson"')) && (plugin.includes('putString("expectedGtoDestination"') || plugin.includes('putStringIfPresent(editor, call, "expectedGtoDestination"')));
check("previous-destination origin continuity is removed", !functionsTs.includes("deriveSimpleRouteContinuity") && !functionsTs.includes("PREVIOUS_CONFIRMED_DESTINATION") && functionsTs.includes("FieldValue.delete()"));
check("certified route is the canonical Origem end to end", functionsTs.includes("const effectiveOrigin = origin;") && functionsTs.includes('const effectiveOriginSource = freightAuthorityId ? "GTO_CERTIFIED_ORIGIN"') && !functionsTs.includes("if (origin !== originCompany)"));
check("history labels the value as Origem", !history.includes('"Empresa de origem"') && history.includes("trip.origem || trip.gtoOriginCompany") && history.includes("selectedTrip.origem || selectedTrip.gtoOriginCompany"));
check("automatic mode explicitly rearms the floating button", dialog.includes("Ativar botão flutuante") && launcher.includes("GtoObserver.prepareFloatingButton()") && plugin.includes("prepareFloatingButton") && service.includes("prepareFloatingButtonForNextGtoLaunch") && service.includes("floatingButtonActivationArmed"));
check("openGto does not destroy the freshly rearmed bubble twice", plugin.includes("ensureFloatingButtonPreparedForNextGtoLaunch") && service.includes("ensureFloatingButtonPreparedOnMainThread"));
check("GTO foreground attaches bubble before recorder permission", service.indexOf("showBubbleIfAllowed();") < service.indexOf("maybeLaunchInitialProjectionPermissionOverGto(now)") && service.includes("estabilizando botão flutuante antes da leitura"));
{
  const start = service.indexOf("private void launchProjectionPermissionActivityOnlyWhenGtoLandscape");
  const end = service.indexOf("private void scheduleBubbleRestoreAfterPermission", start);
  const body = service.slice(start, end);
  check("projection consent stays over confirmed landscape GTO", body.includes("new Intent(this, GtoProjectionPermissionActivity.class)") && !body.includes("new Intent(this, MainActivity.class)"));
}
check("freight money ingestion preserves locale semantics", service.includes("private String extractMoneyValue") && service.includes('return GtoMoneyValue.canonical("R$ " + matcher.group(1));') && !service.includes('option.offeredValue = "R$ " + moneyDigits'));
check("transient OEM/system overlays keep the main bubble", service.includes("suspendInteractiveOverlaysKeepBubble") && service.includes("TRANSIENT_OVERLAY_STALE_RECOVERY_MS") && service.includes("Interface temporária sobre o GTO"));
check("capture resize self-recovers without invalidating a still-valid projection token", service.includes("RECOVERING_RESIZE") && service.includes("retryDelay") && service.includes("Only MediaProjection.Callback.onStop() is allowed"));
check("projection grant is validated before token use", service.includes("GRANT_DATA_INVALID") && service.includes("projectionGrantReceivedAt") && service.includes("android.app.Activity.RESULT_OK"));
check("early projection stop is explicit and diagnosable", service.includes("STOPPED_EARLY") && service.includes("projectionActiveForMs") && service.includes("outra gravação/compartilhamento de tela"));

const jsCheck = spawnSync(process.execPath, ["--check", "functions/lib/gtoTrips.js"], { cwd: root, encoding: "utf8" });
check("compiled Firebase function JavaScript is syntactically valid", jsCheck.status === 0, `${jsCheck.stderr || jsCheck.stdout || ""}`.trim());
check("compiled Firebase function mirrors certified route Origin", functionsJs.includes("effectiveOrigin = origin;") && functionsJs.includes("GTO_CERTIFIED_ORIGIN") && !functionsJs.includes("PREVIOUS_CONFIRMED_DESTINATION"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-r334-pc-hotfix-"));
try {
  const cityRun = spawnSync("java", [
    "scripts/java-tests/JavaTestRunner.java",
    tmp,
    "com.nvu.operacional.GtoCityTextResolverTest",
    "android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java",
    "scripts/java-tests/com/nvu/operacional/GtoCityTextResolverTest.java",
  ], { cwd: root, encoding: "utf8" });
  const cityOut = `${cityRun.stderr || ""}\n${cityRun.stdout || ""}`.trim();
  check("city resolver fixtures compile", !cityOut.includes("compilation failed") && !cityOut.includes("Java compilation failed"), cityOut);
  check("city resolver scenarios pass", cityRun.status === 0 && String(cityRun.stdout || "").includes("PASS"), cityOut);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} R3.34 PC hotfix checks passed.`);
if (failed.length) process.exit(1);
