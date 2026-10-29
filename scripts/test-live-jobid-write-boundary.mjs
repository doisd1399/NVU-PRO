import fs from 'node:fs';

const files = [
  'functions/src/registerGtoProReceipt.ts',
  'functions/src/registerCanonicalSimpleTrip.ts',
  'functions/src/finalizeCanonicalOperation.ts',
  'functions/src/repairInvalidGtoPrintProgress.ts',
  'functions/src/reconcileOperationTrips.ts',
  'functions/src/canonicalOperationProjection.ts',
];

const forbiddenPatterns = [
  { re: /\.where\(\s*["']operationId["']\s*,\s*["']==["']\s*,/g, why: 'operationId query in LIVE path' },
  { re: /\.where\(\s*["']trabalhoId["']\s*,\s*["']==["']\s*,/g, why: 'trabalhoId query in LIVE path' },
  { re: /\btrip\.jobId\s*\|\|\s*trip\.trabalhoId\b/g, why: 'trabalhoId fallback for physical jobId' },
  { re: /\bstr\(\s*slotData\s*,\s*["']jobId["']\s*,\s*["']operationId["']\s*\)/g, why: 'operationId fallback for slot jobId' },
  { re: /\[\s*\.\.\.byJob\.docs\s*,\s*\.\.\.byOperation\.docs/g, why: 'legacy alias union in LIVE projection/replay' },
];

let failures = 0;
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const { re, why } of forbiddenPatterns) {
    re.lastIndex = 0;
    if (re.test(source)) {
      console.error(`FAIL ${file}: ${why}`);
      failures++;
    }
  }
}

const pro = fs.readFileSync('functions/src/registerGtoProReceipt.ts', 'utf8');
if (!/where\(\s*["']jobId["']\s*,\s*["']==["']\s*,\s*jobRef\.id\s*\)/.test(pro)) {
  console.error('FAIL registerGtoProReceipt.ts: exact physical jobId replay query missing');
  failures++;
}
const simple = fs.readFileSync('functions/src/registerCanonicalSimpleTrip.ts', 'utf8');
if (!/boundedId\(\s*trip\.jobId\s*,\s*["']jobId["']\s*\)/.test(simple)) {
  console.error('FAIL registerCanonicalSimpleTrip.ts: jobId is not required directly from trip.jobId');
  failures++;
}
const repair = fs.readFileSync('functions/src/repairInvalidGtoPrintProgress.ts', 'utf8');
if (!/str\(\s*slotData\s*,\s*["']jobId["']\s*\)\s*===\s*jobId/.test(repair)) {
  console.error('FAIL repairInvalidGtoPrintProgress.ts: slot validation is not exact jobId-only');
  failures++;
}


const projector = fs.readFileSync('functions/src/canonicalOperationProjection.ts', 'utf8');
if (!/physicalJobId:\s*string/.test(projector) ||
    !/const operationId = text\(input\.physicalJobId\)/.test(projector)) {
  console.error('FAIL canonicalOperationProjection.ts: projection scope is not explicitly supplied by physical jobId');
  failures++;
}
if (/field\(operation,\s*["']operationId["']/.test(projector) ||
    /field\(operation,\s*["']trabalhoId["']/.test(projector)) {
  console.error('FAIL canonicalOperationProjection.ts: mutable legacy alias can define LIVE projection scope');
  failures++;
}

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  let at = 0;
  while ((at = source.indexOf('buildCanonicalOperationProjection({', at)) !== -1) {
    const argsPrefix = source.slice(at, at + 240);
    if (!/physicalJobId\s*:/.test(argsPrefix)) {
      console.error(`FAIL ${file}: canonical projection call does not supply physicalJobId explicitly`);
      failures++;
    }
    at += 1;
  }
}

// LIVE reconciliation must never own legacy attribution/backfill logic.
const liveReconciler = fs.readFileSync("functions/src/reconcileOperationTrips.ts", "utf8");
for (const forbidden of [
  "legacyRecoverable",
  "legacyAmbiguous",
  "legacyPatches",
  "LEGACY_OPERATION_BINDING_RECOVERED",
  "legacyOperationTripRecovery",
]) {
  if (liveReconciler.includes(forbidden)) {
    console.error(`FAIL functions/src/reconcileOperationTrips.ts: forbidden LIVE legacy recovery symbol: ${forbidden}`);
    failures++;
  }
}
const legacyCountWithoutFixedZero = liveReconciler.replace(/\blegacyRecoveredCount\s*:\s*0\b/, "");
if (!/\blegacyRecoveredCount\s*:\s*0\b/.test(liveReconciler) || legacyCountWithoutFixedZero.includes("legacyRecoveredCount")) {
  console.error("FAIL functions/src/reconcileOperationTrips.ts: legacy recovery count must remain explicitly fixed at zero");
  failures++;
}
if (/where\(\s*["'](?:operationId|trabalhoId)["']\s*,\s*["']==["']/.test(liveReconciler)) {
  console.error("FAIL functions/src/reconcileOperationTrips.ts: LIVE reconciler queries a legacy operation alias");
  failures++;
}

if (failures) process.exit(1);
console.log('PASS: LIVE write/replay/finalization/repair paths require physical jobId; operationId/trabalhoId cannot substitute or join operational scope.');
