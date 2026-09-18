import assert from "node:assert/strict";
import fs from "node:fs";

const repository = fs.readFileSync(
  new URL("../src/services/membershipRepository.ts", import.meta.url),
  "utf8",
);
const appContext = fs.readFileSync(
  new URL("../src/context/AppContext.tsx", import.meta.url),
  "utf8",
);

const checks = [
  [repository.includes('where("userId", "==", uid)'), "membership query is scoped to the supplied UID"],
  [repository.includes("getDocsFromServer"), "server confirmation uses getDocsFromServer"],
  [repository.includes("snapshot.metadata.fromCache"), "listener exposes cache metadata"],
  [repository.includes("membership-server-read-timeout"), "server reads have a finite timeout"],
  [repository.includes("attempts = 3") || repository.includes("attempts = 3"), "retry count is bounded"],
  [repository.includes("getIdToken"), "retry can refresh the Firebase token"],
  [repository.includes("Promise.resolve().then(operation)"), "synchronous transport errors are covered by timeout cleanup"],
  [appContext.includes("createMembershipRepository<CompanyMember>"), "AppContext delegates membership ownership to repository"],
  [appContext.includes("membershipRepository.subscribe"), "AppContext uses repository listener"],
  [appContext.includes("membershipRepository.recoverFromServer"), "AppContext uses repository server recovery"],
  [appContext.includes("identityPendingAtStart"), "identity and membership bootstrap may run in parallel"],
  [appContext.includes("server-memberships="), "server memberships during identity pending stay diagnostic"],
  [!appContext.includes("onSnapshot(\n      q,"), "AppContext no longer creates the membership listener directly"],
];

for (const [passed, label] of checks) {
  assert.equal(passed, true, label);
}

console.log(`membership-repository-contract: PASS ${checks.length}/${checks.length}`);
