import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {normalizeCompanyDescription, canManageCompanyProfile} from '../src/lib/companyProfileDescription.ts';
import {publicCompanyIdentity} from '../src/lib/publicCompanyIdentity.ts';
import {companyDescriptionKey, putCompanyDescription, readCompanyDescription, pendingCompanyDescriptions, createCompanyDescriptionSync} from '../src/services/companyDescriptionStore.ts';

const values = new Map<string, string>();
let quota = false;
Object.defineProperty(globalThis, 'localStorage', {configurable:true, value:{getItem:(key:string)=>values.get(key)??null,
  setItem:(key:string,value:string)=>{if(quota)throw new Error('QuotaExceededError');values.set(key,value);},
  get length(){return values.size;},key:(index:number)=>[...values.keys()][index]??null}});
Object.defineProperty(globalThis, 'window', {configurable:true,value:new EventTarget()});
const locks = new Map<string,Promise<unknown>>();
Object.defineProperty(globalThis, 'navigator', {configurable:true,value:{locks:{request:(name:string,run:()=>unknown)=>{
  const task=(locks.get(name)??Promise.resolve()).catch(()=>undefined).then(run);
  locks.set(name,task);return task.finally(()=>{if(locks.get(name)===task)locks.delete(name);});
}}}});
const results:string[]=[];
const check=async(name:string,run:()=>unknown)=>{values.clear();quota=false;await run();results.push(name);console.log('PASS',name);};
const row=(revision='v1',text='Cargas e logística',companyId='dc',viewerId='admin')=>({revision,text,companyId,viewerId,status:'pending' as const});
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
await check('Texto público normalizado e limitado a 160 caracteres Unicode',()=>{
  assert.equal(normalizeCompanyDescription('  Cargas\n\t e\0 logística  '),'Cargas e logística');
  assert.equal(Array.from(normalizeCompanyDescription('🚚'.repeat(170))).length,160);
  assert.equal(normalizeCompanyDescription({text:'não é texto'}),'');
  const long=normalizeCompanyDescription(' x '.repeat(200));assert.equal(normalizeCompanyDescription(long),long);
});
await check('Edição restrita ao proprietário, administrador ativo ou empresa selecionada pelo sênior',()=>{
  assert(canManageCompanyProfile('owner',{id:'dc',ownerId:'owner'},[]));
  assert(canManageCompanyProfile('admin',{id:'dc'},[{companyId:'dc',userId:'admin',status:'active',roles:['admin']}]));
  assert(canManageCompanyProfile('senior',{id:'dc'},[],'dc'));
  for(const status of ['removed','revoked','pending'])assert(!canManageCompanyProfile('admin',{id:'dc'},[{companyId:'dc',userId:'admin',status,roles:['admin']}]));
  assert(!canManageCompanyProfile('driver',{id:'dc'},[{companyId:'dc',userId:'driver',status:'active',roles:['driver']}]));
  assert(!canManageCompanyProfile('admin',{id:'other'},[{companyId:'dc',userId:'admin',status:'active',roles:['admin']}]));
  assert(!canManageCompanyProfile('',{id:'dc'},[],'dc'));
});
await check('Rascunho offline persiste e fica isolado por conta e empresa',async()=>{
  await putCompanyDescription(row());let calls=0;
  const sync=createCompanyDescriptionSync({uid:()=> 'admin',generation:()=>1,online:()=>false,publish:async()=>{calls++;}});
  await sync.drain();assert.equal(calls,0);assert.equal(readCompanyDescription('admin','dc')?.status,'pending');
  assert.equal(readCompanyDescription('other','dc'),null);assert.equal(readCompanyDescription('admin','other'),null);
  assert.equal(JSON.parse(values.get(companyDescriptionKey('admin','dc'))!).text,'Cargas e logística');
});
await check('Só confirma a sincronização depois da confirmação do servidor',async()=>{
  await putCompanyDescription(row());const ack=deferred(),started=deferred();
  const sync=createCompanyDescriptionSync({uid:()=> 'admin',generation:()=>1,online:()=>true,publish:async()=>{started.resolve();await ack.promise;}});
  const task=sync.drain();await started.promise;assert.equal(readCompanyDescription('admin','dc')?.status,'pending');
  ack.resolve();await task;assert.equal(readCompanyDescription('admin','dc')?.status,'synced');
});
await check('Confirmação antiga não apaga edição mais recente',async()=>{
  await putCompanyDescription(row());const ack=deferred(),started=deferred(),published:string[]=[];
  const sync=createCompanyDescriptionSync({uid:()=> 'admin',generation:()=>1,online:()=>true,publish:async record=>{published.push(record.revision);if(record.revision==='v1'){started.resolve();await ack.promise;}}});
  const task=sync.drain();await started.promise;await putCompanyDescription(row('v2','Nova descrição'));ack.resolve();await task;
  assert.deepEqual(published,['v1','v2']);assert.equal(readCompanyDescription('admin','dc')?.revision,'v2');assert.equal(readCompanyDescription('admin','dc')?.status,'synced');
});
await check('Troca de sessão não confirma nem publica rascunhos de outra conta',async()=>{
  await putCompanyDescription(row());const ack=deferred(),started=deferred();let uid='admin',generation=1,calls=0;
  const sync=createCompanyDescriptionSync({uid:()=>uid,generation:()=>generation,online:()=>true,publish:async()=>{calls++;started.resolve();await ack.promise;}});
  const task=sync.drain();await started.promise;uid='other';generation++;ack.resolve();await task;await sync.drain();
  assert.equal(calls,1);assert.equal(readCompanyDescription('admin','dc')?.status,'pending');
});
await check('Permissão recusada preserva texto sem repetição automática e permite nova tentativa',async()=>{
  await putCompanyDescription(row());let deny=true,calls=0;
  const sync=createCompanyDescriptionSync({uid:()=> 'admin',generation:()=>1,online:()=>true,publish:async()=>{calls++;if(deny)throw new Error('permission-denied');}});
  await sync.drain();assert.equal(calls,1);assert.equal(readCompanyDescription('admin','dc')?.status,'pending');assert.equal(readCompanyDescription('admin','dc')?.failed,true);
  deny=false;await sync.drain();assert.equal(calls,2);assert.equal(readCompanyDescription('admin','dc')?.status,'synced');
});
await check('Armazenamento indisponível não produz confirmação falsa de salvamento',async()=>{
  quota=true;await assert.rejects(putCompanyDescription(row()),/Não foi possível salvar/);assert.equal(readCompanyDescription('admin','dc'),null);
});
await check('Registro corrompido não bloqueia outras empresas nem mistura contas',async()=>{
  values.set(companyDescriptionKey('admin','bad'),'broken');await putCompanyDescription(row());await putCompanyDescription(row('x','Outra empresa','second'));await putCompanyDescription(row('y','Outro usuário','dc','other'));
  assert.deepEqual(pendingCompanyDescriptions('admin').map(r=>r.companyId).sort(),['dc','second']);
});
await check('Duas abas serializam publicações e mantêm a edição mais recente',async()=>{
  await putCompanyDescription(row());const ack=deferred(),started=deferred(),published:string[]=[];
  const deps={uid:()=> 'admin',generation:()=>1,online:()=>true,publish:async(record:any)=>{published.push(record.revision);if(record.revision==='v1'){started.resolve();await ack.promise;}}};
  const first=createCompanyDescriptionSync(deps),second=createCompanyDescriptionSync(deps);
  const task1=first.drain();await started.promise;await putCompanyDescription(row('v2','Mais recente'));const task2=second.drain();ack.resolve();await Promise.all([task1,task2]);
  assert.deepEqual(published,['v1','v2']);assert.equal(readCompanyDescription('admin','dc')?.text,'Mais recente');assert.equal(readCompanyDescription('admin','dc')?.status,'synced');
});
await check('Projeções pública cliente e servidor expõem só a descrição sanitizada',()=>{
  const require=createRequire(import.meta.url),{publicCompanyData}=require('../functions/lib/companyAccess.js');
  const input={id:'dc',companyName:'DC Transportes',profileDescription:' x '.repeat(200),profileDescriptionRevision:42,email:'private@example.test',cnpj:'private',ownerId:'private'};
  for(const publicData of [publicCompanyIdentity(input),publicCompanyData(input)]){
    assert.equal(publicData.profileDescription,normalizeCompanyDescription(input.profileDescription));
    assert(!('profileDescriptionRevision' in publicData));for(const key of ['email','cnpj','ownerId'])assert(!(key in publicData));
  }
});
fs.mkdirSync('reports',{recursive:true});fs.writeFileSync('reports/company-description-502-tests.json',JSON.stringify({pass:true,checks:results.length,results,productionAccess:false},null,2)+'\n');
console.log('COMPANY_DESCRIPTION_502_PASS',results.length);
