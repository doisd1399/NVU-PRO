import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const app = initializeApp({ projectId: "demo-r8-migration" });
const db = getFirestore(app);
await db.collection("users").doc("legacy-owner").set({
  vehiclePhotosV2: {
    "gto:scania": { userId: "legacy-owner", simulatorId: "gto", vehicleId: "scania", vehicleName: "SCANIA R 540", url: "https://storage.test/scania.webp" },
    ambiguous: { userId: "legacy-owner", vehicleId: "missing-simulator", url: "https://storage.test/ambiguous.webp" },
  },
  privateField: "must-not-copy",
});
const run = (...args) => new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, [resolve(root, "scripts/migrate-ranking-vehicle-photos.mjs"), ...args], { cwd: root, env: process.env });
  let output = ""; child.stdout.on("data", (data) => { output += data; }); child.stderr.on("data", (data) => { output += data; });
  child.on("exit", (code) => code === 0 ? resolveRun(output) : reject(new Error(output)));
});
const dryRunReport = "/tmp/r8-photo-migration-dry-run.json";
await run("--limit=10", `--report=${dryRunReport}`);
const dryRun = JSON.parse(await (await import("node:fs/promises")).readFile(dryRunReport, "utf8"));
assert.equal(dryRun.dryRun, true);
assert.equal(dryRun.migrated, 0);
assert.equal(dryRun.eligible, 1);
assert.equal(dryRun.rejected, 1);
assert.equal((await db.collection("rankingVehiclePhotos").get()).size, 0);
const executeReport = "/tmp/r8-photo-migration-execute.json";
await run("--execute", "--ack-metadata-only", "--limit=10", `--report=${executeReport}`);
const migrated = await db.collection("rankingVehiclePhotos").doc("legacy-owner:gto:scania").get();
assert.equal(migrated.data()?.url, "https://storage.test/scania.webp");
assert.equal(migrated.data()?.privateField, undefined);
const executeAgainReport = "/tmp/r8-photo-migration-execute-again.json";
await run("--execute", "--ack-metadata-only", "--limit=10", `--report=${executeAgainReport}`);
const again = JSON.parse(await (await import("node:fs/promises")).readFile(executeAgainReport, "utf8"));
assert.equal(again.alreadyPresent, 1);
assert.equal((await db.collection("rankingVehiclePhotos").get()).size, 1);
assert.equal((await db.collection("users").doc("legacy-owner").get()).data().privateField, "must-not-copy");
console.log("PASS dry-run sem escrita e rejeição de identidade ambígua");
console.log("PASS migração mínima preserva identidade e não copia dados privados");
console.log("PASS execução repetida é idempotente e não sobrescreve o destino");
console.log("R8_PHOTO_MIGRATION_PASS 3 checks");
