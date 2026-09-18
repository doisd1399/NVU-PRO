import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = "android/app/src/main/java";
const sources = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(file);
    else if (entry.isFile() && entry.name.endsWith(".java")) sources.push(file);
  }
}
collect(root);
sources.sort();
if (!sources.length) throw new Error("Nenhum fonte Java Android encontrado.");

const result = spawnSync(
  "java",
  ["scripts/java-tests/JavaSyntaxCheck.java", ...sources],
  { encoding: "utf8" },
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
