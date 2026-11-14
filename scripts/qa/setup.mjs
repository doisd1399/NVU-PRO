import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import crypto from 'node:crypto';import {root} from './common.mjs';
const call=(cmd,args)=>{const r=spawnSync(cmd,args,{cwd:root,stdio:'inherit',env:process.env});if(r.error||r.status!==0)throw Error(r.error?.message||'Setup failed: '+cmd);};
const java=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin','java'+(process.platform==='win32'?'.exe':'')):'java';
const version=spawnSync(java,['-version'],{encoding:'utf8'});const major=Number((version.stderr+version.stdout).match(/version "(\d+)/)?.[1]);if(major<21||version.error)throw Error('Instale JDK 21 e configure JAVA_HOME antes do setup.');
// Build tracked compressed OCR data and npm workers before QA fingerprints public/.
call(process.execPath,['scripts/prepare-tesseract-assets.mjs']);
call(process.execPath,['scripts/prepare-photo-assets.mjs']);
call(process.execPath,['node_modules/firebase-tools/lib/bin/firebase.js','setup:emulators:firestore']);
call(process.execPath,['node_modules/firebase-tools/lib/bin/firebase.js','setup:emulators:storage']);
if(!process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)call(process.execPath,['node_modules/playwright/cli.js','install','chromium']);
fs.mkdirSync(path.join(root,'.qa-cache'),{recursive:true});
const jars=[['junit/junit/4.13.2/junit-4.13.2.jar','8e495b634469d64fb8acfa3495a065cbacc8a0fff55ce1e31007be4c16dc57d3'],['org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.jar','66fdef91e9739348df7a096aa384a5685f4e875584cce89386a7a47251c4d8e9']];
for(const [url,hash]of jars){const p=path.join(root,'.qa-cache',path.basename(url));if(!fs.existsSync(p))call('curl',['--fail','--location','--silent','--show-error','--retry','2','https://repo.maven.apache.org/maven2/'+url,'--output',p]);if(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==hash)throw Error('Checksum inválido: '+p);}
console.log('QA_SETUP_PASS');
