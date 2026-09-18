import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const javaRoot = path.join(root, 'android', 'app', 'src', 'main', 'java');
const fixture = path.join(root, 'scripts', 'java-tests', 'com', 'nvu', 'operacional', 'GtoHf148DestinationOperationTest.java');
const policy = path.join(javaRoot, 'com', 'nvu', 'operacional', 'GtoAcceptedFreightFieldPolicy.java');
const destinationAuthority = path.join(javaRoot, 'com', 'nvu', 'operacional', 'GtoDestinationTextAuthorityPolicy.java');
const resolver = path.join(javaRoot, 'com', 'nvu', 'operacional', 'GtoCityTextResolver.java');
const evidence = path.join(javaRoot, 'com', 'nvu', 'operacional', 'GtoFreightFieldEvidencePolicy.java');
const review = path.join(javaRoot, 'com', 'nvu', 'operacional', 'GtoFreightReviewPolicy.java');
const manualRoute = path.join(javaRoot, 'com', 'nvu', 'operacional', 'GtoManualRouteSelectionPolicy.java');
const money = path.join(javaRoot, 'com', 'nvu', 'operacional', 'GtoMoneyValue.java');
const service = path.join(javaRoot, 'com', 'nvu', 'operacional', 'GtoObserverService.java');
const sync = path.join(javaRoot, 'com', 'nvu', 'operacional', 'GtoAutoTripSync.java');

for (const file of [fixture, policy, destinationAuthority, resolver, evidence, review, manualRoute, money, service, sync]) assert.ok(fs.existsSync(file), `missing ${file}`);

const source = fs.readFileSync(policy, 'utf8');
const serviceSource = fs.readFileSync(service, 'utf8');
const syncSource = fs.readFileSync(sync, 'utf8');
const evidenceSource = fs.readFileSync(evidence, 'utf8');

assert.match(source, /destination\(String currentDestination, String destinationCompany, String rawText\)/);
assert.match(source, /exactRouteTailContainedInCurrent/);
assert.match(source, /hasExactOfficialLocalitySuffix/);
assert.ok(
  /return rawTail;/.test(source)
    || source.includes("return GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(rawTail);")
);
assert.match(serviceSource, /acceptedVisibleDestination\(/);
assert.match(serviceSource, /GtoAcceptedFreightFieldPolicy\.destination\(/);
assert.match(serviceSource, /option\.acceptedListDestination = composedDestination;/);
assert.match(syncSource, /ensureCurrentOperationSnapshot/);
assert.match(syncSource, /beginSessionSnapshot\(context, prefs, sessionId\)/);
assert.match(serviceSource, /GtoAutoTripSync\.resolveOperationContextSnapshot\(this, prefs\)/);
assert.match(serviceSource, /catch \(RuntimeException (?:ignored|error)\)/);
assert.match(evidenceSource, /votes >= 2/);

const out = path.join('/tmp', `hf148-${process.pid}`);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const guard = path.join(javaRoot, 'com', 'nvu', 'operacional', 'GtoFreightTextGuard.java');
execFileSync('javac', ['-d', out, guard, policy, destinationAuthority, resolver, review, manualRoute, money, evidence, fixture], { stdio: 'inherit' });
execFileSync('java', ['-cp', out, 'com.nvu.operacional.GtoHf148DestinationOperationTest'], { stdio: 'inherit' });
fs.rmSync(out, { recursive: true, force: true });

console.log('HF148 PASS 18/18: duplicated destination blocked, locality reconstruction preserved, operation snapshot/render path fail-safe.');
