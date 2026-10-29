import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceRoots = ["src", "functions/src", "android/app/src/main/java"];
const slotWriterAllowlist = new Set([
  "src/services/sync/FirebaseTripSyncAdapter.ts",
]);
const violations = [];
const decisionPattern = /\b(?:job|currentJob|jobState|operation)\??\.progress\s*(?:>=|>|<=|<|===|!==|==|!=)/;
const slotFromCounterPattern = /\b(?:operationSlot|slot)\s*=\s*[^;\n]*(?:\bjob\??\.progress\b|\bprogress\b)\s*\+\s*1/;

function isComment(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
}

function walk(relativeDir) {
  const absoluteDir = path.join(root, relativeDir);
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relative = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      walk(relative);
      continue;
    }
    if (!/\.(ts|tsx|java|kt)$/.test(entry.name)) continue;
    const lines = fs.readFileSync(path.join(root, relative), "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (isComment(line)) return;
      if (decisionPattern.test(line)) {
        violations.push(`${relative}:${index + 1}: counter used as an operational decision: ${line.trim()}`);
      }
      if (slotFromCounterPattern.test(line) && !slotWriterAllowlist.has(relative) && !relative.startsWith("functions/src/")) {
        violations.push(`${relative}:${index + 1}: client slot derived from a counter: ${line.trim()}`);
      }
    });
  }
}

for (const sourceRoot of sourceRoots) walk(sourceRoot);
assert.deepEqual(violations, [], `CANONICAL OPERATION BOUNDARY FAILED:\n${violations.join("\n")}`);
console.log("CANONICAL_OPERATION_BOUNDARY_PASS job counter is diagnostic outside canonical writers");
