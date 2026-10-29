import {spawnSync} from 'node:child_process';
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_STORAGE_EMULATOR_HOST)throw new Error('Emuladores obrigatórios.');
process.env.GCLOUD_PROJECT='demo-nvu-v36-4-staging';
for(const script of ['test-company-description-502-rules.mjs','test-membership-security-501.mjs','test-membership-migration-501.mjs','test-profile-cover-498-rules.mjs','test-trip-security-rules.mjs','test-trip-deletion-legacy.mjs','test-trip-operation-legacy.ts']){
 const result=spawnSync(process.execPath,['--import','./scripts/guard-loopback-network.mjs',...(script.endsWith('.ts')?['--import','tsx']:[]),`scripts/${script}`],{stdio:'inherit',env:process.env});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status||1);
}
