import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
assert.equal(process.env.GCLOUD_PROJECT,'demo-nvu-v36-4-staging');
for(const name of ['FIRESTORE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])assert.match(process.env[name]||'',/^127\.0\.0\.1:\d+$/);
const suites=['test-audit-trip-server.mjs','test-operational-commands-emulator.mjs','test-operational-queues-emulator.mjs',
 'test-trip-submission-audit.ts','test-trip-stability.ts','test-security-502-emulators.mjs'];
fs.mkdirSync('reports/audit-504-logs',{recursive:true});
const report={release:'1.0.504',projectId:process.env.GCLOUD_PROJECT,productionAccess:false,steps:[]};
for(const script of suites){
 const log=`reports/audit-504-logs/${script}.log`,fd=fs.openSync(log,'w');
 const env={...process.env,NVU_TEST_OUTPUT:`reports/${script}.json`};
 const args=['--import','./scripts/guard-loopback-network.mjs',...(script.endsWith('.ts')?['--import','tsx']:[]),`scripts/${script}`];
 const result=spawnSync(process.execPath,args,{stdio:['ignore',fd,fd],env,timeout:180_000});fs.closeSync(fd);
 report.steps.push({script,exitCode:result.status??1,error:result.error?.message,log});
 fs.writeFileSync('reports/audit-emulator-suite-504.json',JSON.stringify(report,null,2)+'\n');
 if(result.error||result.status!==0){console.error(fs.readFileSync(log,'utf8').slice(-12000));process.exit(result.status||1);}
 console.log('PASS',script);
}
console.log('AUDIT_EMULATOR_SUITE_504_PASS',report.steps.length);
