import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const roots = ['src', 'android/app/src/main/java'];
const files = [];
function walk(dir) {
  const absolute = path.join(root, dir);
  if (!fs.existsSync(absolute)) return;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel);
    else if (/\.(ts|tsx|java|kt)$/.test(entry.name)) files.push(rel);
  }
}
roots.forEach(walk);
const prohibited = [];
const controlled = [];
const createHistory = /(?:addDoc|setDoc|transaction\.(?:set|create)|batch\.set|batch\.create)[\s\S]{0,260}?historico_viagens|historico_viagens[\s\S]{0,260}?(?:addDoc|setDoc|transaction\.(?:set|create)|batch\.set|batch\.create)/;
const forbiddenJobMutation = /(?:updateDoc|setDoc|transaction\.(?:update|set)|batch\.(?:update|set))[\s\S]{0,120}?trabalhos[\s\S]{0,120}?(?:progress|lastValidatedTripId|lastDeletedTripId|operationReconciliationVersion|operationProjectionSource)|(?:progress|lastValidatedTripId|lastDeletedTripId|operationReconciliationVersion|operationProjectionSource)[\s\S]{0,120}?trabalhos/;
const forbiddenCompletedMutation = /(?:updateDoc|setDoc|transaction\.(?:update|set)|batch\.(?:update|set))[\s\S]{0,120}?trabalhos[\s\S]{0,120}?status\s*[:=]\s*["'`]completed["'`]|status\s*[:=]\s*["'`]completed["'`][\s\S]{0,120}?trabalhos/;
for (const rel of files) {
  const source = fs.readFileSync(path.join(root, rel), 'utf8');
  const compact = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (createHistory.test(compact)) prohibited.push({ file: rel, reason: 'direct historical-trip creation/write' });
  if (forbiddenJobMutation.test(compact)) prohibited.push({ file: rel, reason: 'client mutation of server-owned operation projection' });
  if (forbiddenCompletedMutation.test(compact)) prohibited.push({ file: rel, reason: 'client mutation of terminal completed status' });
  if (/FirebaseTripSyncAdapter\.(ts|tsx)$/.test(rel) || /tripModerationService\.(ts|tsx)$/.test(rel)) {
    if (/historico_viagens/.test(compact) && /(?:runTransaction|transaction\.(?:update|set|delete))/.test(compact)) controlled.push({ file: rel, reason: 'controlled edit/delete path; not normal registration/progress' });
  }
}
const report = {
  phase: 'F9', generatedAt: new Date().toISOString(), scannedRoots: roots,
  prohibited, controlled, pass: prohibited.length === 0,
  invariants: {
    directHistoricalTripCreation: prohibited.every((x) => x.reason !== 'direct historical-trip creation/write'),
    clientOwnedProgressMutation: prohibited.every((x) => x.reason !== 'client mutation of server-owned operation projection'),
    clientOwnedCompletedMutation: prohibited.every((x) => x.reason !== 'client mutation of terminal completed status'),
    controlledEditDeleteSeparated: controlled.length > 0,
  },
};
fs.writeFileSync(path.join(root, 'CLIENT_WRITES_AUDIT.json'), JSON.stringify(report, null, 2) + '\n');
assert.equal(prohibited.length, 0, `F9 prohibited client writes found: ${JSON.stringify(prohibited)}`);
console.log(`PHASE9 CLIENT WRITES: PASS (${files.length} files scanned; ${controlled.length} controlled paths documented)`);
