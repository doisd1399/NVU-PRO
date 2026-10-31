import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

// The classification history may consolidate CLOSED periods up to the history window, once; older or open-old ones are refused.
const projectId = "demo-nvu-v36-4-staging";
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^127\.0\.0\.1:\d+$/);
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require(process.cwd() + "/functions/lib/firebaseAdmin.js");
if (!admin.apps.length) admin.initializeApp({ projectId });
const { ensureRankingAggregates } = require("./lib/rankingAggregates.js");
const { RANKING_HISTORY_WINDOW_DAYS, RANKING_RECENT_WINDOW_DAYS } = require("./lib/rankingCalendar.js");
const db = admin.firestore();
const ctx = { auth: { uid: "viewer", token: {} } };
const monthKey = daysAgo => { const d = new Date(Date.now() - daysAgo * 86400000); return `mes_${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const run = key => ensureRankingAggregates.run({ simulatorId: "gto", periodType: "mes", periodKey: key }, ctx);
const results = [];
async function test(name, fn) { try { await fn(); results.push("PASS"); console.log(`PASS ${name}`); } catch (error) { results.push("FAIL"); console.error(`FAIL ${name}`, error); } }
try {
  await db.doc("simulators/gto").set({ id: "gto", name: "GTO", active: true });
  assert.equal(RANKING_RECENT_WINDOW_DAYS, 70); assert.equal(RANKING_HISTORY_WINDOW_DAYS, 240);
  const oldKey = monthKey(120);   // a closed month 3-4 months back: outside the recent window, inside the history window
  const tooOld = monthKey(330);   // beyond the history window
  await test("a closed month older than the recent window is consolidated once", async () => {
    const first = await run(oldKey);
    assert.equal(first.success, true); assert.ok(["rebuilt", "ready"].includes(first.status), first.status);
    const stored = await db.collection("ranking_aggregates").where("periodKey", "==", oldKey).get();
    assert.ok(stored.size >= 1, "the aggregate document exists after the call");
  });
  await test("asking again does not rebuild a closed history period", async () => {
    const before = await db.collection("ranking_aggregates").where("periodKey", "==", oldKey).get();
    const stamp = before.docs[0].get("lastReconciledAt").toMillis();
    const again = await run(oldKey);
    assert.equal(again.status, "ready");
    const after = await db.collection("ranking_aggregates").doc(before.docs[0].id).get();
    assert.equal(after.get("lastReconciledAt").toMillis(), stamp, "closed history is not reconciled again");
  });
  await test("a closed period reconciled BEFORE it ended is rebuilt once, then kept", async () => {
    const snap = (await db.collection("ranking_aggregates").where("periodKey", "==", oldKey).get()).docs[0];
    const [, year, month] = /^mes_(\d{4})-(\d{2})$/.exec(oldKey);
    const midMonth = admin.firestore.Timestamp.fromDate(new Date(Date.UTC(Number(year), Number(month) - 1, 15)));
    await snap.ref.update({ lastReconciledAt: midMonth });
    const rebuilt = await run(oldKey);
    assert.equal(rebuilt.status, "rebuilt");
    const after = (await snap.ref.get()).get("lastReconciledAt").toMillis();
    assert.ok(after > midMonth.toMillis(), "reconciliation moved past the end of the period");
    assert.equal((await run(oldKey)).status, "ready");
    assert.equal((await snap.ref.get()).get("lastReconciledAt").toMillis(), after);
  });
  await test("a period beyond the history window is refused", async () => {
    await assert.rejects(run(tooOld), error => String(error.code).includes("failed-precondition"));
  });
  await test("anonymous callers and bad keys are still refused", async () => {
    await assert.rejects(ensureRankingAggregates.run({ simulatorId: "gto", periodType: "mes", periodKey: oldKey }, {}), error => String(error.code).includes("unauthenticated"));
    await assert.rejects(run("mes_banana"), error => String(error.code).includes("invalid-argument"));
  });
} finally { await admin.deleteApp(admin.app()); }
console.log(`RANKING_HISTORY_WINDOW_EMULATOR ${results.filter(x => x === "PASS").length}/${results.length} PASS`);
if (results.includes("FAIL")) process.exitCode = 1;
