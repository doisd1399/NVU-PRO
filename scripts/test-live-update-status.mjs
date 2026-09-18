import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const manager = read("src/lib/otaManager.ts");
const facade = read("src/lib/liveUpdate.ts");
const statusContract = read("src/lib/liveUpdateStatus.ts");
const component = read("src/components/common/LiveUpdateStatus.tsx");
const app = read("src/App.tsx");
const main = read("src/main.tsx");
const recovery = read("src/lib/deployRecovery.ts");

const checks = [
  ["OTAManager is the single OTA authority", /export class OtaManager/.test(manager) && /export const otaManager/.test(manager)],
  ["Facade delegates to OTAManager", /checkOta/.test(facade) && /startOtaManager/.test(facade) && !/downloadBundle/.test(facade)],
  ["Status contract exposes explicit phases", /\| "checking"/.test(statusContract) && /\| "downloading"/.test(statusContract) && /\| "verifying"/.test(statusContract) && /\| "staged"/.test(statusContract)],
  ["Checking is serialized by a single promise", /private checkPromise: Promise<void> \| null/.test(manager) && /if \(this\.checkPromise\) return this\.checkPromise/.test(manager)],
  ["Startup and resume use the same manager", /void this\.check\("startup"\)/.test(manager) && /void this\.check\("resume"\)/.test(manager)],
  ["Periodic checks keep the 15 minute interval", /15 \* 60 \* 1000/.test(manager) && /this\.check\("interval"\)/.test(manager)],
  ["Manifest and compatibility validation precede download", /validateManifest[\s\S]{0,1600}downloadBundle/.test(manager)],
  ["Checksum and signature are forwarded to the native plugin", /checksum: validated\.checksum/.test(manager) && /signature: validated\.signature/.test(manager)],
  ["Verification precedes staging", /phase: "verifying"[\s\S]{0,500}setNextBundle/.test(manager) && /phase: "staged"/.test(manager)],
  ["Errors have structured codes and persistence", /OTA_DOWNLOAD_FAILED/.test(manager) && /storageWrite/.test(manager) && /errorCode/.test(manager)],
  ["Checking is silent", !/return "Verificando atualizações…"/.test(component) && /detail\?\.phase === "checking"/.test(component)],
  ["Downloading copy is visible", /Atualizando o aplicativo…/.test(component)],
  ["Recoverable failure copy is visible", /Não foi possível concluir a atualização\. Continuando normalmente…/.test(component)],
  ["Completed copy matches the requested message", /Atualização concluída ✓/.test(component)],
  ["Status includes only update-running phases", !/VISIBLE_PHASES[\s\S]{0,160}"checking"/.test(component) && /"downloading"/.test(component) && /"verifying"/.test(component) && /"staged"/.test(component)],
  ["Updating status uses a compact non-blocking spinner", /Loader2/.test(component) && /animate-spin/.test(component) && /pointer-events-none/.test(component)],
  ["Completed status uses a success icon and auto-hides", /Check/.test(component) && /COMPLETED_VISIBLE_MS/.test(component)],
  ["Status survives events before React mount", /latestLiveUpdateStatus/.test(statusContract) && /getLatestLiveUpdateStatus/.test(component)],
  ["Status listener closes the paint/effect race", /useLayoutEffect/.test(component) && /applyStatus\(getLatestLiveUpdateStatus\(\)\)/.test(component)],
  ["Bootstrap mounts before starting OTA", /createRoot\(rootElement\)\.render/.test(main) && /requestAnimationFrame[\s\S]{0,120}startOtaManager/.test(main)],
  ["Recovery does not start a competing OTA", !/checkSelfHostedLiveUpdate/.test(recovery)],
  ["App does not start a competing OTA", !/checkSelfHostedLiveUpdate/.test(app)],
  ["UI does not start a competing OTA", !/checkSelfHostedLiveUpdate/.test(component)],
];

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
  if (!passed) failed += 1;
}

if (failed > 0) {
  process.exitCode = 1;
  throw new Error(`${failed} live update architecture checks failed`);
}

console.log(`LIVE_UPDATE_ARCHITECTURE_PASS ${checks.length}/${checks.length}`);
