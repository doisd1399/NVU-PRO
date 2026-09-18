import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const assignJob = read("src/pages/admin/AssignJob.tsx");
const profile = read("src/pages/driver/Profile.tsx");

assert.match(assignJob, /AssignJobAssetPicker/);
assert.match(assignJob, /isContractPickerOpen/);
assert.match(assignJob, /isVehiclePickerOpen/);
assert.match(assignJob, /selectedTrailerData\?\.name/);
assert.match(assignJob, /selectedContractData\?\.trailerId/);
assert.match(assignJob, /trailerlessSimulator \? undefined : selectedContractData\?\.trailerId \|\| undefined/);
assert.doesNotMatch(assignJob, /const \[selectedTrailer, setSelectedTrailer\]/);
assert.doesNotMatch(assignJob, /const availableTrailers = \[\.\.\.trailers\]/);
assert.doesNotMatch(assignJob, /value=\{selectedTrailer\}/);
assert.doesNotMatch(assignJob, /onChange=\{\(e\) => setSelectedTrailer\(e\.target\.value\)\}/);

assert.match(profile, /!jobsReady && cachedOperationSnapshot\?\.job/);
assert.match(profile, /isRunningJobStatus\(\s*String\(cachedOperationSnapshot\.job\.status/);
assert.match(profile, /const activeOperationCardJob/);
assert.match(profile, /if \(jobsReady\) \{[\s\S]{0,220}clearActiveOperationSnapshot/);

console.log("assign-job-active-operation: PASS picker-derived trailer and stale active-card guard");
