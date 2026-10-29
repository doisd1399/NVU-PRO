const fs=require('fs');const path=require('path');const ts=(()=>{try{return require('typescript')}catch{return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')}})();
const root=path.resolve(__dirname,'../..');
const files=['src/lib/vehiclePhotoIdentity.ts','src/hooks/useRankingParticipantVehicle.ts','src/hooks/useVehiclePhoto.ts','src/services/vehiclePhotoStore.ts','src/services/vehiclePhotoService.ts','src/services/vehiclePhotoSync.ts','src/services/sync/FirebaseTripSyncAdapter.ts','src/services/simpleAutomationCompletionService.ts','src/services/pro-universal/proReceiptAdapters.ts','src/services/pro-universal/proUniversalContracts.ts'];
let broken=0;
for(const f of files){const s=fs.readFileSync(path.join(root,f),'utf8');const result=ts.transpileModule(s,{fileName:f,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});const d=result.diagnostics||[];if(d.length) broken++;console.log(d.length?'FAIL':'PASS','parse',f,d.map(x=>ts.flattenDiagnosticMessageText(x.messageText,' ')).join('; '));}
process.exitCode=broken?1:0;
