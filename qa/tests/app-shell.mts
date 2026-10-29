import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import express from 'express';import {createServer} from 'vite';import react from '@vitejs/plugin-react';import tailwindcss from '@tailwindcss/vite';import {chromium} from 'playwright';
const project='demo-nvu-v36-4-staging';assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8085');
const require=createRequire(path.resolve('functions/package.json')),admin=require(path.resolve('functions/lib/firebaseAdmin.js'));admin.initializeApp({projectId:project,storageBucket:project+'.appspot.com'});const db=admin.firestore();
const owner='qa-shell-owner',company='qa-shell-company';try{await admin.auth().createUser({uid:owner,email:owner+'@example.test',password:'qa-shell-password',displayName:'Gestor QA'});}catch(e:any){if(e.code!=='auth/uid-already-exists')throw e;}
await db.doc('users/'+owner).set({name:'Gestor QA',email:owner+'@example.test',status:'active',role:'admin',roles:['admin','driver'],companyId:company,profileNameSource:'user_edit',memberships:{[company]:{role:'admin',status:'active',simulatorId:'gto'}}});
await db.doc('frotas/'+company).set({companyName:'Empresa QA Shell',ownerId:owner,userId:owner,status:'active',simulatorId:'gto',simulatorName:'GTO',operationalCommandVersion:1});
for(const collection of ['companyMembers','simulator_members'])await db.doc(collection+'/'+owner+'_'+company).set({userId:owner,companyId:company,status:'active',role:'admin',roles:['owner','admin','driver'],simulatorId:'gto'});
await db.doc('public_companies/'+company).set({companyName:'Empresa QA Shell',status:'active',simulatorId:'gto',simulatorName:'GTO'});
await db.doc('company_access/'+company+'/members/'+owner).set({userId:owner,companyId:company,status:'active',roles:['owner','admin','driver']});await db.doc('settings/system').set({workModeAvailability:{version:1}});
await require(path.resolve('functions/lib/userProfiles.js')).refreshPublicUser(db,owner);
const driver='qa-shell-driver';
await db.doc('users/'+driver).set({name:'Motorista QA Cadastro',profileNameSource:'user_edit',profilePhotoSource:'user_edit',email:driver+'@example.test',whatsapp:'11900000001',status:'active',role:'driver',roles:['driver'],companyId:company});
await db.doc('companyMembers/'+driver+'_'+company).set({userId:driver,companyId:company,status:'active',roles:['driver'],simulatorId:'gto'});
await db.doc('company_access/'+company+'/members/'+driver).set({userId:driver,companyId:company,status:'active',roles:['driver']});
await require(path.resolve('functions/lib/userProfiles.js')).refreshPublicUser(db,driver);

const second='qa-shell-company-two';
await db.doc('frotas/'+second).set({companyName:'Empresa QA Dois',ownerId:owner,userId:owner,status:'active',simulatorId:'gto',simulatorName:'GTO',operationalCommandVersion:1});
await db.doc('public_companies/'+second).set({companyName:'Empresa QA Dois',status:'active',simulatorId:'gto',simulatorName:'GTO'});
for(const who of [owner,driver]){
 const roles=who===owner?['admin','driver']:['driver'];
 await db.doc('companyMembers/'+who+'_'+second).set({userId:who,companyId:second,status:'active',roles,simulatorId:'gto'});
 await db.doc('company_access/'+second+'/members/'+who).set({userId:who,companyId:second,status:'active',roles});
}
const api=express();api.use(express.json());const endpoints=require(path.resolve('functions/lib/index.js'));for(const[name,handler]of Object.entries<any>(endpoints))if(typeof handler==='function'&&handler.__trigger?.httpsTrigger)api.all(`/${project}/us-central1/${name}`,handler);
const http:any=await new Promise(resolve=>{const s=api.listen(5001,'127.0.0.1',()=>resolve(s));});
const root=process.cwd(),errors:string[]=[],checks:string[]=[];const server=await createServer({configFile:false,root,envFile:false,define:{'import.meta.env.VITE_USE_FIREBASE_EMULATORS':'"true"','import.meta.env.VITE_FIREBASE_PROJECT_ID':JSON.stringify(project),'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET':JSON.stringify(project+'.appspot.com')},plugins:[react(),tailwindcss()],server:{host:'127.0.0.1',port:4202,strictPort:true,hmr:false}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const context=await browser.newContext({viewport:{width:430,height:932}});await context.addInitScript('globalThis.__name=(target)=>target;');
await context.route('**/*',r=>/^https?:\/\/(127\.0\.0\.1|localhost):(4202|8085|9099|9199|5001)(\/|$)/.test(r.request().url())?r.continue():r.abort());const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:4202/qa/ui/shell.html',{timeout:90000,waitUntil:'domcontentloaded'});await page.getByRole('button',{name:/Administrador/}).waitFor({timeout:45000});checks.push('App completo restaura uma sessão real do Auth local e resolve o seletor de perfis');
 await page.getByRole('button',{name:/Administrador/}).click();await page.waitForURL(/\/admin\/fleet/,{timeout:30000});await page.getByText('Empresa QA Shell',{exact:true}).first().waitFor({timeout:30000});checks.push('Seleção de administrador abre a gestão com os providers reais e a empresa correta');
 await page.getByRole('button',{name:'Equipes',exact:true}).click();
 await page.getByRole('button',{name:'Ações de Motorista QA Cadastro',exact:true}).waitFor({timeout:30000});checks.push('Equipes mostra identidade pública do cadastro com users privado');
 await db.doc('users/'+driver).update({name:'Nome editado QA',profileNameSource:'user_edit'});await require(path.resolve('functions/lib/userProfiles.js')).refreshPublicUser(db,driver);
 await page.getByRole('button',{name:'Ações de Nome editado QA',exact:true}).waitFor({timeout:30000});assert.deepEqual((await db.doc('users/'+driver).get()).get('roles'),['driver']);checks.push('Edição pública do nome aparece em Equipes sem alterar permissões');
 await page.evaluate(({owner,company})=>window.dispatchEvent(new CustomEvent('nvu-push-opened',{detail:{notification:{data:{userId:owner,companyId:company,type:'NEW_OPERATION',targetProfile:'driver'}}}})),{owner,company});
 await page.waitForURL(/\/driver$/,{timeout:30000});checks.push('Toque push seleciona perfil motorista antes de abrir sua operação');
 await page.evaluate(({company})=>window.dispatchEvent(new CustomEvent('nvu-push-opened',{detail:{notification:{data:{userId:'another-account',companyId:company,type:'RH_APPLICATION',targetProfile:'corporate'}}}})),{company});
 await page.waitForTimeout(150);assert.match(page.url(),/\/driver$/);checks.push('Push antigo de outra conta não navega nem troca o perfil');
 await page.evaluate(({owner,company})=>window.dispatchEvent(new CustomEvent('nvu-notification-open',{detail:{userId:owner,companyId:company,type:'RH_APPLICATION',targetProfile:'corporate'}})),{owner,company});
 await page.waitForURL(/\/admin\/fleet/,{timeout:30000});checks.push('Aviso interno seleciona perfil administrador antes de abrir a gestão');
 await page.evaluate(({owner,second})=>window.dispatchEvent(new CustomEvent('nvu-push-opened',{detail:{notification:{data:{userId:owner,companyId:second,type:'SYSTEM',targetProfile:'corporate'}}}})),{owner,second});
 await page.getByText('Empresa QA Dois',{exact:true}).first().waitFor({timeout:30000});checks.push('Push seleciona outra empresa na mesma conta sem reutilizar a empresa anterior');
 await page.getByRole('button',{name:'Equipes',exact:true}).click();await page.getByRole('button',{name:'Ações de Nome editado QA',exact:true}).waitFor({timeout:30000});
 await db.doc('users/'+driver).update({name:'Nome Secundario QA',profileNameSource:'user_edit'});await require(path.resolve('functions/lib/userProfiles.js')).refreshPublicUser(db,driver);
 await page.getByRole('button',{name:'Ações de Nome Secundario QA',exact:true}).waitFor({timeout:30000});assert.equal((await db.doc('users/'+driver).get()).get('companyId'),company);checks.push('Identidade em tempo real também atualiza o vínculo secundário preservando a empresa primária');
 assert.deepEqual(errors,[]);fs.writeFileSync('qa/results/emulators/app-shell.json',JSON.stringify({checks,errors,method:'App e providers reais; login de conta fictícia pelo SDK Auth local em entrada exclusiva de testes. Google OAuth e Android não são simulados como aprovados.'},null,2));console.log('QA_APP_SHELL_PASS',checks.length);
}catch(e){console.error((await page.locator('body').innerText()).slice(-6000));console.error('Action buttons at failure:',await page.locator('button[aria-label^="Ações"]').evaluateAll(nodes=>nodes.map(n=>({label:n.getAttribute('aria-label'),inert:!!n.closest('[inert]'),hidden:!!n.closest('[hidden]'),width:n.getBoundingClientRect().width}))));console.error(errors);throw e;}
finally{await browser.close();server.httpServer?.closeAllConnections();await server.close();http.closeAllConnections();await new Promise<void>(r=>http.close(()=>r()));await db.terminate();}
