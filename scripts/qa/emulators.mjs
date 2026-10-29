import fs from 'node:fs';
import path from 'node:path';
import { root, config, isolatedEnv, run } from './common.mjs';
if (!config.projectId.startsWith('demo-')) throw Error('QA_DEMO_PROJECT_REQUIRED');
const dir=path.join(root,'qa/results/emulators');fs.mkdirSync(dir,{recursive:true});
const env=isolatedEnv();
// Jars must be downloaded by qa:setup; runtime receives no cloud credentials
// and all test HTTP/HTTP2 traffic is limited to loopback by the preload guard.
const result=await run(process.execPath,['--import','./scripts/guard-loopback-network.mjs','node_modules/firebase-tools/lib/bin/firebase.js','emulators:exec','--config','firebase.qa.json','--only','auth,firestore,storage','--project',config.projectId,'node --import ./scripts/guard-loopback-network.mjs --import tsx scripts/qa/integration.mts'],{log:path.join(dir,'owner.log'),env,timeoutMs:690000});
console.log(fs.readFileSync(path.join(dir,'owner.log'),'utf8').slice(-18000));
process.exitCode=result.code===0&&!result.timedOut?0:1;
