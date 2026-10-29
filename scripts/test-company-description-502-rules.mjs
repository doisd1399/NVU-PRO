import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,updateDoc} from 'firebase/firestore';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8085');
const projectId='demo-nvu-v36-4-staging';
const require=createRequire(new URL('../functions/package.json',import.meta.url)),admin=require(path.resolve('functions/lib/firebaseAdmin.js'));
admin.initializeApp({projectId});const db=admin.firestore();
const {refreshCompanyAccess,syncCompanyPublicProfile}=require('../functions/lib/companyAccess');
const env=await initializeTestEnvironment({projectId,firestore:{rules:await fs.readFile('firestore.rules','utf8')}});
const checks=[];const check=async(name,run)=>{await run();checks.push(name);console.log('PASS',name);};
const companyId='description502';
try {
 await env.clearFirestore();
 await db.doc(`frotas/${companyId}`).set({companyName:'Empresa 502',ownerId:'owner502',userId:'owner502',status:'active',simulatorId:'gto',email:'private@example.test'});
 for(const [uid,roles,status] of [['owner502',['owner','admin'],'active'],['manager502',['admin'],'active'],['driver502',['driver'],'active'],['removed502',['admin'],'removed'],['outside502',['admin'],'active']]){
  await db.doc(`users/${uid}`).set({name:uid,status:'active',role:roles.includes('admin')?'admin':'driver'});
  const target=uid==='outside502'?'another502':companyId;
  await db.doc(`companyMembers/${uid}_${target}`).set({userId:uid,companyId:target,roles,status});await refreshCompanyAccess(db,uid,target);
 }
 // Senior claims require an existing, usable account, as do production logins.
 await db.doc('users/senior502').set({name:'Senior QA',status:'active',accountStatus:'active'});
 const ref=(uid,claims={})=>doc(env.authenticatedContext(uid,claims).firestore(),`frotas/${companyId}`);
 await check('Proprietário salva a descrição da própria empresa',()=>assertSucceeds(updateDoc(ref('owner502'),{profileDescription:'Cargas com responsabilidade.',profileDescriptionRevision:'owner-revision'})));
 await check('Administrador ativo salva sem alterar propriedade ou autorização',()=>assertSucceeds(updateDoc(ref('manager502'),{profileDescription:'Nova descrição pública.',profileDescriptionRevision:'manager-revision'})));
 for(const uid of ['driver502','removed502','outside502'])await check(`Descrição recusada para ${uid}`,()=>assertFails(updateDoc(ref(uid),{profileDescription:'Não autorizado'})));
 await check('Claim admin sozinho não autoriza edição de outra empresa',()=>assertFails(updateDoc(ref('outside502',{role:'admin'}),{profileDescription:'Não autorizado'})));
 await check('Sênior verificado mantém a edição administrativa',()=>assertSucceeds(updateDoc(ref('senior502',{senior:true}),{profileDescription:'Descrição do sênior.',profileDescriptionRevision:'senior-revision'})));
 await check('Projeção e leitura públicas preservam texto sem expor dados privados',async()=>{
  const before=await db.doc(`frotas/${companyId}`).get();await before.ref.update({profileDescription:'Descrição mais recente.',profileDescriptionRevision:'latest'});
  await syncCompanyPublicProfile.run({before,after:before},{params:{companyId}});
  const snapshot=await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(),`public_companies/${companyId}`)));
  assert.equal(snapshot.get('profileDescription'),'Descrição mais recente.');assert.equal(snapshot.get('profileDescriptionRevision'),'latest');
  assert.equal(snapshot.get('email'),undefined);assert.equal(snapshot.get('ownerId'),undefined);
 });
 await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/company-description-502-rules.json',JSON.stringify({pass:true,checks,emulatorsOnly:true,productionAccess:false},null,2)+'\n');
 console.log('COMPANY_DESCRIPTION_502_RULES_PASS',checks.length);
} finally {await env.cleanup();await Promise.all(admin.apps.map(app=>app.delete()));}
