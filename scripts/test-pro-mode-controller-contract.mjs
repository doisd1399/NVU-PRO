import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const check = (name, condition, detail = "") => checks.push({ name, ok: Boolean(condition), detail });

const controller = read("android/app/src/main/java/com/nvu/operacional/ProModeController.java");
const permissionManager = read("android/app/src/main/java/com/nvu/operacional/NvuPermissionManager.java");
const mainActivity = read("android/app/src/main/java/com/nvu/operacional/MainActivity.java");
const simplePlugin = read("android/app/src/main/java/com/nvu/operacional/SimpleAutomationPlugin.java");
const gtoPlugin = read("android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java");
const simpleService = read("android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java");
const gtoService = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const manifest = read("android/app/src/main/AndroidManifest.xml");
const simpleLauncher = read("src/services/simpleAutomationLauncher.ts");
const gtoLauncher = read("src/services/gtoWorkLauncher.ts");
const gtoSetup = read("src/components/GtoObserverSetup.tsx");

check("ProModeController exists", controller.includes("public final class ProModeController"));
check("entry validation is explicit", controller.includes("validateOverlayAtEntry") && controller.includes('"ENTRY"'));
check("settings return refresh is lifecycle-bound", controller.includes("onActivityResume") && controller.includes('"SETTINGS_RETURN"') && mainActivity.includes("ProModeController.onActivityResume(this)"));
check("single native Settings.canDrawOverlays owner", controller.match(/NvuPermissionManager\.hasOverlay\(/g)?.length === 1 && permissionManager.includes("Settings.canDrawOverlays"));
const directCallsOutsideOwner = [simplePlugin, gtoPlugin, simpleService, gtoService].some((source) => source.includes("NvuPermissionManager.hasOverlay"));
check("services do not query Android overlay directly", !directCallsOutsideOwner);
check("simple start delegates to controller", simplePlugin.includes("ProModeController.start(") && simpleService.includes("does not re-query"));
check("GTO start delegates after controller validation", gtoPlugin.includes("validateOverlayAtEntry") && gtoPlugin.includes("startAfterValidation") && gtoService.includes("public static boolean startIfAllowed"));
check("fast/background timing markers remain wired", simpleLauncher.includes("pro_entry_clicked") && simpleLauncher.includes("pro_service_dispatched") && simpleLauncher.includes("pro_simulator_opened"));
check("simple launcher does not preflight overlay twice", !simpleLauncher.includes('context.status === "overlay-permission"'));
check("GTO launcher lets startObserver own overlay entry", !gtoLauncher.includes("if (!status.overlayPermission)") && gtoLauncher.includes("startObserver"));
check("GTO setup handles controller permission result", !gtoSetup.includes("if (!current.overlayPermission)") && gtoSetup.includes('result.missingPermission === "overlay"'));
check("SimpleAutomation requires mediaProjection", manifest.includes('android:name=".SimpleAutomationService"') && manifest.includes('android:foregroundServiceType="specialUse|mediaProjection"'));
check("GTO observer requires mediaProjection", manifest.includes('android:name=".GtoObserverService"') && manifest.includes('android:foregroundServiceType="specialUse|mediaProjection"'));
check("special-use and projection permissions remain declared", manifest.includes("FOREGROUND_SERVICE_SPECIAL_USE") && manifest.includes("FOREGROUND_SERVICE_MEDIA_PROJECTION"));

const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
if (failures.length) {
  console.error(`\n${failures.length}/${checks.length} ProModeController contract checks failed.`);
  process.exit(1);
}
console.log(`\n${checks.length}/${checks.length} ProModeController contract checks passed.`);
