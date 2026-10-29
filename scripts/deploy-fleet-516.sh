#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
project="${NVU_FIREBASE_PROJECT:-vtc-frota-log}"
npm --prefix functions run build
node - <<'NODE'
const assert=require('node:assert/strict'),f=require('./functions/lib/fleetMembership.js').manageFleetMembership;
assert.equal(f.__trigger.labels['deployment-callable'],'true');assert.deepEqual(f.__endpoint.callableTrigger,{});assert.equal(f.__endpoint.ingressSettings,'ALLOW_ALL');
NODE
node node_modules/firebase-tools/lib/bin/firebase.js deploy --only functions:manageFleetMembership,functions:approveRecruitmentApplication,functions:approveDriverRequest,functions:repairApprovedMembership --project "$project" --non-interactive
NVU_FIREBASE_PROJECT="$project" node scripts/repair-fleet-invoker-515.mjs
NVU_FIREBASE_PROJECT="$project" node scripts/probe-fleet-http-515.mjs
