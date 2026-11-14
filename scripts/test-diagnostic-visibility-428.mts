import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  findSafeNativeAttemptForLocalRow,
  inspectLocalTripSync,
  resolveAuthenticatedDriverAliases,
} from "../src/lib/localTripSyncDiagnostic.ts";
import { copySafeProAttemptDiagnostic } from "../src/lib/proAttemptDiagnostic.ts";
import { HistoryReadCoverageNotice } from "../src/components/common/HistoryReadCoverageNotice.tsx";

const authUid = "auth-user-uid-84920abcdef123456789";
const businessDriverId = "business-driver-316-2144";
const rawToken = "eyJhbGciOiJIUzI1NiJ9.private-signature-value";
const rawReceipt = "RECEIPT-PRIVATE-99112233 OCR-CONTENT $9876";
const aliases = resolveAuthenticatedDriverAliases(authUid, { id: authUid }, [
  { userId: authUid, status: "active", driverId: businessDriverId },
  { userId: "another-auth-user", status: "active", driverId: "other-driver" },
  { userId: authUid, status: "pending", driverId: "pending-driver" },
]);
assert.deepEqual(aliases, [authUid, businessDriverId], "only the authenticated user's active membership supplies a business driver alias");
assert.deepEqual(resolveAuthenticatedDriverAliases(authUid, { id: "different-auth-user", driverId: businessDriverId }, []), [], "a mismatched profile fails closed");

const deterministicId = (driverId: string, attemptId: string) =>
  (`simple_${driverId}_${attemptId}`).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180);
const attempts = [
  { attemptId: "attempt-1-private-884411", jobId: "job-1-private-884411", code: "permission-denied", stage: "RECEIPT_UPLOAD" },
  { attemptId: "attempt-2-private-774422", jobId: "job-2-private-774422", code: "functions/failed-precondition", stage: "CALLABLE_REGISTRATION" },
  { attemptId: "attempt-3-private-663355", jobId: "job-3-private-663355", code: "functions/failed-precondition", stage: "CALLABLE_REGISTRATION" },
];
const localIds = attempts.map(({ attemptId }) => deterministicId(businessDriverId, attemptId));
const records = attempts.map(({ jobId, attemptId }, index) => ({
  trip: {
    physicalDocumentId: localIds[index], driverId: businessDriverId,
    jobId, operationId: `operation-${index + 1}-private-7722`, attemptId,
  },
  syncStatus: "CONFLICT",
})) as any[];
const webQueue = Object.fromEntries(attempts.map(({ jobId, attemptId }, index) => [localIds[index], {
  operation: "UPSERT", state: "FAILED",
  trip: { physicalDocumentId: localIds[index], driverId: businessDriverId, jobId },
}]));
const nativeAttempts = attempts.map((attempt, index) => ({
  attemptId: attempt.attemptId,
  jobId: attempt.jobId,
  driverId: businessDriverId,
  queueStatus: "FAILED",
  lastQueueErrorCode: attempt.code,
  lastQueueError: `${attempt.code}: ${attempt.code === "permission-denied" ? "AUTORIZAÇÃO_REJEITADA" : "CONDIÇÃO_DO_SERVIDOR_REJEITADA"}: rejeição do servidor. Bearer ${rawToken} token=private-token-456 Authorization: Bearer private-auth-header uid=${authUid} https://proof.example/signed?token=secret receiptText=${rawReceipt}`,
  attemptCount: index + 1,
  operationId: `operation-${index + 1}-private-7722`,
  stage: attempt.stage,
  // No callable/canonicalTripId is persisted in these fixtures; neither may be fabricated.
  queuedAt: Date.parse("2026-10-06T12:30:00.000Z"),
  lastAttemptAt: Date.parse(`2026-10-06T12:4${index + 1}:00.000Z`),
})) as any[];
let queueReads = 0;
const general = inspectLocalTripSync(records, new Set(), authUid, {
  getItem: (key: string) => {
    queueReads += 1;
    assert.equal(key, "nvu_sync_queue_v2");
    return JSON.stringify(webQueue);
  },
}, aliases);
assert.equal(queueReads, 1, "the general read-only diagnostic reads the existing web outbox exactly once");
assert.equal(general.inspectedRows, 3);
assert.equal(general.rows.length, 3, "the general diagnostic returns exactly the three blocked records");
assert.ok(general.rows.every((row) => row.identityLink === "verified"), "business driver IDs are linked only through the explicit UID membership relation");
assert.deepEqual(nativeAttempts.map((entry) => findSafeNativeAttemptForLocalRow(
  general.rows[nativeAttempts.indexOf(entry)], nativeAttempts, authUid, true, aliases,
)?.rawCode), ["permission-denied", "functions/failed-precondition", "functions/failed-precondition"], "the same three general rows receive their corresponding native queue codes");

const safeDetails = general.rows.map((row) => findSafeNativeAttemptForLocalRow(row, nativeAttempts, authUid, true, aliases));
assert.equal(safeDetails.filter(Boolean).length, 3, "the detailed projection returns the same three records");
for (const safe of safeDetails) {
  assert.ok(safe);
  assert.equal(safe!.queueStatus, "FAILED");
  assert.match(safe!.attemptId, /…/);
  assert.match(safe!.jobId, /…/);
  assert.match(safe!.operationId, /…/);
  assert.equal(safe!.canonicalTripId, "não registrado", "canonicalTripId is not fabricated when it is absent from SharedPreferences");
  assert.match(safe!.timestamp, /^2026-10-06T12:4[1-3]:00\.000Z$/);
  assert.equal(safe!.callable, "não registrado", "no callable is invented when the native queue did not persist it");
  assert.match(safe!.stage, /^(RECEIPT_UPLOAD|CALLABLE_REGISTRATION)$/);
  assert.match(safe!.reasonCode, /^(AUTORIZAÇÃO_REJEITADA|CONDIÇÃO_DO_SERVIDOR_REJEITADA)$/);
  assert.match(safe!.serverMessage, /rejeição do servidor/);
  for (const secret of [rawToken, rawReceipt, authUid, "private-token-456", "private-auth-header", "https://proof.example", "receiptText="]) {
    assert.ok(!safe!.text.includes(secret), `safe output excludes credential/UID/receipt: ${secret}`);
  }
  assert.match(safe!.serverMessage, /conteúdo de recibo\/comprovante removido/);
}

const unlinked = inspectLocalTripSync(records, new Set(), authUid, { getItem: () => JSON.stringify(webQueue) }, [authUid]);
assert.equal(unlinked.rows.length, 3);
assert.ok(unlinked.rows.every((row) => row.identityLink === "divergent"));
assert.ok(unlinked.rows.every((row) => findSafeNativeAttemptForLocalRow(row, nativeAttempts, authUid, true, [authUid]) === null), "without the explicit UID-to-driver relation, native messages remain hidden");

const coverageFor = (localSyncDiagnostic: any, pendingLocalRows: number) => ({
  generation: 1, status: "complete", scope: { companyIds: ["company-1"], authenticatedUserId: authUid },
  expectedSources: 2, respondedSources: 2, confirmedSources: 2, failedSources: 0,
  physicalRows: 12, projectedRows: 12, unverifiedProjectionRows: 0, pendingLocalRows,
  projectionMode: "scoped-history", commandStorageAvailable: true,
  rejectedRows: 0, fromCache: false, hasPendingWrites: false, atomic: false, sources: [],
  localSyncDiagnostic,
});
let externalActionCalls = 0;
const rendered = renderToStaticMarkup(React.createElement(HistoryReadCoverageNotice, {
  coverage: "complete", readCoverage: coverageFor(general, 3) as any,
  nativeQueueDiagnostics: nativeAttempts,
  nativeOwnerAuthenticated: true,
  authenticatedUserId: authUid,
  authorizedDriverIds: aliases,
  showDiagnostics: true,
}));
assert.equal((rendered.match(/Copiar diagnóstico seguro/g) || []).length, 3, "each green-panel row has one explicit copy button");
assert.equal((rendered.match(/Mensagem sanitizada:/g) || []).length, 3, "the real sanitized native server messages render inline in the existing green panel");
assert.ok(!rendered.includes(rawToken) && !rendered.includes(rawReceipt) && !rendered.includes(authUid));
assert.equal(externalActionCalls, 0, "rendering/expanding performs no external action");
const mismatchRendered = renderToStaticMarkup(React.createElement(HistoryReadCoverageNotice, {
  coverage: "complete", readCoverage: coverageFor(unlinked, 3) as any,
  nativeQueueDiagnostics: nativeAttempts, nativeOwnerAuthenticated: true,
  authenticatedUserId: authUid, authorizedDriverIds: [authUid],
  showDiagnostics: true,
}));
assert.equal((mismatchRendered.match(/authUid ↔ driverId: divergente/g) || []).length, 3);
assert.ok(!mismatchRendered.includes("rejeição do servidor") && !mismatchRendered.includes(businessDriverId) && !mismatchRendered.includes(authUid));

let copied = "";
let copyCalls = 0;
await copySafeProAttemptDiagnostic(safeDetails[0]!, async (text) => { copyCalls += 1; copied = text; });
assert.equal(copyCalls, 1);
assert.equal(copied, safeDetails[0]!.text, "copy contains only the already sanitized DTO");
assert.ok(!copied.includes(rawToken) && !copied.includes(rawReceipt) && !copied.includes(authUid));

const root = new URL("../", import.meta.url);
const plugin = await readFile(new URL("android/app/src/main/java/com/nvu/operacional/SimpleAutomationPlugin.java", root), "utf8");
const methodStart = plugin.indexOf("public void getReadOnlyProQueueDiagnostics(PluginCall call)");
const methodEnd = plugin.indexOf("@PluginMethod", methodStart + 20);
const nativeGetter = plugin.slice(methodStart, methodEnd);
assert.ok(nativeGetter.includes("authenticatedUid.equals(requestedAuthenticatedUid)"), "native Auth UID authenticates the caller");
assert.ok(nativeGetter.includes("ownerIds.add(authenticatedUid)") && nativeGetter.includes("authorizedDriverIds"), "native owner scope accepts only the authenticated UID plus explicitly authorized driver aliases");
assert.ok(nativeGetter.includes("ownerIds.contains(ownerId)"), "native queue rows are filtered by the same explicit owner aliases");
for (const forbidden of ["buildStatus(", "validatedReceipt(", ".edit(", ".apply(", ".commit(", "retryPending(", "getHttpsCallable(", "FirebaseFirestore"]) {
  assert.ok(!nativeGetter.includes(forbidden), `native diagnostic getter is strictly read-only: no ${forbidden}`);
}
const coordinator = await readFile(new URL("android/app/src/main/java/com/nvu/operacional/SimpleProNativeSubmissionCoordinator.java", root), "utf8");
assert.ok(coordinator.includes('("simple_" + driverId + "_" + attemptId).replaceAll("[^A-Za-z0-9_-]", "_")'), "private join key matches the existing deterministic native trip-ID contract");
const page = await readFile(new URL("src/pages/driver/TripHistory.tsx", root), "utf8");
assert.ok(page.includes("authenticatedUserId: currentUser.id") && page.includes("authorizedDriverIds: diagnosticOwnerDriverIds"));
assert.ok(page.includes("nativeQueueDiagnostics={nativeQueueDiagnostics}"));
assert.ok(!page.includes("authenticatedUserId: currentUser.id,\n          authorizedDriverIds: diagnosticOwnerDriverIds,\n          companyId:") && !page.includes("jobId: embeddedJob?.id || undefined"), "the green diagnostic fetch is independent of the active company/job visual filter");
const notice = await readFile(new URL("../src/components/common/HistoryReadCoverageNotice.tsx", import.meta.url), "utf8");
assert.ok(notice.includes("copySafeDiagnosticToClipboard(safeDiagnostic)"), "the only UI action copies the safe DTO");
for (const forbidden of ["SyncManager", "retryRegistration", "getHttpsCallable", "setItem(", "removeItem(", ".commit(", ".apply(", "deleteTrip("]) {
  assert.ok(!notice.includes(forbidden), `opening/rendering/copy UI has no ${forbidden} dependency`);
}

console.log("diagnostic-visibility-428: PASS");
console.log("3/3 blocked rows map by exact deterministic trip/attempt identifiers; owner alias is explicit, native and UI paths are read-only, and secrets are redacted.");
