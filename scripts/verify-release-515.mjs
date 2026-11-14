import { spawnSync } from 'node:child_process';

const run = (name, args, cmd = process.execPath) => {
  console.log('VALIDATE', name);
  const result = spawnSync(cmd, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw Error(`${name}_FAILED`);
};

run('SOURCE_PROVENANCE', ['scripts/verify-source-515.py'], 'python3');
run('FRONTEND_TYPESCRIPT', ['node_modules/typescript/bin/tsc', '--noEmit']);
run('FUNCTIONS_TYPESCRIPT', ['functions/node_modules/typescript/bin/tsc', '-p', 'functions/tsconfig.json']);
run('CALLABLE_DEPLOYMENT_AND_BOUNDED_IAM_PLAN', ['scripts/test-fleet-deployment-515.mjs']);
run('LOCAL_COMMIT_AND_COMPACT_HISTORY', ['--import','tsx','scripts/test-local-commit-515.ts']);
run('FLEET_RESPONSE_RECOVERY', ['--import', 'tsx', 'scripts/test-fleet-reliability-513.ts']);
run('IMMEDIATE_TRIP_HISTORY', ['--import', 'tsx', 'scripts/test-trip-history-513.ts']);
run('TRIP_ACK_TRANSPORT_RECOVERY', ['scripts/test-audit-trip-reliability.mjs']);
run('ADMIN_REJECTION_CLIENT_RETRY', ['run', 'test:admin-rejection-client'], process.platform === 'win32' ? 'npm.cmd' : 'npm');
run('MEMBERSHIP_SECURITY_501_AUTH_EMULATOR', ['run', 'test:membership-security-501'], process.platform === 'win32' ? 'npm.cmd' : 'npm');
run('REAL_PRINT_OCR_RESTART_AND_SERVER_STABILITY', ['run','test:recordtrip-ui-515'], process.platform === 'win32' ? 'npm.cmd' : 'npm');
run('WEB_BUILD', ['run', 'build'], process.platform === 'win32' ? 'npm.cmd' : 'npm');
run('DIST_MANIFEST', ['scripts/create-release-files-515.mjs']);
run('SOURCE_FINAL', ['scripts/verify-source-515.py'], 'python3');
console.log('RELEASE_515_LOCAL_VERIFICATION_PASS');
