import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {validateGate} from './gate.mjs';import {config,run,isolatedEnv,sourceFingerprint,root} from './common.mjs';
import {loadReleaseAuditBlockers} from './audit-policy.mjs';
const now=Date.now(),fingerprint='current-source';
const valid=()=>({schema:1,profile:'release',status:'PASS',releaseApproved:true,sourceUnchanged:true,sourceFingerprint:fingerprint,finishedAt:new Date(now-1000).toISOString(),steps:config.profiles.release.map(id=>({id,status:'PASS',required:true,exitCode:0,timedOut:false}))});
test('gate accepts a fresh complete release report',()=>assert.equal(validateGate(valid(),fingerprint,now),null));
test('a failure, missing Android, timeout, skipped test or duplicate cannot approve a release',()=>{
 for(const mutate of [r=>r.steps[0].status='FAIL',r=>r.steps.pop(),r=>r.steps[0].timedOut=true,r=>r.steps[0].status='SKIPPED',r=>r.steps[0].id=r.steps[1].id]){const r=valid();mutate(r);assert(validateGate(r,fingerprint,now));}
});
test('partial profile and forged top-level approval are rejected',()=>{const r=valid();r.profile='web';assert(validateGate(r,fingerprint,now));r.profile='release';r.status='BLOCKED';assert(validateGate(r,fingerprint,now));});
test('a changed source, old or future report is rejected',()=>{assert(validateGate(valid(),'different',now));for(const offset of [-25*3600000,3600000]){const r=valid();r.finishedAt=new Date(now+offset).toISOString();assert(validateGate(r,fingerprint,now));}});
test('process failures and timeouts propagate',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nvu-qa-self-'));const bad=await run(process.execPath,['-e','process.exit(7)'],{log:path.join(dir,'bad.log')});assert.equal(bad.code,7);const timeout=await run(process.execPath,['-e','setInterval(()=>{},1000)'],{log:path.join(dir,'timeout.log'),timeoutMs:80});assert.equal(timeout.timedOut,true);assert.notEqual(timeout.code,0);});
test('test children receive no production credential or release signing variables',()=>{const env=isolatedEnv({FIREBASE_TOKEN:'private',GOOGLE_APPLICATION_CREDENTIALS:'/private',RELEASE_STORE_PASSWORD:'private',HTTPS_PROXY:'private',GCLOUD_PROJECT:'production'});assert.equal(env.GCLOUD_PROJECT,config.projectId);for(const k of ['FIREBASE_TOKEN','GOOGLE_APPLICATION_CREDENTIALS','RELEASE_STORE_PASSWORD','HTTPS_PROXY'])assert.equal(env[k],undefined);});
test('a known P1 blocks even an otherwise complete release report',()=>{
 const blockers=[{id:'SEC-01',severity:'P1',status:'open',title:'Known issue'}];
 assert.equal(validateGate(valid(),fingerprint,now,blockers),'QA_CRITICAL_AUDIT_OPEN');
});
test('moderate issues do not block, while resolved issues require evidence',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nvu-audit-policy-'));const file=path.join(dir,'policy.json');
 try {
  const issue={id:'QA-01',severity:'P2',status:'open',title:'Moderate issue'};
  const write=issues=>fs.writeFileSync(file,JSON.stringify({schema:1,issues}));
  write([issue]);assert.deepEqual(loadReleaseAuditBlockers(file),[]);
  write([{...issue,severity:'P1'}]);assert.equal(loadReleaseAuditBlockers(file).length,1);
  write([{...issue,severity:'P1',status:'resolved'}]);assert.throws(()=>loadReleaseAuditBlockers(file),/QA_AUDIT_POLICY_INVALID/);
  write([{...issue,severity:'P1',status:'resolved',evidence:['qa/tests/notifications.mjs']}]);assert.deepEqual(loadReleaseAuditBlockers(file),[]);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('a missing, malformed or invalid configured audit policy fails closed',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nvu-invalid-policy-'));const file=path.join(dir,'policy.json');
 try {
  assert.throws(()=>loadReleaseAuditBlockers(file),/QA_AUDIT_POLICY_INVALID/);
  for(const value of ['{',JSON.stringify({schema:2,issues:[]}),JSON.stringify({schema:1,issues:[{id:'SEC-01',severity:'P1',status:'unknown',title:'Invalid'}]}),JSON.stringify({schema:1,issues:[{id:'SEC-01',severity:'P1',status:'open',title:'Duplicate'},{id:'SEC-01',severity:'P1',status:'open',title:'Duplicate'}]})]){
   fs.writeFileSync(file,value);assert.throws(()=>loadReleaseAuditBlockers(file),/QA_AUDIT_POLICY_INVALID/);
  }
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('fingerprint covers root build inputs, backend configuration and migrations without touching live source', () => {
 const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-fingerprint-fixture-'));
 try {
  const names = ['index.html','functions/tsconfig.json','functions/scripts/backfill-public-users.cjs'];
  for (const name of names) { const file=path.join(fixtureRoot,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture'); }
  const before = sourceFingerprint(fixtureRoot);
  for (const name of names) {
   const file=path.join(fixtureRoot,name), original=fs.readFileSync(file);
   try { fs.appendFileSync(file,'\n'); assert.notEqual(sourceFingerprint(fixtureRoot),before,name); }
   finally { fs.writeFileSync(file,original); }
  }
  assert.equal(sourceFingerprint(fixtureRoot),before);
 } finally { fs.rmSync(fixtureRoot,{recursive:true,force:true}); }
});
