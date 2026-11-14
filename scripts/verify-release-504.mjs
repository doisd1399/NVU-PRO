import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const report={release:'1.0.504',productionAccess:false,steps:[],status:'RUNNING'};
fs.mkdirSync('reports/audit-504-logs',{recursive:true});
const save=()=>fs.writeFileSync('reports/release-504-verification.json',JSON.stringify(report,null,2)+'\n');
function run(name,args,command=process.execPath,extraEnv={}){
 const log=`reports/audit-504-logs/${String(report.steps.length+1).padStart(2,'0')}.log`,fd=fs.openSync(log,'w');
 console.log('VALIDATE',name);
 const result=spawnSync(command,args,{stdio:['ignore',fd,fd],env:{...process.env,...extraEnv},timeout:600_000});fs.closeSync(fd);
 report.steps.push({name,exitCode:result.status??1,error:result.error?.message,log});save();
 if(result.error||result.status!==0){report.status='FAIL';save();console.error(fs.readFileSync(log,'utf8').slice(-14000));process.exit(result.status||1);}
 console.log('PASS',name);
}
run('Source provenance',['scripts/verify-source-504.py'],'python3');
run('Web TypeScript',['node_modules/typescript/bin/tsc','--noEmit']);
run('Functions TypeScript',['functions/node_modules/typescript/bin/tsc','-p','functions/tsconfig.json']);
for(const file of ['test-audit-trip-reliability.mjs','test-receipt-reliability-501.mjs','test-ranking-reliability-501.mjs',
 'test-offline-pages-503.mjs','test-news-context-and-money.mjs','test-news-publication-time.mjs',
 'test-native-ota-immutable.mjs','test-public-profile-senior-authorization.mjs','test-senior-company-resolution.mjs',
 'test-profile-identity-single-source.mjs','test-unified-profile-menu.mjs','test-profile-menu-navigation-root-cause.mjs'])run(file,[`scripts/${file}`]);
for(const file of ['test-audit-completion-modal.mts','test-durable-operation-outbox.mts','test-operational-command-client.ts',
 'test-operational-queue-client.ts','test-trip-queue-recovery.ts','test-offline-database-storage.mjs','test-offline-sync-job-order.mjs',
 'test-pro-rejection-recovery.mts','test-operation-completion-native-cleanup.mts','test-pro-pending-presentation.mts',
 'test-company-description-502.mts','test-profile-cover-498.mts','test-currency-and-history-contract.ts'])run(file,['--import','tsx',`scripts/${file}`]);
run('Real handlers, security rules, migration and operational queues',['scripts/run-audit-emulators-504.mjs']);
run('Web build',['run','build'],process.platform==='win32'?'npm.cmd':'npm');
if(process.env.NVU_RELEASE_UI==='true'){
 run('Ranking controls',['scripts/test-ranking-approved-visual.mjs']);
 run('Menu and goal UI',['scripts/test-workspace-menu-503-ui.mjs']);
 run('Profile UI',['scripts/test-profile-cover-498-ui.mjs'],process.execPath,{NVU_PROFILE_502_UI:'true'});
 run('Dock UI',['scripts/test-dock-497-ui.mjs'],process.execPath,{NVU_DOCK_502_UI:'true'});
 run('Profile ranking UI',['scripts/test-profile-ranking-ui.mjs']);
}
run('Source remains identical after build/tests',['scripts/verify-source-504.py'],'python3');
report.status='PASS';report.uiExecuted=process.env.NVU_RELEASE_UI==='true';save();console.log('RELEASE_504_VERIFICATION_PASS',report.steps.length);
