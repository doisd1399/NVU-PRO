import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const output=path.resolve('qa-receipt-reliability-501');await fs.mkdir(output,{recursive:true});
const stubs={
 firebase:'export const auth=globalThis.__auth;export const storage={};export const functions={};',
 functions:'export const httpsCallable=()=>async data=>{globalThis.__ensures.push(data);if(globalThis.__mode==="deny")throw Object.assign(new Error("denied"),{code:"functions/permission-denied"});if(globalThis.__mode==="switch")globalThis.__auth.currentUser={uid:"another-user"};return {data:{active:true}};};',
 storage:'export const ref=(_storage,path)=>({path});export const getDownloadURL=async()=>"https://fixture.invalid/receipt.png";export const uploadBytesResumable=(ref,file,metadata)=>{globalThis.__uploads.push({ref,file,metadata});return {snapshot:{ref},cancel(){},on(_event,progress,error,done){if(globalThis.__mode==="storage-deny"){error({code:"storage/unauthorized"});return;}progress({totalBytes:file.size,bytesTransferred:file.size});done();}};};',
 compression:'export default async file=>file;',
};
const plugin={name:'fixture-services',setup(b){
 b.onResolve({filter:/lib\/firebase$/},()=>({path:'firebase',namespace:'fixture'}));
 b.onResolve({filter:/^firebase\/functions$/},()=>({path:'functions',namespace:'fixture'}));
 b.onResolve({filter:/^firebase\/storage$/},()=>({path:'storage',namespace:'fixture'}));
 b.onResolve({filter:/^browser-image-compression$/},()=>({path:'compression',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],loader:'js'}));
}};
globalThis.__auth={authStateReady:async()=>{},currentUser:{uid:'driver'}};globalThis.__ensures=[];globalThis.__uploads=[];globalThis.__mode='normal';
for(const [name,entry] of [['upload','src/services/uploadService.ts'],['store','src/lib/offlineReceiptStore.ts'],['identity','src/lib/publicCompanyIdentity.ts']])await build({entryPoints:[entry],outfile:path.join(output,`${name}.mjs`),bundle:true,format:'esm',platform:'node',packages:'external',plugins:[plugin],logLevel:'silent'});
const {uploadService}=await import(pathToFileURL(path.join(output,'upload.mjs')));
const store=await import(pathToFileURL(path.join(output,'store.mjs')));
const {publicCompanyIdentity}=await import(pathToFileURL(path.join(output,'identity.mjs')));
const file=new File([new Uint8Array([137,80,78,71,1,2,3])],'print.png',{type:'image/png'});
const input={file,companyId:'company',userId:'driver',storageScope:'trip-receipt'};
const checks=[],check=async(name,run)=>{await run();checks.push(name);console.log('PASS',name);};
await check('Upload confirma autorização no servidor antes de enviar ao Storage',async()=>{const result=await uploadService.uploadImage(input);assert.equal(result,'https://fixture.invalid/receipt.png');assert.deepEqual(__ensures,[{companyId:'company'}]);assert.match(__uploads[0].ref.path,/^trip-receipts\/company\/driver\//);});
await check('Recusa de autorização preserva código sem atribuir causa de deploy',async()=>{__mode='deny';const before=__uploads.length;await assert.rejects(uploadService.uploadImage(input),error=>error.code==='storage/unauthorized'&&!error.message.includes('Publique')&&error.message.includes('preservado'));assert.equal(__uploads.length,before);});
await check('Comprovante recusado persiste no IndexedDB com os mesmos bytes',async()=>{const key=await store.persistOfflineReceipt(file,{imageHash:'same-hash',companyId:'company',userId:'driver'});const saved=await store.getOfflineReceipt(key);assert.equal(saved.userId,'driver');assert.deepEqual(new Uint8Array(await saved.blob.arrayBuffer()),new Uint8Array(await file.arrayBuffer()));});
await check('Mesma imagem de outra conta não substitui o arquivo pendente',async()=>{const a=await store.persistOfflineReceipt(file,{imageHash:'same-hash',companyId:'company',userId:'driver'});const b=await store.persistOfflineReceipt(new File(['other'],'other.png',{type:'image/png'}),{imageHash:'same-hash',companyId:'company',userId:'other'});assert.notEqual(a,b);assert.equal((await store.getOfflineReceipt(a)).userId,'driver');assert.equal((await store.getOfflineReceipt(b)).userId,'other');});
await check('Mesma imagem em outra empresa mantém pendências separadas',async()=>{const a=await store.persistOfflineReceipt(file,{imageHash:'same-hash',companyId:'company',userId:'driver'});const b=await store.persistOfflineReceipt(file,{imageHash:'same-hash',companyId:'another-company',userId:'driver'});assert.notEqual(a,b);});
await check('Troca de conta durante autorização impede upload de arquivo da sessão anterior',async()=>{__mode='switch';__auth.currentUser={uid:'driver'};const before=__uploads.length;await assert.rejects(uploadService.uploadImage(input),error=>error.code==='storage/unauthenticated');assert.equal(__uploads.length,before);__auth.currentUser={uid:'driver'};});
await check('Capa pessoal não exige vínculo empresarial',async()=>{__mode='normal';const before=__ensures.length;await uploadService.uploadImage({...input,storageScope:'profile-cover',coverTarget:{scope:'driver',profileId:'driver'}});assert.equal(__ensures.length,before);});
await check('Recusa do Storage continua distinguida de falha de conexão',async()=>{__mode='storage-deny';await assert.rejects(uploadService.uploadImage(input),error=>error.code==='storage/unauthorized'&&!error.message.includes('Publique'));});
await check('Cache público remove contatos e vínculos de propriedade',()=>{const projected=publicCompanyIdentity({id:'company',companyName:'Empresa',profileCoverURL:'https://fixture.invalid/cover',email:'private',ownerEmail:'private',whatsapp:'private',ownerId:'private',userId:'private',recruitmentSettings:{private:true}});assert.deepEqual(Object.keys(projected).sort(),['companyName','id','profileCoverURL']);});
await check('Cache conserva recrutamento público pausado sem campos privados adicionais',()=>{const projected=publicCompanyIdentity({id:'company',simulatorKey:'global-truck',recruitmentSettings:{about:'Texto público',isActive:false,private:true}});assert.equal(projected.simulatorKey,'global-truck');assert.deepEqual(projected.recruitmentSettings,{about:'Texto público',isActive:false});});
await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/receipt-reliability-501-tests.json',JSON.stringify({actualUploadService:true,fixtureTransports:true,realIndexedDBEmulation:true,passed:checks.length,checks},null,2)+'\n');
console.log(`RECEIPT_RELIABILITY_501_PASS ${checks.length}`);
