// Explicit rollout utility: no QA command runs this against production.
const admin = require('../lib/firebaseAdmin');
const args=process.argv.slice(2),project=args.find(v=>v.startsWith('--project='))?.slice(10);
if(!project)throw Error('Provide --project=<confirmed-project-id>');
if(process.env.FIRESTORE_EMULATOR_HOST&&!project.startsWith('demo-'))throw Error('Emulator/project mismatch');
if(!admin.apps.length)admin.initializeApp({projectId:project});
const db=admin.firestore(),apply=args.includes('--apply');
function date(data){
 if(data.createdAt?.toMillis)return null;
 for(const value of [data.createdAt,data.createdAtIso,data.dataHora,data.data]){
  const ms=typeof value==='string'?Date.parse(value):typeof value==='number'?value:NaN;
  if(Number.isFinite(ms)&&ms>0)return admin.firestore.Timestamp.fromMillis(ms);
 }
 return undefined;
}
(async()=>{
 let cursor,scanned=0,eligible=0,unresolved=0;
 do{
  let q=db.collection('notifications').orderBy(admin.firestore.FieldPath.documentId()).limit(100);
  if(cursor)q=q.startAfter(cursor);
  const page=await q.get();
  for(const row of page.docs){
   scanned++;const value=date(row.data());if(value===undefined){unresolved++;continue;}if(value===null)continue;eligible++;
   if(apply)await db.runTransaction(async tx=>{const current=await tx.get(row.ref);if(!current.exists)return;const latest=date(current.data());if(latest)tx.update(row.ref,{createdAt:latest});});
  }
  cursor=page.size===100?page.docs.at(-1):null;
 }while(cursor);
 console.log(JSON.stringify({project,mode:apply?'apply':'dry-run',scanned,eligible,unresolved}));
 if(unresolved)process.exitCode=2;
 await db.terminate();
})().catch(e=>{console.error(e.message);process.exitCode=1;});
