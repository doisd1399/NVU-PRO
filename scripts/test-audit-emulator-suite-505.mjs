import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
assert.equal(process.env.GCLOUD_PROJECT,'demo-nvu-v36-4-staging');
for(const name of ['FIRESTORE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])assert.match(process.env[name]||'',/^127\.0\.0\.1:\d+$/);
const suites=['test-audit-trip-server.mjs','test-operational-commands-emulator.mjs','test-operational-queues-emulator.mjs',
 'test-trip-submission-audit.ts','test-trip-stability.ts','test-security-502-emulators.mjs','test-admin-recovery-emulator-505.cjs','test-coordination-rules-505.mjs'];
fs.mkdirSync('reports/release-505/emulator-logs',{recursive:true});
const report={release:'1.0.505',projectId:process.env.GCLOUD_PROJECT,productionAccess:false,steps:[]};
for(const script of suites){
 const log=`reports/release-505/emulator-logs/${script}.log`,fd=fs.openSync(log,'w');
 const env={...process.env,NVU_TEST_OUTPUT:`reports/${script}.json`};
 const args=['--import','./scripts/guard-loopback-network.mjs',...(script.endsWith('.ts')?['--import','tsx']:[]),`scripts/${script}`];
 const result=spawnSync(process.execPath,args,{stdio:['ignore',fd,fd],env,timeout:240_000});fs.closeSync(fd);
 report.steps.push({script,exitCode:result.status??1,signal:result.signal,error:result.error?.message,log});
 fs.writeFileSync('reports/release-505/emulator-suite.json',JSON.stringify(report,null,2)+'\n');
 if(result.error||result.status!==0){console.error(fs.readFileSync(log,'utf8').slice(-12000));process.exit(result.status||1);}
 console.log('PASS',script);
}
console.log('AUDIT_EMULATOR_SUITE_505_PASS',report.steps.length);
