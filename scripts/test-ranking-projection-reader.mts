import assert from "node:assert/strict";
import { readProjectionRows } from "../src/services/rankingProjectionReader.ts";

const ok = { schemaVersion: 1, rows: [{ id: "j1" }] };
const calls: string[] = [];
const ports = (over: Record<string, any> = {}) => ({
  readDocument: async () => ({ exists: true, data: ok, fromCache: false }),
  ensure: async (id: string) => { calls.push("ensure"); return { success: true, participantId: id, schemaVersion: 1, rows: [{ id: "built" }] }; },
  ...over,
}) as any;

// Present on the server: used as is, no server call.
assert.deepEqual(await readProjectionRows("p1", ports()), { rows: [{ id: "j1" }], fromCache: false });
assert.deepEqual(calls, []);
// From the local cache: usable, flagged as not confirmed (the caller keeps it non-authoritative).
assert.deepEqual(await readProjectionRows("p1", ports({ readDocument: async () => ({ exists: true, data: ok, fromCache: true }) })), { rows: [{ id: "j1" }], fromCache: true });
// Unknown shape or version: not trusted.
for (const data of [{ schemaVersion: 2, rows: [] }, { schemaVersion: 1 }, { rows: [] }, null]) assert.equal(await readProjectionRows("p1", ports({ readDocument: async () => ({ exists: true, data, fromCache: false }) })), null);
// Missing on the server: the server builds it once.
assert.deepEqual(await readProjectionRows("p1", ports({ readDocument: async () => ({ exists: false, data: null, fromCache: false }) })), { rows: [{ id: "built" }], fromCache: false });
assert.deepEqual(calls, ["ensure"]);
// Missing only in the offline cache: proves nothing, so no server call and the full-history path decides.
calls.length = 0;
assert.equal(await readProjectionRows("p1", ports({ readDocument: async () => ({ exists: false, data: null, fromCache: true }) })), null);
assert.deepEqual(calls, []);
// An older server / unpublished Functions / permission or network error: fall back, never throw.
assert.equal(await readProjectionRows("p1", ports({ readDocument: async () => ({ exists: false, data: null, fromCache: false }), ensure: async () => { throw Object.assign(new Error("x"), { code: "functions/not-found" }); } })), null);
assert.equal(await readProjectionRows("p1", ports({ readDocument: async () => { throw Object.assign(new Error("denied"), { code: "permission-denied" }); } })), null);
// An answer about another participant or a malformed one is refused.
for (const answer of [{ success: true, participantId: "other", schemaVersion: 1, rows: [] }, { success: false }, { success: true, participantId: "p1", schemaVersion: 1, rows: "x" }, undefined])
  assert.equal(await readProjectionRows("p1", ports({ readDocument: async () => ({ exists: false, data: null, fromCache: false }), ensure: async () => answer })), null);
console.log("RANKING_PROJECTION_READER_PASS");
