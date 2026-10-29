import {spawnSync} from 'node:child_process';
if(process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8085'||process.env.FIREBASE_STORAGE_EMULATOR_HOST!=='127.0.0.1:9199')throw new Error('Auth, Firestore e Storage Emulator locais obrigatórios.');
process.env.GCLOUD_PROJECT='demo-nvu-v36-4-staging';
for(const script of ['test-fleet-http-515.mjs','test-senior-access-511.mjs','test-senior-rules-511.mjs','test-membership-security-501.mjs','test-membership-migration-501.mjs','test-profile-cover-498-rules.mjs','test-trip-security-rules.mjs','test-trip-deletion-legacy.mjs','test-trip-operation-legacy.ts']){
 const result=spawnSync(process.execPath,['--import','./scripts/guard-loopback-network.mjs',...(script.endsWith('.ts')?['--import','tsx']:[]),`scripts/${script}`],{stdio:'inherit',env:process.env});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status||1);
}
