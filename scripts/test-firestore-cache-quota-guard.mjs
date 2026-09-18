import assert from "node:assert/strict";
import fs from "node:fs";

const firebase = fs.readFileSync("src/lib/firebase.ts", "utf8");
const boundary = fs.readFileSync("src/components/common/AppErrorBoundary.tsx", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

assert.match(firebase, /memoryLocalCache\(\)/, "Firestore deve usar cache em memória");
assert.doesNotMatch(firebase, /persistentLocalCache|persistentMultipleTabManager/, "runtime não pode persistir targets no IndexedDB por padrão");
assert.match(firebase, /QuotaExceededError/, "a causa de quota deve permanecer documentada no contrato");
assert.match(boundary, /não relacionada à sessão/, "boundary deve tratar falha de renderização separadamente");
assert.equal(packageJson.scripts["test:firestore-cache-quota-guard"], "node scripts/test-firestore-cache-quota-guard.mjs");

console.log("firestore-cache-quota-guard: PASS");
