import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceRoots = ['src', 'functions/src', 'android/app/src/main/java'];
const forbidden = /(?:historico_viagens|trip_operation_slots|trabalhos|progress|operationSlot|lastValidatedTripId)/;
const write = /(?:\b(?:addDoc|setDoc|updateDoc|deleteDoc|runTransaction)\s*\(|\btransaction\.(?:set|update|delete)\s*\()/;
const allowed = [
  'src/services/sync/FirebaseTripSyncAdapter.ts',
  'src/services/tripModerationService.ts',
  'src/services/operationIntegrityGuard.ts',
  'src/application/operation/CanonicalOperationCommandService.ts',
  'functions/src/',
  'android/app/src/main/java/com/nvu/operacional/SimpleProNativeSubmissionCoordinator.java',
  'android/app/src/main/java/com/nvu/operacional/ProPendingTripStore.java',
  'android/app/src/main/java/com/nvu/operacional/ProPendingTripJobService.java',
];
const isAllowed = (file) => allowed.some((prefix) => file === prefix || file.startsWith(prefix));
const violations = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel);
    else if (/\.(ts|tsx|java)$/.test(entry.name) && !rel.includes('/test') && !rel.includes('.test.')) {
      const lines = fs.readFileSync(path.join(root, rel), 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (write.test(line) && forbidden.test(line) && !isAllowed(rel)) violations.push(`${rel}:${index + 1}:${line.trim()}`);
      });
    }
  }
};
sourceRoots.forEach(walk);
assert.deepEqual(violations, [], `Unauthorized operational writers found:\n${violations.join('\n')}`);
console.log('OPERATIONAL WRITE BOUNDARY: PASS');
console.log(`Authorized canonical writer adapters: ${allowed.length}`);
