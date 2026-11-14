import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const metadata = JSON.parse(read("NVU_RELEASE_METADATA.json"));
const probeService = read("android/app/src/main/java/com/nvu/operacional/ProOverlayProbeService.java");
const probeUi = read("src/components/GtoWorkModeDialog.tsx");
const checks = [
  ["plugin registrado na MainActivity", read("android/app/src/main/java/com/nvu/operacional/MainActivity.java").includes("registerPlugin(ProOverlayProbePlugin.class)")],
  ["Activity não exportada", /ProOverlayProbeActivity[\s\S]*?android:exported="false"/.test(read("android/app/src/main/AndroidManifest.xml"))],
  ["service mediaProjection declarado", /ProOverlayProbeService[\s\S]*?android:foregroundServiceType="mediaProjection"/.test(read("android/app/src/main/AndroidManifest.xml"))],
  ["consentimento oficial solicitado", read("android/app/src/main/java/com/nvu/operacional/ProOverlayProbeActivity.java").includes("createScreenCaptureIntent")],
  ["sem consulta de AppOps", !/AppOpsManager|unsafeCheckOp|setMode/.test(read("android/app/src/main/java/com/nvu/operacional/ProOverlayProbe" + "Activity.java"))],
  ["foreground mediaProjection", read("android/app/src/main/java/com/nvu/operacional/ProOverlayProbeService.java").includes("FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION")],
  ["VirtualDisplay criado", read("android/app/src/main/java/com/nvu/operacional/ProOverlayProbeService.java").includes("createVirtualDisplay")],
  ["quadros descartados imediatamente", read("android/app/src/main/java/com/nvu/operacional/ProOverlayProbeService.java").includes("acquireLatestImage") && read("android/app/src/main/java/com/nvu/operacional/ProOverlayProbeService.java").includes("frame.close()")],
  ["janela experimental temporária", probeService.includes("OVERLAY_OK") && probeService.includes("START_NOT_STICKY") && probeService.includes("Settings.canDrawOverlays")],
  ["limpeza da display/reader/projection", ["display.release", "reader.close", "projection.stop"].every((x) => probeService.includes(x))],
  ["botão e resultado no Web", probeUi.includes("Testar captura autorizada") && probeUi.includes("Ver resultado") && probeUi.includes("probeStatus.stage")],
  ["rota não toca em operações", !/Firebase|Firestore|Trip|Operation|AppOpsManager/.test(probeService + read("android/app/src/main/java/com/nvu/operacional/ProOverlayProbePlugin.java"))],
  ["OTA desligada", metadata.otaEnabled === false && JSON.parse(read("package.json")).selfHostedOtaEnabled === false],
  ["candidato metadata atual", read("android/app/build.gradle").includes(`versionCode ${metadata.androidVersionCode}`) && read("android/app/build.gradle").includes(`versionName \"${metadata.androidVersion}\"`)],
];
let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS ${name}`);
  else { console.error(`FAIL ${name}`); failed += 1; }
}
if (failed) process.exit(1);
console.log(`ETAPA40_OVERLAY_PROBE_PASS ${checks.length}/${checks.length}`);
