import {spawnSync} from 'node:child_process';
const projectId='demo-nvu-v36-4-staging';
const env={...process.env,GCLOUD_PROJECT:projectId,FIREBASE_CLI_DISABLE_TELEMETRY:'1'};
for(const key of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy'])delete env[key];
// One emulator owner, serial children: each suite may clear the same demo DB.
const result=spawnSync(process.execPath,['--import','./scripts/guard-loopback-network.mjs','node_modules/firebase-tools/lib/bin/firebase.js',
 'emulators:exec','--config','firebase.release-505.json','--only','firestore,storage,auth','--project',projectId,
 'node --import ./scripts/guard-loopback-network.mjs scripts/test-audit-emulator-suite-505.mjs'],{stdio:'inherit',env,timeout:720_000});
if(result.error)throw result.error;
process.exit(result.status??1);
