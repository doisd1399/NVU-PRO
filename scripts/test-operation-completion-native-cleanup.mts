import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// Compile the production scope/store/cleaner. Android/Firebase SDK calls are
// doubles; this suite does not claim to replace an Android device test.
const dir = mkdtempSync(join(tmpdir(), "nvu-operation-cleanup-"));
const walk = (path: string): string[] => readdirSync(path, { withFileTypes: true })
  .flatMap(item => item.isDirectory() ? walk(join(path, item.name)) : [join(path, item.name)]);
const base = resolve("scripts/fixtures/pro-rejection"), overlay = resolve("scripts/fixtures/operation-completion");
const relative = (file: string, root: string) => file.slice(root.length + 1);
const selected = new Map(walk(base).map(file => [relative(file, base), file]));
for (const file of walk(overlay)) selected.set(relative(file, overlay), file);
// AutoRecovery505Harness deliberately exercises a different coordinator double.
const sources = [...selected.values()].filter(file => !file.endsWith("/AutoRecovery505Harness.java") &&
  !file.endsWith("/SimpleProNativeSubmissionCoordinator.java"));
const javaRoot = resolve("android/app/src/main/java/com/nvu/operacional");
for (const name of ["CompletedOperationScope", "CompletedProOperationQueueCleaner", "ProPendingTripStore", "SimpleProNativeSubmissionCoordinator", "PendingOperationStartStore", "ProReceiptEvidencePolicy", "CanonicalTripOutboxSchema", "PendingTripFailurePolicy", "GtoResultCompletionPolicy", "GtoResultOcrConsensusPolicy", "GtoProReceiptValidationPolicy", "GtoBackendCompatibilityPolicy"])
  sources.push(join(javaRoot, name + ".java"));
try {
  const compiler = process.env.NVU_JAVA_COMPILER_JAR;
  const args = ["-encoding", "UTF-8", "-d", join(dir, "classes"), ...sources];
  const compile = spawnSync(compiler ? "java" : "javac", compiler ? ["-jar", compiler, "-17", ...args] : args, { encoding: "utf8" });
  assert.ok(!compile.error, `Java compiler unavailable: ${compile.error?.message}`);
  assert.equal(compile.status, 0, compile.stderr);
  const run = spawnSync("java", ["-cp", join(dir, "classes"), "com.nvu.operacional.OperationCompletionQueueHarness"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  console.log(run.stdout.trim());
} finally { rmSync(dir, { recursive: true, force: true }); }
