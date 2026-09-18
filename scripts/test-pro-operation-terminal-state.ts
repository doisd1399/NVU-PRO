import assert from "node:assert/strict";
import {
  isClosedJobStatus,
  isTripRecordableJobStatus,
} from "../src/lib/jobStatus";

assert.equal(isTripRecordableJobStatus("active", 9, 10), true);
assert.equal(isClosedJobStatus("active", 9, 10), false);
assert.equal(isTripRecordableJobStatus("active", 10, 10), false);
assert.equal(isClosedJobStatus("active", 10, 10), true);
assert.equal(isTripRecordableJobStatus("delayed", 4, 5), true);
assert.equal(isTripRecordableJobStatus("delayed", 5, 5), false);
assert.equal(isTripRecordableJobStatus("awaiting_completion", 9, 10), true);
assert.equal(isTripRecordableJobStatus("awaiting_completion", 10, 10), false);
assert.equal(isClosedJobStatus("awaiting_completion", 10, 10), true);
assert.equal(isTripRecordableJobStatus("completed", 9, 10), false);
assert.equal(isClosedJobStatus("completed", 9, 10), true);
assert.equal(isTripRecordableJobStatus("cancelled", 0, 10), false);
assert.equal(isClosedJobStatus("cancelled", 0, 10), true);
assert.equal(isTripRecordableJobStatus("active", 0, 0), true);
assert.equal(isClosedJobStatus("active", 0, 0), false);

console.log("pro-operation-terminal-state: PASS recordable/closed matrix");
