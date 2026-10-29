const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve('functions/lib');
const observations=[];
function note(name,details={}){observations.push({name,...details});console.log('PASS',name);}
class Stamp{constructor(ms){this.seconds=Math.floor(ms/1000);this.nanoseconds=(ms%1000)*1e6;}toDate(){return new Date(this.toMillis());}toMillis(){return this.seconds*1000+this.nanoseconds/1e6;}static now(){return new Stamp(Date.now());}static fromMillis(ms){return new Stamp(ms);}}
const DEL=Symbol('delete');
const FieldValue={serverTimestamp:()=>Stamp.now(),delete:()=>DEL};
function clone(x){if(x===DEL)return x;if(x instanceof Stamp)return Stamp.fromMillis(x.toMillis());if(x instanceof Date)return new Date(x);if(Array.isArray(x))return x.map(clone);if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,clone(v)]));return x;}
function undefinedAt(x,p=''){if(x===undefined)return p;if(!x||typeof x!=='object'||x instanceof Stamp)return null;for(const[k,v]of Object.entries(x)){const found=undefinedAt(v,p?`${p}.${k}`:k);if(found)return found;}return null;}
function merge(a,b){const out=clone(a);for(const[k,v]of Object.entries(b)){if(v===DEL)delete out[k];else out[k]=v&&typeof v==='object'&&!Array.isArray(v)&&!(v instanceof Stamp)&&!(v instanceof Date)?merge(out[k]||{},v):clone(v);}return out;}
const field=(data,key)=>key.split('.').reduce((v,k)=>v?.[k],data);
function makeEnv(seed){
 const rows=new Map(Object.entries(seed).map(([k,v])=>[k,clone(v)]));let sequence=0;const reads=[],authWrites=[];
 const authRows=new Map();let failAuth=false;
 const snapshot=(p,state=rows)=>({id:p.split('/').at(-1),ref:doc(p),exists:state.has(p),data:()=>clone(state.get(p)),get:k=>field(state.get(p),k)});
 function put(state,p,data,options={},isUpdate=false){const bad=undefinedAt(data);if(bad)throw new Error(`Cannot use undefined as a Firestore value (found in field ${bad})`);if(isUpdate&&!state.has(p))throw new Error('not-found');let result=options.merge?merge(state.get(p)||{},data):isUpdate?{...clone(state.get(p)),...clone(data)}:clone(data);for(const[k,v]of Object.entries(result))if(v===DEL)delete result[k];state.set(p,result);}
 function doc(p){return {path:p,id:p.split('/').at(-1),get:async()=>{reads.push(p);return snapshot(p);},set:async(d,o)=>put(rows,p,d,o),update:async d=>put(rows,p,d,{},true),delete:async()=>rows.delete(p),collection:n=>collection(`${p}/${n}`)};}
 function collection(p,filters=[],max=Infinity){return {path:p,doc:id=>doc(`${p}/${id||`generated-${++sequence}`}`),where:(k,op,v)=>collection(p,[...filters,[k,op,v]],max),limit:n=>collection(p,filters,n),async get(state=rows){reads.push(`${p}?${JSON.stringify(filters)}`);const out=[...state].filter(([key,data])=>key.startsWith(`${p}/`)&&key.split('/').length===p.split('/').length+1&&filters.every(([k,op,v])=>{let x=field(data,k);if(op==='==')return x===v;if(op==='in')return v.includes(x);if(op==='>')return (x?.toMillis?.()??x)>(v?.toMillis?.()??v);throw new Error(op);})).slice(0,max).map(([key])=>snapshot(key,state));return {docs:out,empty:out.length===0,size:out.length};}};}
 const db={doc,collection,async runTransaction(fn){const state=new Map([...rows].map(([k,v])=>[k,clone(v)]));const tx={get:async target=>target.path&&target.id?(reads.push(target.path),snapshot(target.path,state)):target.get(state),set:(ref,data,options)=>put(state,ref.path,data,options),update:(ref,data)=>put(state,ref.path,data,{},true),delete:ref=>state.delete(ref.path),create:(ref,data)=>{if(state.has(ref.path))throw new Error('already-exists');put(state,ref.path,data);}};const r=await fn(tx);rows.clear();for(const[k,v]of state)rows.set(k,v);return r;}};
 class HttpsError extends Error{constructor(code,message,details){super(message);this.code=code;this.details=details;}}
 const callable={onCall:f=>f};
 const functions={https:{...callable,HttpsError},region:()=>functions,runWith:()=>functions,pubsub:{schedule:()=>({onRun:f=>f})},firestore:{document:()=>({onWrite:f=>f,onCreate:f=>f})}};
 const firestore=()=>db;firestore.FieldValue=FieldValue;firestore.Timestamp=Stamp;
 const admin={apps:[{}],initializeApp(){},firestore,auth:()=>auth,app:()=>({options:{projectId:'demo-audit'}})};
 const auth={async getUser(uid){return {uid,disabled:false,tokensValidAfterTime:'2020-01-01T00:00:00Z',...(authRows.get(uid)||{})};},async updateUser(uid,patch){authWrites.push({operation:'updateUser',uid,...patch});if(failAuth)throw new Error('INJECTED_AUTH_UPDATE_FAILURE');authRows.set(uid,{...(authRows.get(uid)||{}),...patch});},async revokeRefreshTokens(uid){authWrites.push({operation:'revokeRefreshTokens',uid});}};
 const cache=new Map();
 function load(name){const full=path.join(root,name.endsWith('.js')?name:`${name}.js`);if(cache.has(full))return cache.get(full).exports;const module={exports:{}};cache.set(full,module);const req=spec=>{if(spec==='firebase-admin')return admin;if(spec==='firebase-admin/app')return {getApps:()=>[{}],initializeApp(){}};if(spec==='firebase-admin/auth')return {getAuth:()=>auth};if(spec==='firebase-admin/firestore')return {getFirestore:()=>db,FieldValue,Timestamp:Stamp};if(spec==='firebase-functions')return functions;if(spec==='firebase-functions/v1/https')return {...callable,HttpsError};if(spec.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(full),spec)));if(spec.startsWith('node:'))return require(spec);throw new Error(`UNMOCKED_IMPORT ${spec}`);};vm.runInNewContext(`(function(require,module,exports){${fs.readFileSync(full,'utf8')}\n})`,{console,process:{env:{GCLOUD_PROJECT:'demo-audit'}},Date,URL,Buffer}, {filename:full})(req,module,module.exports);return module.exports;}
 return {rows,reads,authWrites,authRows,load,setFailAuth:v=>failAuth=v};
}
const ctx={auth:{uid:'senior-actor',token:{senior:true,auth_time:2000000000}}};
function fixture(){return {
 'users/senior-actor':{status:'active',accountStatus:'active'},
 'users/driver-1':{status:'active',accountStatus:'active',companyId:'company-1',email:'test@example.invalid',memberships:{'company-1':{role:'driver',roles:['driver'],status:'active'},'company-2':{role:'driver',roles:['driver'],status:'active'}}},
 'frotas/company-1':{ownerId:'owner-1',companyName:'Test fleet',simulatorId:'global-truck'},
 'companyMembers/driver-1_company-1':{userId:'driver-1',companyId:'company-1',roles:['driver'],status:'active'},
 'companyMembers/legacy-duplicate':{userId:'driver-1',companyId:'company-1',roles:['admin','driver'],status:'active'},
 'simulator_members/driver-1_company-1':{userId:'driver-1',companyId:'company-1',roles:['driver'],status:'active'},
 'company_access/company-1/members/driver-1':{userId:'driver-1',companyId:'company-1',roles:['driver'],status:'active'},
 'recruitment_applications/old-application':{userId:'driver-1',email:'test@example.invalid',companyId:'company-1',type:'driver_application',status:'approved',createdAt:Stamp.fromMillis(Date.now()-86400000),approvalAuthorityVersion:1},
 'solicitacoes_motoristas/old-request':{motoristaId:'driver-1',empresaId:'company-1',status:'approved'},
 'trabalhos/job-1':{driverId:'driver-1',companyId:'company-1',status:'active',progress:4},
 'historico_viagens/trip-1':{driverId:'driver-1',companyId:'company-1',valor:100,status:'concluida'}
};}
(async()=>{
 {
  const e=makeEnv(fixture());e.setFailAuth(true);const r=await e.load('seniorEmployeeActions').suspendSeniorAccount({targetUserId:'driver-1',companyId:'company-1',reason:'Test'},ctx);
  assert.equal(r.pending,true);assert.equal(r.success,false);assert.equal(e.rows.get('users/driver-1').accountStatus,'suspended');
  assert(e.rows.has('senior_account_commands/'+r.actionId));assert.equal(e.rows.get('audit_senior_employee_actions/'+r.actionId).result,'pending_recovery');
  e.setFailAuth(false);assert.equal(await e.load('seniorAccountCommands').executeAccountCommand(r.actionId),true);
  assert.equal(e.authRows.get('driver-1').disabled,true);assert.equal(e.rows.get('senior_account_commands/'+r.actionId).state,'COMPLETED');
  note('Authentication failure leaves a durable command and audit; recovery completes them');
 }
 {
  const e=makeEnv(fixture()),s=e.load('seniorEmployeeActions');await s.suspendSeniorAccount({targetUserId:'driver-1',companyId:'company-1',reason:'Test'},ctx);
  await s.removeDriverFromFleetSenior({targetUserId:'driver-1',companyId:'company-1'},ctx);
  assert.equal((await s.reactivateSeniorAccount({targetUserId:'driver-1',companyId:'company-1'},ctx)).success,true);
  assert.equal(e.rows.get('users/driver-1').accountStatus,'active');assert.equal(e.rows.get('company_access/company-1/members/driver-1').status,'removed');
  assert(e.rows.has('historico_viagens/trip-1'));assert(e.rows.get('users/driver-1').memberships['company-2']);
  note('Removed suspended account can reactivate without restoring the removed fleet or losing history');
 }
 {
  const e=makeEnv(fixture()),s=e.load('seniorEmployeeActions');await s.deleteSeniorProfile({targetUserId:'driver-1',companyId:'company-1',reason:'Test',confirmation:true},ctx);
  await assert.rejects(()=>s.reactivateSeniorAccount({targetUserId:'driver-1',companyId:'company-1'},ctx),/excluído/);
  assert.equal(e.authRows.get('driver-1').disabled,true);note('Deleted profiles cannot be silently reactivated');
 }
 {
  const seed=fixture();seed['users/senior-actor'].accountStatus='suspended';const e=makeEnv(seed);
  await assert.rejects(()=>e.load('seniorEmployeeActions').suspendSeniorAccount({targetUserId:'driver-1',companyId:'company-1',reason:'Test'},ctx),/indisponível/);
  assert.equal(e.rows.get('users/driver-1').accountStatus,'active');note('Suspended Senior actor is denied before any target mutation');
 }
 {
  const e=makeEnv(fixture());e.authRows.set('senior-actor',{tokensValidAfterTime:'2035-01-01T00:00:00Z'});
  await assert.rejects(()=>e.load('seniorEmployeeActions').reactivateSeniorAccount({targetUserId:'driver-1',companyId:'company-1'},ctx),/indisponível/);
  note('Revoked administrative token cannot perform sensitive actions');
 }
 {
  const seed=fixture();seed['users/driver-1'].operationalSuspension={active:true,companyId:'company-1',endsAt:Stamp.fromMillis(Date.now()+3600000)};
  const e=makeEnv(seed);const r=await e.load('seniorEmployeeActions').endSeniorOperationalSuspension({targetUserId:'driver-1',companyId:'company-1'},ctx);
  assert.equal(r.success,true);assert.equal(e.rows.get('users/driver-1').operationalSuspension.active,false);
  assert.equal(e.rows.get('audit_senior_employee_actions/'+r.actionId).previousState.operationalSuspendedAt,null);
  note('Nested-only operational suspension and its audit commit together without undefined fields');
 }
 {
  const seed=fixture();seed['users/driver-1'].accountStatus='suspended';seed['users/driver-1'].suspension={active:true,actionId:'expired-old',actionType:'SUSPEND_ACCOUNT',companyId:'company-1',expiresAt:'2020-01-01T00:00:00Z'};
  const e=makeEnv(seed);await e.load('seniorAccountCommands').recoverSeniorAccountCommands();
  assert.equal(e.rows.get('users/driver-1').accountStatus,'active');assert.equal(e.authRows.get('driver-1').disabled,false);
  note('Independent scheduled recovery expires old suspensions without an administrative list query');
 }
 {
  const e=makeEnv(fixture());e.setFailAuth(true);const s=e.load('seniorEmployeeActions');const data={targetUserId:'driver-1',companyId:'company-1',reason:'Test'};
  const a=await s.suspendSeniorAccount(data,ctx),b=await s.suspendSeniorAccount(data,ctx);assert.equal(a.actionId,b.actionId);
  assert.equal([...e.rows.keys()].filter(k=>k.startsWith('senior_account_commands/')).length,1);note('Repeated pending action reuses a single command');
 }
 {
  const e=makeEnv(fixture());const c=e.load('companyAccess');assert.equal(c.companyUsable({deleted:true}),false);assert.equal(c.companyUsable({status:'deleted'}),false);
  assert.equal(c.companyUsable({status:'active'}),true);note('Archived companies cannot regain operational access through membership projections');
 }
 {
  const e=makeEnv(fixture()),s=e.load('seniorEmployeeActions');await s.removeDriverFromFleetSenior({targetUserId:'driver-1',companyId:'company-1'},ctx);
  await assert.rejects(()=>e.load('fleetMembership').manageFleetMembership({action:'approve-application',companyId:'company-1',applicationId:'old-application'},ctx),/Inscrição revogada/);
  note('Old revoked application cannot restore an employee');
 }
 fs.mkdirSync('reports/release-505',{recursive:true});fs.writeFileSync('reports/release-505/admin-recovery.json',JSON.stringify({productionAccess:false,method:'actual compiled handlers, transactional Firestore and Auth doubles, strict undefined rejection',checks:observations.length,passed:observations},null,2));
 console.log('ADMIN_RECOVERY_505_PASS',observations.length);
})().catch(e=>{console.error(e);process.exitCode=1;});
