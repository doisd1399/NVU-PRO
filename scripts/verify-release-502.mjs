import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const steps=[
 ['TypeScript Web',['node_modules/typescript/bin/tsc','--noEmit']],
 ['TypeScript Functions',['functions/node_modules/typescript/bin/tsc','-p','functions/tsconfig.json']],
 ...['test-receipt-reliability-501.mjs','test-ranking-reliability-501.mjs','test-gto-print-upload-hf1.mjs','test-ranking-cold-start-contract.mjs','test-ranking-android-first-paint.mjs','test-public-profile-senior-authorization.mjs','test-senior-company-resolution.mjs','test-senior-administration-contract.mjs','test-profile-ranking-sources.mjs','test-native-ota-immutable.mjs','test-profile-identity-single-source.mjs'].map(name=>[name,[`scripts/${name}`]]),
 ...['test-company-description-502.mts','test-profile-ranking.ts','test-profile-cover-498.mts','test-pro-rejection-recovery.mts','test-pro-pending-presentation.mts','test-trip-consistency-regressions.ts','test-currency-and-history-contract.ts','test-offline-database-storage.mjs','test-offline-sync-job-order.mjs'].map(name=>[name,['--import','tsx',`scripts/${name}`]]),
 ['GTO Pro backend',['functions/scripts/test-register-gto-pro-receipt.cjs']],
 ['Firestore e Storage: regras, handlers e migração',['scripts/run-security-502-emulators.mjs']],
];
const report={release:'1.0.502',productionAccess:false,steps:[],status:'RUNNING'};
fs.mkdirSync('reports',{recursive:true});
const save=()=>fs.writeFileSync('reports/release-502-verification.json',JSON.stringify(report,null,2)+'\n');
function run(name,args,command=process.execPath,env=process.env){
 console.log(`\nVALIDATE ${name}`);const result=spawnSync(command,args,{stdio:'inherit',env});
 report.steps.push({name,exitCode:result.status??1});save();
 if(result.error||result.status!==0){report.status='FAIL';save();if(result.error)console.error(result.error.message);process.exit(result.status||1);}
}
for(const [name,args] of steps)run(name,args);
run('Build Web',['run','build'],process.platform==='win32'?'npm.cmd':'npm');
if(process.env.NVU_RELEASE_UI==='true'){
 run('Interface aprovada do perfil',['scripts/test-profile-cover-498-ui.mjs'],process.execPath,{...process.env,NVU_PROFILE_502_UI:'true'});
 run('Dock compacta e faixa opaca',['scripts/test-dock-497-ui.mjs'],process.execPath,{...process.env,NVU_DOCK_502_UI:'true'});
 run('Interface do ranking de perfil',['scripts/test-profile-ranking-ui.mjs']);
}
report.status='PASS';report.uiExecuted=process.env.NVU_RELEASE_UI==='true';save();console.log(`RELEASE_502_VERIFICATION_PASS ${report.steps.length}`);
