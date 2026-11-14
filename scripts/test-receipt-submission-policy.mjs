import assert from "node:assert/strict";
import {
  assertRemoteTripReceiptReady,
  shouldQueueTripLocally,
} from "../src/lib/receiptSubmissionPolicy.ts";

const pending = { imageHash: "sha256-example", offlineReceiptKey: "receipt-example", comprovanteUrl: "" };
assert.equal(shouldQueueTripLocally(pending, false), true,
  "Storage failed but Firestore is online: queue the receipt and trip together");
assert.equal(shouldQueueTripLocally(pending, true), true);
assert.throws(() => shouldQueueTripLocally(pending, false, false), /OFFLINE_RECEIPT_UPLOAD_REQUIRED/,
  "The replay path cannot commit until it has uploaded the receipt");
assert.throws(() => assertRemoteTripReceiptReady(pending), /TRIP_RECEIPT_UPLOAD_REQUIRED/);
assert.throws(() => assertRemoteTripReceiptReady({ imageHash: "sha256-example", comprovanteUrl: "" }),
  /TRIP_RECEIPT_UPLOAD_REQUIRED/);

const uploaded = { imageHash: "sha256-example", comprovanteUrl: "https://example.invalid/receipt" };
assert.equal(shouldQueueTripLocally(uploaded, false), false);
assert.doesNotThrow(() => assertRemoteTripReceiptReady(uploaded));
assert.doesNotThrow(() => assertRemoteTripReceiptReady({ simpleAutomation: true, valor: 25 }));
console.log("PASS: a trip with a pending local receipt cannot be committed remotely");
