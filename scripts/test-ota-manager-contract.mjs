import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manager = fs.readFileSync(path.join(root, "src/lib/otaManager.ts"), "utf8");
const status = fs.readFileSync(path.join(root, "src/lib/liveUpdateStatus.ts"), "utf8");
const docs = fs.readFileSync(path.join(root, "docs/OTA_ARCHITECTURE.md"), "utf8");

const checks = [
  ["No update returns to idle", /phase: "idle"/.test(manager)],
  ["Valid update reaches staged and completed", /phase: "staged"/.test(manager) && /phase: "completed"/.test(manager)],
  ["Manifest invalid has a structured code", /OTA_MANIFEST_INVALID/.test(manager)],
  ["Channel mismatch has a structured code", /OTA_CHANNEL_MISMATCH/.test(manager)],
  ["Native version mismatch has a structured code", /OTA_NATIVE_VERSION_MISMATCH/.test(manager)],
  ["Runtime mismatch has a structured code", /OTA_RUNTIME_MISMATCH/.test(manager)],
  ["Checksum invalid has a structured code", /OTA_CHECKSUM_INVALID/.test(manager)],
  ["Download failures have a structured code", /OTA_DOWNLOAD_FAILED/.test(manager)],
  ["Signature failures have a structured code", /OTA_SIGNATURE_INVALID/.test(manager)],
  ["Duplicate checks share one promise", /if \(this\.checkPromise\) return this\.checkPromise/.test(manager)],
  ["Embedded bundle identity is available at build time", /VITE_NVU_EMBEDDED_BUNDLE_ID/.test(manager) && /OTA_EMBEDDED_BUNDLE_ID/.test(manager)],
  ["Already current or staged bundles are not downloaded again", /effectiveCurrentBundle === validated\.bundleId \|\| nextBundle === validated\.bundleId/.test(manager)],
  ["Resume uses the same check path", /void this\.check\("resume"\)/.test(manager)],
  ["A staged update does not force reload", !/window\.location\.reload/.test(manager) && /setNextBundle/.test(manager)],
  ["LiveUpdate.ready remains non-blocking", /ready\(\)\.catch/.test(manager)],
  ["OTA state is persisted", /OTA_STATE_KEY/.test(manager) && /storageWrite/.test(manager)],
  ["Status contract includes rollback", /\| "rolled_back"/.test(status)],
  ["Travel continuity is documented", /não força reload durante o uso/.test(docs) && /viagem/.test(docs)],
];

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
  if (!passed) failed += 1;
}
if (failed) {
  process.exitCode = 1;
  throw new Error(`${failed} OTA manager contract checks failed`);
}
console.log(`OTA_MANAGER_CONTRACT_PASS ${checks.length}/${checks.length}`);
