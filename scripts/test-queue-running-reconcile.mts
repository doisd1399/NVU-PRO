import assert from "node:assert/strict";
import fs from "node:fs";
import { reconcileQueueViewWithJobs, driverQueuePresentation } from "../src/lib/driverQueuePresentation.ts";

// The server snapshot of the queue can still say "ready" for a few seconds after this device started (or resumed) a job.
// The local running job must win: no "Iniciar trabalho", no highlighted "next", reason "running".
const view: any = { reason: "ready", queues: [{ id: "q", name: "Fila", count: 2, done: 0, state: "active" }],
  items: [{ queueId: "q", id: "c1", position: 1, state: "next", name: "BLS - 160" }, { queueId: "q", id: "c2", position: 2, state: "waiting", name: "BLS - 170" }],
  vehicles: [{ id: "v", name: "V" }], next: { queueId: "q", contractId: "c1", previewToken: "t", configRevision: 1 }, currentJob: null, manualPendingIds: [] };
const job = (over: any = {}) => ({ id: "j1", companyId: "co", driverId: "me", contractId: "c1", status: "active", ...over });

for (const status of ["active", "delayed", "awaiting_completion"]) {
  const out: any = reconcileQueueViewWithJobs(view, [job({ status })], "me", "co");
  assert.equal(out.reason, "running", status); assert.equal(out.next, null); assert.equal(out.currentJob.id, "j1");
  assert.equal(driverQueuePresentation(out).next, null, "nothing is highlighted as the next start");
}
assert.equal(reconcileQueueViewWithJobs(view, [job({ status: "cancelled" })], "me", "co"), view, "a cancelled job releases the queue immediately");
assert.equal(reconcileQueueViewWithJobs(view, [job({ status: "completed" })], "me", "co"), view);
assert.equal(reconcileQueueViewWithJobs(view, [job({ status: "pending" })], "me", "co"), view, "a pending job is not running");
assert.equal(reconcileQueueViewWithJobs(view, [job({ driverId: "other" })], "me", "co"), view, "another driver's job is ignored");
assert.equal(reconcileQueueViewWithJobs(view, [job({ companyId: "other" })], "me", "co"), view, "another company's job is ignored");
assert.equal(reconcileQueueViewWithJobs(view, [], "me", "co"), view);
assert.equal(reconcileQueueViewWithJobs(null, [job()], "me", "co"), null);
assert.equal(reconcileQueueViewWithJobs(view, [job()], null, "co"), view);
assert.equal(view.reason, "ready", "the cached server snapshot is never mutated");

const panel = fs.readFileSync("src/components/operations/AutomaticDriverQueue.tsx", "utf8");
assert.match(panel, /reconcileQueueViewWithJobs\(api\.view, jobs, currentUser\?\.id, activeCompanyId\)/, "the driver panel reconciles the snapshot with local jobs");

// Cancel answers at once: the card leaves the list before the server answers and returns only if the server refuses.
const app = fs.readFileSync("src/context/AppContext.tsx", "utf8");
const cancel = app.slice(app.indexOf("const cancelJob = async"), app.indexOf("const changeJobVehicle"));
assert.ok(cancel.indexOf('status: "cancelled" as const } : job));\n        try {') > 0 && cancel.indexOf('status: "cancelled" as const } : job));\n        try {') < cancel.indexOf('executeManaged({ action: "cancel"'), "optimistic update precedes the command");
assert.match(cancel, /job\.id === jobId && job\.status === "cancelled" \? previous : job/, "refusal restores the previous job");
const tab = fs.readFileSync("src/pages/admin/fleet/OperationsTab.tsx", "utf8");
const confirm = tab.slice(tab.indexOf("const confirmCancel"), tab.indexOf("const pendingDemands"));
assert.ok(confirm.indexOf("setJobToCancel(null)") < confirm.indexOf("cancelJob(jobId)"), "dialog closes before the command is awaited");
assert.ok(!/await cancelJob/.test(confirm), "the dialog never waits for the server");
console.log("QUEUE_RUNNING_RECONCILE_OK");
