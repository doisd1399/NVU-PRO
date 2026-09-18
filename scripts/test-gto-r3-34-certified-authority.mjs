import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const javaRoot = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'nvu', 'operacional');
const javaFixtureRoot = path.join(root, 'scripts', 'java-tests', 'com', 'nvu', 'operacional');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));

const certified = read('android/app/src/main/java/com/nvu/operacional/GtoCertifiedFreight.java');
const service = read('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java');
const sync = read('android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java');
const bridge = read('android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java');
const observerTypes = read('src/lib/gtoObserver.ts');
const launcher = read('src/services/gtoWorkLauncher.ts');
const setup = read('src/components/GtoObserverSetup.tsx');
const dashboard = read('src/pages/driver/Dashboard.tsx');
const backend = read('functions/src/gtoTrips.ts');

for (const relative of [
  'android/app/src/main/java/com/nvu/operacional/GtoCertifiedFreight.java',
  'scripts/java-tests/com/nvu/operacional/GtoCertifiedAuthorityContractTest.java',
]) assert.ok(exists(relative), `missing ${relative}`);

assert.match(certified, /static JSONObject seal\(JSONObject candidate, SharedPreferences prefs, String source\)/);
assert.match(certified, /static void applyToPrefs\(SharedPreferences\.Editor editor, JSONObject certified\)/);
assert.match(certified, /static void copyIntoSnapshot\(JSONObject snapshot, JSONObject certified\)/);
assert.match(certified, /static void copyIntoPayload\(JSONObject payload, JSONObject certified\)/);
assert.match(certified, /sourceLineFingerprint/);
assert.match(certified, /evidenceFingerprint/);
assert.match(certified, /freightFingerprint/);
assert.match(certified, /if \("LIST"\.equals\(safeSource\)\)/);
assert.doesNotMatch(certified, /uniqueOfficialCanonicalCandidate\(/, 'CertifiedFreight must not apply global fuzzy city correction');

assert.match(service, /GtoCertifiedFreight\.seal\(parsedCandidate, prefs, "LIST"\)/);
assert.match(service, /GtoCertifiedFreight\.seal\(pauseCandidate, prefs, "PAUSE"\)/);
assert.match(service, /GtoCertifiedFreight\.applyToPrefs\(certifiedEditor, certifiedFreight\)/);
assert.match(service, /GtoCertifiedFreight\.isValid\(\s*canonicalFreight/);
assert.match(service, /CertifiedFreight is already canonical/);
assert.match(service, /resolveOperationContextSnapshot/);
assert.match(sync, /AUTH_LIVE/);
assert.match(service, /Operação atual indisponível/);

assert.match(sync, /GtoCertifiedFreight\.read\(prefs\)/);
assert.match(sync, /GtoCertifiedFreight\.copyIntoSnapshot\(snapshot, candidate\)/);
assert.match(sync, /GtoCertifiedFreight\.copyIntoPayload\(payload, certifiedFreight\)/);
assert.match(sync, /if \(!hasCertifiedFreight\)/);
assert.match(sync, /operationContextRevision/);
assert.match(sync, /if \(!activeJobId\.isEmpty\(\) && !activeJobId\.equals\(snapshotJobId\)\)/);

assert.match(bridge, /putStringIfPresent\(editor, call, "operationName"/);
assert.match(bridge, /putStringIfPresent/);
assert.match(bridge, /gtoOperationContextRevision/);
assert.match(bridge, /Contexto GTO incompleto/);
assert.match(bridge, /operationSnapshotAvailable/);

assert.match(observerTypes, /buildGtoOperationContext/);
assert.match(observerTypes, /never falls back to companyName/);
assert.match(launcher, /buildGtoOperationContext\(context\)/);
assert.match(setup, /buildGtoOperationContext\(context\)/);
assert.match(dashboard, /operationName: myJob\.contractNameSnapshot/);
assert.match(dashboard, /webRuntimeRevision: GTO_WEB_RUNTIME_REVISION/);

assert.match(backend, /const effectiveOrigin = origin;/);
assert.doesNotMatch(backend, /if \(origin !== originCompany\)/);
assert.match(backend, /gtoFreightAuthorityId/);
assert.match(backend, /gtoSourceLineFingerprint/);

const javaOut = path.join('/tmp', `gto-certified-authority-${process.pid}`);
fs.rmSync(javaOut, { recursive: true, force: true });
fs.mkdirSync(javaOut, { recursive: true });
const policyFiles = [
  'GtoFreightTextGuard.java',
  'GtoAcceptedFreightFieldPolicy.java',
  'GtoDestinationTextAuthorityPolicy.java',
  'GtoCityTextResolver.java',
].map((name) => path.join(javaRoot, name));
policyFiles.push(path.join(javaFixtureRoot, 'GtoCertifiedAuthorityContractTest.java'));
execFileSync('javac', ['-d', javaOut, ...policyFiles], { stdio: 'inherit' });
execFileSync('java', ['-cp', javaOut, 'com.nvu.operacional.GtoCertifiedAuthorityContractTest'], { stdio: 'inherit' });
fs.rmSync(javaOut, { recursive: true, force: true });

console.log('CERTIFIED-AUTHORITY PASS: single source, List/Pause separation, identity-bound operation authority, backend route authority and text fixtures verified.');
