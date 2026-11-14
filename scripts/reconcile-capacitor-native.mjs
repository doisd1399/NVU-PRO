import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const appGradle = path.join(root, "android", "app", "build.gradle");
const configTs = path.join(root, "capacitor.config.ts");
const embedded = path.join(root, "android", "app", "src", "main", "assets", "capacitor.config.json");
const pkgLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const native = fs.readFileSync(appGradle, "utf8");
const m = native.match(/versionCode\s+(\d+)/);
if (!m) throw new Error("versionCode not found in android/app/build.gradle");
const versionCode = m[1];
const channel = `production-${versionCode}`;

let ts = fs.readFileSync(configTs, "utf8");
ts = ts.replace(/process\.env\.NVU_NATIVE_CHANNEL \|\| "production-\d+"/, `process.env.NVU_NATIVE_CHANNEL || "${channel}"`);
fs.writeFileSync(configTs, ts);

if (fs.existsSync(embedded)) {
  const cfg = JSON.parse(fs.readFileSync(embedded, "utf8"));
  cfg.plugins ??= {};
  cfg.plugins.LiveUpdate ??= {};
  cfg.plugins.LiveUpdate.defaultChannel = channel;
  fs.writeFileSync(embedded, JSON.stringify(cfg, null, 2) + "\n");
}

const versions = {
  cli: pkgLock.packages["node_modules/@capacitor/cli"]?.version,
  core: pkgLock.packages["node_modules/@capacitor/core"]?.version,
  android: pkgLock.packages["node_modules/@capacitor/android"]?.version,
  app: pkgLock.packages["node_modules/@capacitor/app"]?.version,
  push: pkgLock.packages["node_modules/@capacitor/push-notifications"]?.version,
  firebase: pkgLock.packages["node_modules/@capacitor-firebase/authentication"]?.version,
  liveUpdate: pkgLock.packages["node_modules/@capawesome/capacitor-live-update"]?.version,
};

const missing = Object.entries(versions).filter(([,v]) => !v).map(([k]) => k);
if (missing.length) throw new Error(`Missing Capacitor lock entries: ${missing.join(", ")}`);

const webPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const report = [
  "# Capacitor reconciliation snapshot",
  "",
  `- Native versionCode: ${versionCode}`,
  `- Native LiveUpdate channel: ${channel}`,
  `- Web package: ${webPkg.version}`,
  `- Capacitor CLI: ${versions.cli}`,
  `- Capacitor Core: ${versions.core}`,
  `- Capacitor Android: ${versions.android}`,
  `- Capacitor App: ${versions.app}`,
  `- Capacitor Push Notifications: ${versions.push}`,
  `- Firebase Authentication: ${versions.firebase}`,
  `- Capawesome Live Update: ${versions.liveUpdate}`,
  "",
  "Source config and embedded Android config are aligned to the native version channel.",
  "",
  "A real npx cap sync android remains required after installing the locked dependencies; then run the Android build and asset parity gates."
].join("\n") + "\n";
fs.writeFileSync(path.join(root, "CAPACITOR_RECONCILIATION_2026-09-22.md"), report);
console.log(JSON.stringify({versionCode, channel, versions}, null, 2));
