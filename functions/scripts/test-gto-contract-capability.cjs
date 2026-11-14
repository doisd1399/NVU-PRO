const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
let firestoreAccesses = 0;
class HttpsError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}
const firestore = () => { firestoreAccesses++; throw new Error("Capability probe must not access Firestore"); };
firestore.FieldValue = { serverTimestamp() { throw new Error("Probe must not request a timestamp"); } };
const mocks = {
  "firebase-admin": { firestore },
  "firebase-admin/firestore": { FieldValue: firestore.FieldValue },
  "firebase-functions": { region: () => ({ https: { onCall: f => f } }), https: { HttpsError }, logger: { info() {} } },
};
const original = Module._load;
Module._load = function(request, parent, isMain) { return mocks[request] || original.call(this, request, parent, isMain); };
const { registerGtoProReceipt: handler } = require(process.env.GTO_TEST_HANDLER || "../lib/registerGtoProReceipt.js");
Module._load = original;
(async () => {
  const uidA = "synthetic-owner-a-123", uidB = "synthetic-owner-b-456";
  const probe = { compatibilityProbe: "gto-contract-v2" };
  if (process.env.GTO_EXPECT_OLD === "true") {
    await assert.rejects(handler(probe, { auth: { uid: uidA } }), e => e.code === "invalid-argument");
    assert.equal(firestoreAccesses, 0);
    console.log("REPRODUCED R4 source: valid authenticated compatibility probe rejected before DB");
    return;
  }
  for (const uid of [uidA, uidB]) {
    const result = await handler(probe, { auth: { uid } });
    assert.equal(result.compatible, true);
    assert.equal(result.callable, "registerGtoProReceipt");
    assert.equal(result.contractVersion, "gto-contract-v2");
    assert.equal(result.allowsUnknownCurrency, true);
    assert.equal(result.registered, undefined, "Capability is never a trip ACK");
    assert.equal(result.tripId, undefined);
  }
  await assert.rejects(handler(probe, {}), e => e.code === "unauthenticated");
  for (const version of ["gto-contract-v1", "", null, 2, {}])
    await assert.rejects(handler({ compatibilityProbe: version }, { auth: { uid: uidA } }),
      e => e.code === "invalid-argument" && e.details.reasonCode === "GTO_PROTOCOL_UNSUPPORTED");
  await assert.rejects(handler({}, { auth: { uid: uidA } }),
    e => e.code === "invalid-argument" && e.details.reasonCode === "GTO_CONTEXT_INVALID");
  assert.equal(firestoreAccesses, 0);
  console.log("PASS authenticated capability for two owners, old/type-invalid versions, no ACK, zero DB access");
})().catch(error => { console.error(error); process.exitCode = 1; });
