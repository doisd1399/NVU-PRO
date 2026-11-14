import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {root,isolatedEnv,atomicJson} from './common.mjs';
const dir=path.join(root,'qa/results/android');fs.mkdirSync(dir,{recursive:true});const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT;
const blocked=message=>{atomicJson(path.join(dir,'result.json'),{status:'BLOCKED',reason:message});console.error('QA_ANDROID_UNAVAILABLE: '+message);process.exit(2);};
if(!sdk)blocked('ANDROID_HOME não definido. Use o job Android do workflow ou um computador com Android SDK e AVD.');
const env=isolatedEnv();const adb=path.join(sdk,'platform-tools','adb'+(process.platform==='win32'?'.exe':''));
const devices=spawnSync(adb,['devices'],{encoding:'utf8',env});if(devices.error)blocked('adb indisponível.');const online=devices.stdout.split('\n').filter(s=>/^\S+\s+device$/.test(s.trim())).map(s=>s.split(/\s/)[0]);
const serial=process.env.NVU_QA_ANDROID_SERIAL||online[0];if(!serial||!online.includes(serial))blocked('Nenhum Android/AVD conectado.');if(online.length>1&&!process.env.NVU_QA_ANDROID_SERIAL)blocked('Defina NVU_QA_ANDROID_SERIAL quando houver mais de um dispositivo.');
function call(cmd,args,cwd=root){const r=spawnSync(cmd,args,{cwd,env,encoding:'utf8',timeout:720000,maxBuffer:16*1024*1024});if(r.error||r.status!==0)throw Error(r.error?.message||r.stderr||r.stdout);return r.stdout;}
call(process.execPath,['node_modules/@capacitor/cli/bin/capacitor','sync','android']);
call(process.execPath,['scripts/prepare-capacitor-assets.mjs']);
const gradle=process.platform==='win32'?'gradlew.bat':'bash';const args=process.platform==='win32'?[]:['./gradlew'];
const build=call(gradle,[...args,':app:testQaUnitTest',':app:assembleQa',':app:assembleQaAndroidTest','--no-daemon','--console=plain'],path.join(root,'android'));fs.writeFileSync(path.join(dir,'gradle.log'),build);
const pkg='com.nvu.operacional.qa';
// Explicit filenames and package guard make it impossible to clear the installed release app.
const app=path.join(root,'android/app/build/outputs/apk/qa/app-qa.apk');const test=path.join(root,'android/app/build/outputs/apk/androidTest/qa/app-qa-androidTest.apk');
call(adb,['-s',serial,'install','-r',app]);call(adb,['-s',serial,'install','-r',test]);call(adb,['-s',serial,'shell','pm','clear',pkg]);
const cases=[];
for(const name of ['firstBoot','afterProcessRestart']){
 if(name==='afterProcessRestart')call(adb,['-s',serial,'shell','am','force-stop',pkg]);
 const output=call(adb,['-s',serial,'shell','am','instrument','-w','-e','class','com.nvu.operacional.QaOfflineSmokeTest#'+name,pkg+'.test/androidx.test.runner.AndroidJUnitRunner']);
 fs.writeFileSync(path.join(dir,name+'.log'),output);if(!/OK \(1 test\)/.test(output)||/FAILURES!!!|INSTRUMENTATION_FAILED/.test(output))throw Error('Falha instrumental: '+name);cases.push(name);
}
atomicJson(path.join(dir,'result.json'),{status:'PASS',package:pkg,serial,cases,coverage:'APK real em pacote isolado sem permissão INTERNET, render offline e persistência após am force-stop. OAuth e jogo GTO não são declarados testados.'});console.log('QA_ANDROID_PASS',cases.length);
