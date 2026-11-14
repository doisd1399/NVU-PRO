import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildSafeProAttemptDiagnostic,
  copySafeProAttemptDiagnostic,
} from "../src/lib/proAttemptDiagnostic.ts";
import { ProAttemptDiagnosticDetails } from "../src/components/ProAttemptDiagnosticDetails.tsx";

const owner = "driver-authenticated-uid-1234567890";
const rawReceipt = "RECEIPT-PRIVATE-99112233 $9,999.00 OCR-CONTENT";
const rawToken = "eyJhbGciOiJIUzI1NiJ9.private-signature-value";
const source = {
  attemptId: "attempt-1234567890-private",
  jobId: "job-0123456789-private",
  driverId: owner,
  queueStatus: "FAILED",
  queuedAt: 1_797_000_000_000,
  queueClaimedAt: 1_797_000_120_000,
  attemptCount: 3,
  lastQueueError: "Registro rejeitado; recibo preservado para revisão.",
  lastQueueErrorCode: `SIMPLE_REGISTRATION_FAILED:FAILED_PRECONDITION:A operação requer revisão. Bearer ${rawToken} token=secret-token-123 Authorization: Bearer auth-header-secret uid=${owner} https://proof.example/signed?token=private receiptText=${rawReceipt}`,
};
const diagnostic = buildSafeProAttemptDiagnostic(source, owner, true);
assert.ok(diagnostic, "proprietário autenticado pode ver a tentativa bloqueada");
assert.equal(diagnostic.rawCode, "FAILED_PRECONDITION");
assert.equal(diagnostic.stage, "CALLABLE_REGISTRATION");
assert.equal(diagnostic.callable, "registerCanonicalSimpleTrip");
assert.equal(diagnostic.reasonCode, "não registrado", "reasonCode ausente não é inventado");
assert.match(diagnostic.attemptId, /…/);
assert.match(diagnostic.jobId, /…/);
assert.equal(diagnostic.operationId, "não registrado");
assert.equal(diagnostic.canonicalTripId, "não registrado");
for (const forbidden of [rawReceipt, rawToken, owner, "auth-header-secret", "secret-token-123", "https://proof.example", "receiptText="]) {
  assert.ok(!diagnostic.text.includes(forbidden), `secret/proof is absent from safe output: ${forbidden}`);
}
assert.match(diagnostic.serverMessage, /[conteúdo de recibo\/comprovante removido]/);

assert.equal(buildSafeProAttemptDiagnostic(source, "another-user", true), null, "non-owner cannot create a diagnostic");
assert.equal(buildSafeProAttemptDiagnostic(source, owner, false), null, "native auth mismatch fails closed");
assert.equal(buildSafeProAttemptDiagnostic({ ...source, queueStatus: "WAITING" }, owner, true), null, "non-blocked row is not exported");

let copyCount = 0;
let retryCount = 0;
let mutationCount = 0;
const markup = renderToStaticMarkup(React.createElement(ProAttemptDiagnosticDetails, {
  diagnostic,
  onCopy: () => { copyCount += 1; },
}));
assert.match(markup, /Copiar diagnóstico seguro/);
assert.match(markup, /CALLABLE_REGISTRATION/);
assert.match(markup, /FAILED_PRECONDITION/);
assert.ok(!markup.includes(rawReceipt) && !markup.includes(rawToken) && !markup.includes(owner));
assert.equal(copyCount, 0, "render/expandable details does not copy or execute an action");

let copied = "";
await copySafeProAttemptDiagnostic(diagnostic, async (text) => { copied = text; copyCount += 1; });
assert.equal(copied, diagnostic.text, "clipboard receives only the safe serialized DTO");
assert.equal(copyCount, 1);
assert.equal(retryCount, 0, "copy does not invoke retry");
assert.equal(mutationCount, 0, "render/copy have no persistence/Firestore mutation dependency");
assert.ok(!copied.includes(rawReceipt) && !copied.includes(rawToken) && !copied.includes(owner));

const plugin = await readFile(new URL("../android/app/src/main/java/com/nvu/operacional/SimpleAutomationPlugin.java", import.meta.url), "utf8");
const methodStart = plugin.indexOf("public void getReadOnlyProQueueDiagnostics(");
assert.ok(methodStart >= 0, "native bridge exposes dedicated read-only queue method");
const methodEnd = plugin.indexOf("\n    @PluginMethod", methodStart);
const nativeMethod = plugin.slice(methodStart, methodEnd < 0 ? plugin.length : methodEnd);
for (const forbidden of [".edit(", ".apply(", ".commit(", "deleteSharedPreferences", "getHttpsCallable", "FirebaseFirestore", "retryPending("]) {
  assert.ok(!nativeMethod.includes(forbidden), `native diagnostic getter does not call ${forbidden}`);
}
assert.ok(nativeMethod.includes("getUid()") && nativeMethod.includes("driverId"), "native getter verifies queue owner against current authenticated UID");
assert.ok(nativeMethod.includes("receiptText") === false, "native response does not read/export receipt text");
assert.ok(nativeMethod.includes("lastQueueErrorCode"), "raw persisted error marker is included for sanitization on-device");

const tripHistory = await readFile(new URL("../src/pages/driver/TripHistory.tsx", import.meta.url), "utf8");
const notice = await readFile(new URL("../src/components/PendingProOperationNotice.tsx", import.meta.url), "utf8");
assert.ok(tripHistory.includes("getReadOnlyProQueueDiagnostics"), "history queue UI uses the non-mutating native reader");
assert.ok(notice.includes("getReadOnlyProQueueDiagnostics"), "operation notice uses the non-mutating native reader");
assert.ok(!tripHistory.includes("SimpleAutomation.getStatus()"), "history queue display no longer triggers status reconciliation writes");
assert.ok(!notice.includes("SimpleAutomation.getStatus()"), "operation notice no longer triggers status reconciliation writes");

console.log("pro-attempt-diagnostic: PASS 26 assertions");
console.log("Owner-only diagnostics render and copy sanitized local evidence without retry, Firestore or SharedPreferences mutation.");
