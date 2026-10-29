import fs from 'node:fs';
import path from 'node:path';
import {root,run} from './common.mjs';
const directory=path.join(root,'qa/results/legacy');fs.mkdirSync(directory,{recursive:true});
for(const [name,args] of [['storage',['--import','tsx','scripts/test-offline-database-storage.mjs']],['fluency',['scripts/test-fluency-476.mjs']]]){
 const log=path.join(directory,name+'.log');const result=await run(process.execPath,args,{log,timeoutMs:35000});
 if(result.code!==0||result.timedOut){console.error(fs.readFileSync(log,'utf8'));process.exit(1);}
 console.log('PASS',name);
}
