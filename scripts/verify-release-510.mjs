import { spawnSync } from 'node:child_process';

const run = (name, args, cmd = process.execPath) => {
  console.log('VALIDATE', name);
  const result = spawnSync(cmd, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw Error(`${name}_FAILED`);
};

run('SOURCE_PROVENANCE', ['scripts/verify-source-510.py'], 'python3');
run('FRONTEND_TYPESCRIPT', ['node_modules/typescript/bin/tsc', '--noEmit']);
run('FUNCTIONS_TYPESCRIPT', ['functions/node_modules/typescript/bin/tsc', '-p', 'functions/tsconfig.json']);
run('STATUS_BAR_SCOPE_510', ['scripts/test-nvu-statusbar-controller.mjs']);
run('PROFILE_HEADER_REFERENCE', ['scripts/test-profile-header-reference.mjs']);
run('ADMIN_PROFILE_MENU_REFERENCE', ['scripts/test-admin-profile-menu-reference.mjs']);
run('TRIP_RUNTIME_CONTRACT', ['scripts/test-pro-post-capture-fastpath.mjs']);
run('PRINT_RECOVERY_REGRESSION', ['--import', 'tsx', 'scripts/test-print-recovery-509.ts']);
run('WEB_BUILD', ['run', 'build'], process.platform === 'win32' ? 'npm.cmd' : 'npm');
run('DIST_MANIFEST', ['scripts/create-release-files-510.mjs']);
run('SOURCE_FINAL', ['scripts/verify-source-510.py'], 'python3');
console.log('RELEASE_510_LOCAL_VERIFICATION_PASS');
