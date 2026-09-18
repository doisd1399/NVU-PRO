import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf208-touch-policy-"));
const sources = [
  "android/app/src/main/java/com/nvu/operacional/GtoTouchCoordinatePolicy.java",
  "scripts/java-tests/com/nvu/operacional/GtoTouchCoordinatePolicyTest.java",
].map(relative => path.join(root, relative));
try {
  const compile = spawnSync("javac", ["-encoding", "UTF-8", "-d", temp, ...sources], { encoding: "utf8" });
  if (compile.stdout) process.stdout.write(compile.stdout);
  if (compile.stderr) process.stderr.write(compile.stderr);
  if (compile.status !== 0) process.exit(1);
  const run = spawnSync("java", ["-cp", temp, "com.nvu.operacional.GtoTouchCoordinatePolicyTest"], { encoding: "utf8" });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.status !== 0) process.exit(run.status ?? 1);
  console.log("HF208 touch-coordinate policy: PASS");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
