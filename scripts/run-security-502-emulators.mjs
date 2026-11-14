import {spawnSync} from 'node:child_process';
const env={...process.env,FIREBASE_CLI_DISABLE_TELEMETRY:'1'};
for(const key of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy'])delete env[key];
const result=spawnSync(process.execPath,['--import','./scripts/guard-loopback-network.mjs','node_modules/firebase-tools/lib/bin/firebase.js','emulators:exec','--only','auth,firestore,storage','--project','demo-nvu-v36-4-staging','node --import ./scripts/guard-loopback-network.mjs scripts/test-security-502-emulators.mjs'],{stdio:'inherit',env});
if(result.error)throw result.error;
process.exit(result.status??1);
