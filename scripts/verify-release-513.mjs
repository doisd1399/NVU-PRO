import { spawnSync } from 'node:child_process';

const run = (name, args, cmd = process.execPath) => {
  console.log('VALIDATE', name);
  const result = spawnSync(cmd, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw Error(`${name}_FAILED`);
};

run('SOURCE_PROVENANCE', ['scripts/verify-source-513.py'], 'python3');
run('FRONTEND_TYPESCRIPT', ['node_modules/typescript/bin/tsc', '--noEmit']);
run('FUNCTIONS_TYPESCRIPT', ['functions/node_modules/typescript/bin/tsc', '-p', 'functions/tsconfig.json']);
run('FLEET_RESPONSE_RECOVERY', ['--import', 'tsx', 'scripts/test-fleet-reliability-513.ts']);
run('IMMEDIATE_TRIP_HISTORY', ['--import', 'tsx', 'scripts/test-trip-history-513.ts']);
run('TRIP_ACK_TRANSPORT_RECOVERY', ['scripts/test-audit-trip-reliability.mjs']);
run('ADMIN_REJECTION_CLIENT_RETRY', ['run', 'test:admin-rejection-client'], process.platform === 'win32' ? 'npm.cmd' : 'npm');
run('MEMBERSHIP_SECURITY_501_AUTH_EMULATOR', ['run', 'test:membership-security-501'], process.platform === 'win32' ? 'npm.cmd' : 'npm');
run('WEB_BUILD', ['run', 'build'], process.platform === 'win32' ? 'npm.cmd' : 'npm');
run('DIST_MANIFEST', ['scripts/create-release-files-513.mjs']);
run('SOURCE_FINAL', ['scripts/verify-source-513.py'], 'python3');
console.log('RELEASE_513_LOCAL_VERIFICATION_PASS');
