import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root=path.resolve(process.env.NVU_AUDIT_SOURCE || '.');
const source=fs.readFileSync(path.join(root,'src/context/AppContext.tsx'),'utf8');
const tree=ts.createSourceFile('AppContext.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const actions=new Map();
function visit(node){if(ts.isVariableDeclaration(node)&&node.initializer&&ts.isArrowFunction(node.initializer)&&ts.isIdentifier(node.name))actions.set(node.name.text,node.initializer.getText(tree));ts.forEachChild(node,visit);}visit(tree);
const checked=[];
const payloads={createCompany:{companyName:'Company',email:'test@example.test'},createContract:{name:'BLS',totalDeliveries:5,mode:'simple'},addVehicle:{name:'Iveco'},addTrailer:{name:'Rodocaçamba'},createSequence:{companyId:'company',name:'Folder'},deleteCompany:'company',cancelRequestJoinCompany:'request',requestJoinCompany:'company'};
for(const [name,payload] of Object.entries(payloads))for(const code of ['permission-denied','unavailable']){
 const injected=Object.assign(new Error(code),{code});let reported=0,uiChanges=0;
 const fail=async()=>{throw injected};const dependencies={activeCompanyId:'company',companies:[{id:'company',companyName:'DC',simulatorName:'GTO',simulatorId:'gto'}],currentUser:{id:'driver'},driverRequests:[],memberships:[],allCompanyMembers:[],getCurrentUserId:()=> 'driver',handleFirebaseError:e=>{assert.equal(e,injected);reported++},generateCnpj:()=> '123456',currentUserRef:{current:{email:'test@example.test'}},resolveSimulatorId:()=> 'gto',writeBatch:()=>({set:()=>{},update:()=>{},commit:fail}),db:{},doc:()=>({id:'new-company'}),collection:()=>({}),query:()=>({}),where:()=>({}),getDocs:fail,getDoc:fail,deleteDoc:fail,updateDoc:fail,addDoc:fail,deleteCompanyCanonical:fail,setCompanies:()=>uiChanges++,setActiveCompanyId:()=>uiChanges++,setActiveRole:()=>uiChanges++,alert:()=>uiChanges++,toast:{success:()=>uiChanges++}};
 const js=ts.transpileModule('const action='+actions.get(name)+'; export default action;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const module={exports:{}};const action=new Function(...Object.keys(dependencies),'exports','module',js+'; return exports.default;')(...Object.values(dependencies),module.exports,module);
 let rejected=false;try{await action(payload)}catch(e){assert.equal(e,injected);rejected=true}
 if(!rejected)throw Error(`${name}: ${code} was swallowed; caller receives false success`);
 assert.equal(reported,1);assert.equal(uiChanges,0);checked.push(`${name}: ${code} rejects without publishing success`);
}
if(!process.env.NVU_AUDIT_SOURCE){fs.mkdirSync('reports/release-506',{recursive:true});fs.writeFileSync('reports/release-506/action-failures.json',JSON.stringify({productionAccess:false,method:'Executed actual action bodies parsed from AppContext, injected Firestore failures; no copied implementation',checks:checked.length,passed:checked},null,2));}
console.log('ACTION_FAILURES_506_PASS',checked.length);
