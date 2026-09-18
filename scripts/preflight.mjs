#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const full = process.argv.includes("--full");
const required = [
  "package.json",
  "package-lock.json",
  "capacitor.config.ts",
  "capacitor.remote.json",
  "android/app/build.gradle",
  "android/settings.gradle",
  "android/app/src/main/AndroidManifest.xml",
  "functions/package.json",
  "functions/src/index.ts",
  "scripts/verify-capacitor-remote.mjs",
  "scripts/verify-capacitor-assets.mjs",
  "NVU_RELEASE_METADATA.json",
];
const missing = required.filter(relative => !fs.existsSync(path.join(root, relative)));
if (missing.length) {
  console.error("Preflight failed. Missing required files:");
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (!packageJson.scripts?.["verify:release"]) {
  console.error("Preflight failed: verify:release is not defined.");
  process.exit(1);
}
const metadata = JSON.parse(fs.readFileSync(path.join(root, "NVU_RELEASE_METADATA.json"), "utf8"));
if (metadata.androidVersionCode == null || !metadata.androidVersion) {
  console.error("Preflight failed: release metadata has no Android identity.");
  process.exit(1);
}
if (full) {
  const forbidden = ["node_modules", "android/.gradle", "android/app/build", "dist"];
  for (const relative of forbidden) {
    if (!fs.existsSync(path.join(root, relative))) continue;
    console.log(`Preflight note: generated directory present: ${relative}`);
  }
}
console.log(`Preflight passed: Android ${metadata.androidVersion} (${metadata.androidVersionCode})`);
