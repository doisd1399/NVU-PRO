import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readGtoReceiptAmountCents } from "../functions/src/gtoReceiptValidation";

// Real store/policies on JVM; Android storage and unrelated coordinator are doubles.
const dir = mkdtempSync(join(tmpdir(), "nvu-pro-rejection-"));
const walk = (path: string): string[] => readdirSync(path, { withFileTypes: true })
  .flatMap(item => item.isDirectory() ? walk(join(path, item.name)) : [join(path, item.name)]);
const sources = walk(resolve("scripts/fixtures/pro-rejection"));
const javaRoot = resolve("android/app/src/main/java/com/nvu/operacional");
for (const name of ["CompletedOperationScope", "ProPendingTripStore", "CanonicalTripOutboxSchema", "PendingTripFailurePolicy", "GtoResultCompletionPolicy", "GtoResultOcrConsensusPolicy", "GtoProReceiptValidationPolicy", "GtoBackendCompatibilityPolicy"]) {
  sources.push(join(javaRoot, name + ".java"));
}
const receipts = [
  "CONCLUÍDO\nVALOR A RECEBER:  2.563,00", "VALOR A RECEBER R$ 29.926,00", "VALOR A RECEBER USD 2,563.42",
  "VALOR A RECEBER € 0,01", "VALOR A RECEBER 1.000", "VALOR A RECEBER 2.563,00\nBONUS VIDEO ADS: 0",
  "VALOR A RECEBER 2.563,00\nBONUS VIDEO ADS: 10,00", "VALOR A RECEBER 2.563,00\nVALOR A RECEBER 2.564,00",
  "VALOR A RECEBER 0,00", "VALOR A RECEBER 2.563,00 VALOR DOBRADO 5.126,00", "VALOR A RECEBER 25,63.00",
  "VALOR   A\nRECEBER: BRL 25,6", "VALOR A RECEBER 10000000,00", "VALOR A RECEBER 10000000,01", "SEM VALOR",
];
try {
  const compiler = process.env.NVU_JAVA_COMPILER_JAR;
  const args = ["-encoding", "UTF-8", "-d", join(dir, "classes"), ...sources];
  const compile = spawnSync(compiler ? "java" : "javac", compiler ? ["-jar", compiler, "-17", ...args] : args, { encoding: "utf8" });
  assert.ok(!compile.error, `Java compiler unavailable: ${compile.error?.message}`);
  assert.equal(compile.status, 0, compile.stderr);
  const run = spawnSync("java", ["-cp", join(dir, "classes"), "com.nvu.operacional.ProRejectionHarness", ...receipts], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const recovery = spawnSync("java", ["-cp", join(dir, "classes"), "com.nvu.operacional.GtoRecoveryMultiOwnerHarness"], { encoding: "utf8" });
  assert.equal(recovery.status, 0, recovery.stderr);
  console.log(recovery.stdout.trim());
  const automatic = spawnSync("java", ["-cp", join(dir, "classes"), "com.nvu.operacional.AutoRecovery505Harness"], { encoding: "utf8" });
  assert.equal(automatic.status, 0, automatic.stderr);
  console.log(automatic.stdout.trim());
  const lines = run.stdout.trim().split("\n");
  assert.deepEqual(JSON.parse(lines.at(-1)!), receipts.map(readGtoReceiptAmountCents), "Android/server amount validation parity");
  console.log(lines[0]);
  console.log(`PASS ${receipts.length} native/server receipt cases; no currency guessing or server writes`);
} finally { rmSync(dir, { recursive: true, force: true }); }
