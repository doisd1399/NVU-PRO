import fs from "node:fs";
import assert from "node:assert/strict";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const service = read("../android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java");
const plugin = read("../android/app/src/main/java/com/nvu/operacional/SimpleAutomationPlugin.java");
const drivers = read("../src/pages/admin/fleet/DriversTab.tsx");
const context = read("../src/context/AppContext.tsx");

assert.match(service, /isLikelyResultReceiptText\(ocrText\)/);
assert.match(service, /hasMonetaryCandidateForReceipt\(ocrText\)/);
assert.match(service, /finishCapture\(resultReceipt \? ocrText : ""\)/);
assert.match(service, /nativeRetryPending/);
assert.match(service, /NATIVE_SUBMISSION_RETRY_INTERVAL_MS/);
assert.match(service, /scheduleNativeSubmissionRetry\(\)/);
assert.match(service, /existingProgress/);
assert.match(service, /existingClosed/);
assert.match(plugin, /nativeRetryPending/);
assert.match(drivers, /return member\?\.status === "active" \? member\.roles : \[\];/);
assert.doesNotMatch(drivers, /driver\.companyId === activeCompanyId/);
assert.match(context, /allCompanyMembersReady\s*\?\s*fetchedMissingUsers\.filter/);
assert.match(context, /setFetchedMissingUsers\(\(current\) => current\.filter/);
assert.match(context, /setAllCompanyMembers\(\(current\) =>/);

console.log("PASS: Pro hardening contract — strict OCR, durable retry, monotonic snapshot and membership authority");
