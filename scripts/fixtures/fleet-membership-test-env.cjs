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
function makeEnv(seed,options={}){
 const root=options.root || path.resolve('functions/lib');
 const readDelayMs=options.readDelayMs || 0;
 let failNextCommit = false; const transactionStats={commits:0,writes:0};
 const rows=new Map(Object.entries(seed).map(([k,v])=>[k,clone(v)]));let sequence=0;const reads=[],authWrites=[];
 const authRows=new Map();let failAuth=false;
 const snapshot=(p,state=rows)=>({id:p.split('/').at(-1),ref:doc(p),exists:state.has(p),data:()=>clone(state.get(p)),get:k=>field(state.get(p),k)});
 function put(state,p,data,options={},isUpdate=false){const bad=undefinedAt(data);if(bad)throw new Error(`Cannot use undefined as a Firestore value (found in field ${bad})`);if(isUpdate&&!state.has(p))throw new Error('not-found');let result=options.merge?merge(state.get(p)||{},data):isUpdate?{...clone(state.get(p)),...clone(data)}:clone(data);for(const[k,v]of Object.entries(result))if(v===DEL)delete result[k];state.set(p,result);}
 function doc(p){return {path:p,id:p.split('/').at(-1),get:async()=>{reads.push(p);return snapshot(p);},set:async(d,o)=>put(rows,p,d,o),update:async d=>put(rows,p,d,{},true),delete:async()=>rows.delete(p),collection:n=>collection(`${p}/${n}`)};}
 function collection(p,filters=[],max=Infinity){return {path:p,doc:id=>doc(`${p}/${id||`generated-${++sequence}`}`),where:(k,op,v)=>collection(p,[...filters,[k,op,v]],max),limit:n=>collection(p,filters,n),async get(state=rows){reads.push(`${p}?${JSON.stringify(filters)}`);const out=[...state].filter(([key,data])=>key.startsWith(`${p}/`)&&key.split('/').length===p.split('/').length+1&&filters.every(([k,op,v])=>{let x=field(data,k);if(op==='==')return x===v;if(op==='in')return v.includes(x);if(op==='>')return (x?.toMillis?.()??x)>(v?.toMillis?.()??v);throw new Error(op);})).slice(0,max).map(([key])=>snapshot(key,state));return {docs:out,empty:out.length===0,size:out.length};}};}
 const db={doc,collection,async runTransaction(fn){const state=new Map([...rows].map(([k,v])=>[k,clone(v)]));let writeStarted=false; const startWrite=()=>{writeStarted=true;transactionStats.writes++;}; const tx={get:async target=>{if(readDelayMs)await new Promise(resolve=>setTimeout(resolve,readDelayMs));if(writeStarted)throw new Error("READ_AFTER_WRITE");return target.path&&target.id?(reads.push(target.path),snapshot(target.path,state)):target.get(state);},set:(ref,data,options)=>{startWrite();return put(state,ref.path,data,options);},update:(ref,data)=>{startWrite();return put(state,ref.path,data,{},true);},delete:ref=>{startWrite();return state.delete(ref.path);},create:(ref,data)=>{startWrite();if(state.has(ref.path))throw new Error('already-exists');put(state,ref.path,data);}};const r=await fn(tx);if(failNextCommit){failNextCommit=false;throw Object.assign(new Error("injected before commit"),{code:"unavailable"});}transactionStats.commits++;rows.clear();for(const[k,v]of state)rows.set(k,v);return r;}};
 class HttpsError extends Error{constructor(code,message,details){super(message);this.code=code;this.details=details;}}
 const callable={onCall:f=>f};
 const functions={logger:{error(){},info(){}},https:{...callable,HttpsError},region:()=>functions,runWith:()=>functions,pubsub:{schedule:()=>({onRun:f=>f})},firestore:{document:()=>({onWrite:f=>f,onCreate:f=>f})}};
 const firestore=()=>db;firestore.FieldValue=FieldValue;firestore.Timestamp=Stamp;
 const admin={apps:[{}],initializeApp(){},firestore,auth:()=>auth,app:()=>({options:{projectId:'demo-audit'}}),storage:()=>({bucket:()=>({file:()=>({getMetadata:async()=>{if(!options.storageMetadata)throw Object.assign(new Error('receipt not found'),{code:404});return[options.storageMetadata];}})})})};
 const auth={async getUser(uid){return {uid,disabled:false,tokensValidAfterTime:'2020-01-01T00:00:00Z',...(authRows.get(uid)||{})};},async updateUser(uid,patch){authWrites.push({operation:'updateUser',uid,...patch});if(failAuth)throw new Error('INJECTED_AUTH_UPDATE_FAILURE');authRows.set(uid,{...(authRows.get(uid)||{}),...patch});},async revokeRefreshTokens(uid){authWrites.push({operation:'revokeRefreshTokens',uid});}};
 const cache=new Map();
 function load(name){const full=path.join(root,name.endsWith('.js')?name:`${name}.js`);if(cache.has(full))return cache.get(full).exports;const module={exports:{}};cache.set(full,module);const req=spec=>{if(spec==='firebase-admin'||spec==='./firebaseAdmin')return admin;if(spec==='firebase-admin/app')return {getApps:()=>[{}],initializeApp(){}};if(spec==='firebase-admin/auth')return {getAuth:()=>auth};if(spec==='firebase-admin/firestore')return {getFirestore:()=>db,FieldValue,Timestamp:Stamp};if(spec==='firebase-functions'||spec==='firebase-functions/v1')return functions;if(spec==='firebase-functions/v1/https')return {...callable,HttpsError};if(spec.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(full),spec)));if(spec.startsWith('node:'))return require(spec);throw new Error(`UNMOCKED_IMPORT ${spec}`);};vm.runInNewContext(`(function(require,module,exports){${(options.sources?.[path.basename(full)] || fs.readFileSync(full,'utf8'))}\n})`,{console,process:{env:{GCLOUD_PROJECT:'demo-audit'}},Date,URL,Buffer}, {filename:full})(req,module,module.exports);return module.exports;}
 return {rows,reads,authWrites,authRows,load,db,transactionStats,failNextCommit:()=>{failNextCommit=true;},setFailAuth:v=>failAuth=v};
}

module.exports={makeEnv,Stamp};
