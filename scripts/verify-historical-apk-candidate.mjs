import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Only fixture transports and demo emulators are allowed. This script never
// reads live Firebase data or runs any deploy, migration or backfill command.
const output = path.resolve('.ci-evidence');
fs.mkdirSync(output, { recursive: true });
const helper = 'verification/load-transition-source.mjs';
const checks = [
  ['LINT', ['npm', 'run', 'lint']],
  ['SCOPED_HISTORY_ARCHITECTURE_N0_N20', ['node', 'verification/verify-scoped-history-architecture.mjs', `${output}/ARCHITECTURE_422.json`]],
  ['HISTORY_BOUNDARIES_G0_G7', ['node', 'verification/verify-open-history-boundaries.mjs', '.', helper, `${output}/G.json`]],
  ['HISTORY_COVERAGE_H0_H17', ['node', 'verification/verify-history-read-coverage.mjs', '.', helper, `${output}/H.json`]],
  ['HISTORY_STORAGE_S0_S9', ['node', 'verification/verify-history-storage-recovery.mjs', '.', helper, `${output}/S.json`]],
  ['HISTORY_COVERAGE_FOLLOWUP_T', ['node', 'verification/verify-history-coverage-followup.mjs', '.', helper, `${output}/T.json`]],
  ['LOCAL_QUEUE_DIAGNOSTIC_Q', ['node', 'verification/verify-local-trip-sync-diagnostic.mjs', `${output}/Q.json`]],
  ['FAILED_REGISTRATION_RECOVERY_R', ['node', 'verification/verify-failed-registration-recovery.mjs', `${output}/R.json`]],
  ['DIAGNOSTIC', ['node', 'verification/verify-history-scope-diagnostic.mjs', '.', `${output}/diagnostic.json`]],
  ...[
    'test-historical-rankings-correction.mjs',
    'test-trip-consistency-regressions.ts',
    'test-profile-ranking.ts',
    'test-profile-ranking-sources.mjs',
    'test-ranking-cold-start-contract.mjs',
    'test-trip-history-persistent-cache.mjs',
    'test-offline-database-storage.mjs',
    'test-offline-sync-job-order.mjs',
    'test-offline-trip-dates.ts',
    'test-trip-value-integrity.mjs',
    'test-senior-trip-history-auth.mjs',
    'test-driver-history-scenarios.mjs',
    'test-current-operation-source-of-truth.ts',
    'test-operation-required-trips-matrix.ts',
    'test-operation-finalization-regression.ts',
  ].map(file => [file, ['node', '--import', 'tsx', `scripts/${file}`]]),
  ['WEB_BUILD', ['npm', 'run', 'build']],
];
const results = [];
for (const [id, [command, ...args]] of checks) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', timeout: 240_000, maxBuffer: 16 * 1024 * 1024,
  });
  const log = `${id.replaceAll(/[^a-zA-Z0-9_-]/g, '_')}.log`;
  fs.writeFileSync(path.join(output, log), `${result.stdout || ''}${result.stderr || ''}${result.error ? '\n' + result.error.message : ''}`);
  results.push({ id, exitCode: result.status, status: result.status === 0 ? 'PASS' : 'FAIL', log });
  fs.writeFileSync(path.join(output, 'gates.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`${id}: ${results.at(-1).status}`);
  if (result.status !== 0) {
    console.error(`Gate failed; inspect ${log}. APK build is blocked.`);
    process.exit(1);
  }
}
