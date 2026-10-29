import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const manifestHash=()=>createHash('sha256').update(fs.readFileSync('reports/source-manifest-505.json')).digest('hex');
const report={sourceManifestSHA256:manifestHash(),release:'1.0.505',webVersion:'2.3.183',productionAccess:false,signedApkBuilt:false,androidEmulatorExecuted:false,steps:[],status:'RUNNING'};
const root='reports/release-505';fs.mkdirSync(root+'/validation-logs',{recursive:true});
const save=()=>fs.writeFileSync(root+'/verification.json',JSON.stringify(report,null,2)+'\n');
function run(name,args,command=process.execPath){
 const log=`${root}/validation-logs/${String(report.steps.length+1).padStart(2,'0')}.log`,fd=fs.openSync(log,'w');console.log('VALIDATE',name);
 const result=spawnSync(command,args,{stdio:['ignore',fd,fd],env:process.env,timeout:720_000});fs.closeSync(fd);
 report.steps.push({name,exitCode:result.status??1,signal:result.signal,error:result.error?.message,log});save();
 if(result.error||result.status!==0){report.status='FAIL';save();console.error(fs.readFileSync(log,'utf8').slice(-12000));process.exit(result.status||1)}
 console.log('PASS',name);
}
run('Source provenance',['scripts/verify-source-505.py'],'python3');
run('Web TypeScript',['node_modules/typescript/bin/tsc','--noEmit']);
run('Functions TypeScript',['functions/node_modules/typescript/bin/tsc','-p','functions/tsconfig.json']);
for(const file of ['test-trip-recovery-505.ts','test-trip-queue-recovery.ts','test-offline-database-storage.mjs','test-offline-sync-job-order.mjs',
 'test-trip-consistency-regressions.ts','test-canonical-property-fuzz.ts','test-offline-trip-dates.ts','test-pro-rejection-recovery.mts'])run(file,['--import','tsx',`scripts/${file}`]);
run('Administrative failure and recovery',['scripts/test-admin-recovery-505.cjs']);
run('Native OTA isolation',['scripts/test-native-ota-immutable.mjs']);
run('Real browser storage and restart recovery',['scripts/test-trip-browser-505.mjs']);
run('Firestore, Storage, Authentication and security suites',['scripts/run-audit-emulators-505.mjs']);
run('Web build',['run','build'],process.platform==='win32'?'npm.cmd':'npm');
run('Source remains unchanged',['scripts/verify-source-505.py'],'python3');
if (manifestHash() !== report.sourceManifestSHA256) { report.status='FAIL';save();throw new Error('SOURCE_MANIFEST_CHANGED_DURING_VERIFICATION'); }
report.status='PASS';save();console.log('RELEASE_505_VERIFICATION_PASS',report.steps.length);
