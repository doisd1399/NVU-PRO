import fs from 'node:fs';
import path from 'node:path';
import { root, config, isolatedEnv, run, atomicJson } from './common.mjs';
for(const [key,value] of Object.entries({GCLOUD_PROJECT:config.projectId,FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8085',FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9199'}))if(process.env[key]!==value)throw Error('QA_EMULATOR_SCOPE_INVALID:'+key);
const dir=path.join(root,'qa/results/emulators');
const steps=[['security','qa/tests/security.mts'],['lifecycle','qa/tests/lifecycle.mts'],['push-backend','qa/tests/push-backend.mts'],['goals-ranking','scripts/test-financial-goals-506-emulator.cjs'],['print-ui','qa/tests/print-ui.mts'],['app-shell','qa/tests/app-shell.mts']];
const results=[];
for(const [id,file] of steps){
  const env={...isolatedEnv(),FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8085',FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9199'};
  const r=await run(process.execPath,['--import','./scripts/guard-loopback-network.mjs','--import','tsx',file],{env,log:path.join(dir,id+'.log'),timeoutMs:180000});
  results.push({id,...r});atomicJson(path.join(dir,'result.json'),{projectId:config.projectId,steps:results});
  if(r.code!==0||r.timedOut){console.error(fs.readFileSync(path.join(dir,id+'.log'),'utf8').slice(-12000));process.exit(1);}
  console.log('PASS',id);
}
