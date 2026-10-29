import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyRemainingDebt } from '../functions/src/remainingDebtClassifier.ts';

const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const sourceFiles = [
  'functions/src/registerCanonicalSimpleTrip.ts',
  'functions/src/registerGtoProReceipt.ts',
  'functions/src/gtoTrips.ts',
].map((file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));

const classification = classifyRemainingDebt({
  divergentTotal: 634,
  requiredTripsMissing: 151,
  criticalOverflow: 44,
  manualReview: 612,
  incompleteOrMissingCanonicalTrips: 439,
});
assert.deepEqual(classification.buckets, {
  CRITICAL_OVERFLOW: 44,
  REQUIRED_TRIPS_RECOVERY: 151,
  MANUAL_REVIEW_CANONICAL_EVIDENCE: 439,
});
assert.equal(Object.values(classification.buckets).reduce((a, b) => a + b, 0), 634);
assert.equal(classification.safeToApply, false);
assert.match(rules, /match \/historico_viagens\/\{tripId\}[\s\S]*?allow create: if false;/);
assert.match(rules, /function validJobUpdate\(jobId\)[\s\S]*?Client-side progress and finalization are never authoritative/);
for (const source of sourceFiles) assert.match(source, /runTransaction/);
assert.doesNotMatch(rules, /allow create: if request\.auth != null[\s\S]*?validTripJobBinding/);
console.log('PHASE8_AUTHORITY_TEST_PASS');
