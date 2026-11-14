import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import crypto from 'node:crypto';
import {root,atomicJson} from './common.mjs';
const jars=[['junit-4.13.2.jar','8e495b634469d64fb8acfa3495a065cbacc8a0fff55ce1e31007be4c16dc57d3'],['hamcrest-core-1.3.jar','66fdef91e9739348df7a096aa384a5685f4e875584cce89386a7a47251c4d8e9']];
for(const [name,sha]of jars){const p=path.join(root,'.qa-cache',name);if(!fs.existsSync(p)||crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==sha){console.error('QA_SETUP_REQUIRED: npm run qa:setup (JUnit)');process.exit(2);}}
const names=['GtoMoneyValueRegressionTest','GtoResultOcrConsensusPolicyTest','PendingTripFailurePolicyTest','ProOverlayAuthorizationPolicyTest','ProReceiptEvidencePolicyTest','ProTripMoneyPresentationTest'];
const dir=path.join(root,'qa/results/native-policies');fs.mkdirSync(dir,{recursive:true});
const cp=jars.map(([name])=>path.join(root,'.qa-cache',name)).join(path.delimiter);
const java=name=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',name+(process.platform==='win32'?'.exe':'')):name;
const compile=spawnSync(java('javac'),['-encoding','UTF-8','-cp',cp,'-sourcepath','android/app/src/main/java','-d',dir,...names.map(n=>'android/app/src/test/java/com/nvu/operacional/'+n+'.java')],{cwd:root,encoding:'utf8'});
if(compile.error||compile.status!==0){console.error(compile.error||compile.stderr);process.exit(compile.error?.code==='ENOENT'?2:1);}
const result=spawnSync(java('java'),['-cp',dir+path.delimiter+cp,'org.junit.runner.JUnitCore',...names.map(n=>'com.nvu.operacional.'+n)],{cwd:root,encoding:'utf8'});
console.log(result.stdout);console.error(result.stderr);
atomicJson(path.join(dir,'result.json'),{exitCode:result.status,classes:names,tests:Number(result.stdout.match(/OK \((\d+) tests?\)/)?.[1]||0),coverage:'Políticas Java independentes de Android. Não equivale a testar o APK. As demais classes rodam no perfil release/Gradle.'});
process.exitCode=result.status===0?0:1;
