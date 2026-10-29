import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,getDoc} from 'firebase/firestore';
assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^127\.0\.0\.1:/);
const environment=await initializeTestEnvironment({projectId:'demo-nvu-v36-4-staging',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
const checks=[];const pass=s=>{checks.push(s);console.log('PASS',s)};
try {
 await environment.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();for(const uid of ['coord-driver505','coord-senior505'])await setDoc(doc(db,'users',uid),{status:'active',accountStatus:'active',name:uid});
  await setDoc(doc(db,'frotas','coord-fleet505'),{ownerId:'coord-driver505',userId:'coord-driver505',status:'deleted',deleted:true});
  await setDoc(doc(db,'company_access/coord-fleet505/members/coord-driver505'),{userId:'coord-driver505',companyId:'coord-fleet505',status:'active',roles:['owner','admin','driver']});
 });
 const driver=environment.authenticatedContext('coord-driver505').firestore();
 const senior=environment.authenticatedContext('coord-senior505',{senior:true}).firestore();
 await assertFails(updateDoc(doc(driver,'users','coord-driver505'),{pendingAccountCommand:'forged-command'}));pass('Owner cannot forge the server account-command pointer');
 await assertFails(updateDoc(doc(senior,'users','coord-driver505'),{accountActionState:'COMPLETED'}));pass('Senior client cannot forge command completion');
 const newcomer=environment.authenticatedContext('coord-new505').firestore();
 await assertFails(setDoc(doc(newcomer,'users','coord-new505'),{name:'New',accountStatus:'active',pendingAccountCommand:'forged'}));pass('Account creation cannot inject server coordination state');
 await assertFails(setDoc(doc(senior,'senior_account_commands','forged'),{state:'COMPLETED'}));pass('Administrative commands are writable only through trusted server execution');
 await assertFails(updateDoc(doc(driver,'frotas','coord-fleet505'),{deleted:false,status:'active'}));pass('Archived company cannot be revived by its previous owner through a direct write');
 await assertSucceeds(updateDoc(doc(driver,'users','coord-driver505'),{name:'Updated display name'}));pass('Ordinary profile changes still work');
 assert.equal((await getDoc(doc(driver,'users','coord-driver505'))).data().name,'Updated display name');
 fs.mkdirSync('reports/release-505',{recursive:true});fs.writeFileSync('reports/release-505/coordination-rules.json',JSON.stringify({productionAccess:false,firestore:'real emulator',checks:checks.length,passed:checks},null,2));
 console.log('COORDINATION_RULES_505_PASS',checks.length);
}finally{await environment.cleanup();}
