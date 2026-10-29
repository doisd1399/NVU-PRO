import * as admin from './firebaseAdmin';
import {createHash,randomUUID} from 'node:crypto';
type Data=Record<string,any>;
type Send=(message:admin.messaging.MulticastMessage)=>Promise<admin.messaging.BatchResponse>;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const millis=(v:any)=>Number(v?.toMillis?.()??(v?.seconds?v.seconds*1000:typeof v==='string'?Date.parse(v):v))||0;
const FINAL=new Set(['completed','completed_no_tokens','completed_with_failures','expired']);
const RECIPIENT_FINAL=new Set(['sent','invalid','permanent','revoked']);
const INVALID=new Set(['messaging/invalid-registration-token','messaging/registration-token-not-registered']);
const PERMANENT=new Set(['messaging/invalid-argument','messaging/mismatched-credential','messaging/sender-id-mismatch']);
const LEASE=90000,MAX_AGE=7*24*3600000,BATCH=200;
export function createPushDispatcher(db:FirebaseFirestore.Firestore,send:Send,now=Date.now){
 return async(sourceCollection:'notifications'|'notificacoes',notificationId:string,data:Data)=>{
  const userId=text(data.userId),title=text(data.title)||text(data.titulo),body=text(data.message)||text(data.mensagem);if(!userId||!title||!body)return;
  const dedupe=text(data.dedupeKey),id=dedupe?`${userId}_${dedupe}`.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,1400):notificationId;
  const ref=db.doc('pushDispatches/'+id),leaseId=randomUUID();
  const claim=await db.runTransaction(async tx=>{
   const s=await tx.get(ref),p=s.data()||{},time=now();
   if(FINAL.has(p.status))return'done';
   if(p.status==='processing'&&(millis(p.leaseExpiresAt)||millis(p.createdAt)+LEASE)>time)return'busy';
   if(p.status==='retryable'&&millis(p.nextAttemptAt)>time)return'backoff';
   if(millis(p.createdAt)&&time-millis(p.createdAt)>MAX_AGE){tx.set(ref,{status:'expired',leaseId:null,completedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});return'done';}
   tx.set(ref,{notificationId,sourceCollection,userId,dedupeKey:dedupe||null,status:'processing',leaseId,leaseExpiresAt:admin.firestore.Timestamp.fromMillis(time+LEASE),attempts:Number(p.attempts||0)+1,...(s.exists?{}:{createdAt:admin.firestore.FieldValue.serverTimestamp()})},{merge:true});return'claimed';
  });
  if(claim==='done')return;if(claim!=='claimed')throw Error('PUSH_RETRY_'+claim);
  const withLease=(patch:Data)=>db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.get('leaseId')!==leaseId)return false;tx.set(ref,patch,{merge:true});return true;});
  try{
   const devices=await db.collection('userDevices').where('userId','==',userId).get();
   const byToken=new Map<string,FirebaseFirestore.QueryDocumentSnapshot[]>();
   for(const row of devices.docs){const token=text(row.get('token'));if(token)byToken.set(token,[...(byToken.get(token)||[]),row]);}
   if(!byToken.size){await withLease({status:'completed_no_tokens',leaseId:null,completedAt:admin.firestore.FieldValue.serverTimestamp()});return;}
   const payload:Record<string,string>={notificationId,sourceCollection,userId};
   for(const key of ['type','companyId','targetProfile','dedupeKey']){const value=text(data[key])||(key==='type'?text(data.tipo):'');if(value)payload[key]=value;}
   for(const key of ['jobId','operationId','applicationId','contractId']){const value=data.metadata?.[key];if(typeof value==='string'&&value.length<=180)payload[key]=value;}
   const entries=[...byToken];let transient=false;
   for(let offset=0;offset<entries.length;offset+=BATCH){
    const original=entries.slice(offset,offset+BATCH),ledger=await db.getAll(...original.map(([token])=>ref.collection('recipients').doc(hash(token))));
    const pending=original.filter((_,i)=>!RECIPIENT_FINAL.has(ledger[i].get('status')));if(!pending.length)continue;
    const references=pending.flatMap(([,rows])=>rows.map(row=>row.ref)),current=await db.getAll(...references);
    const currentByPath=new Map(current.map(row=>[row.ref.path,row]));
    const active=pending.filter(([token,rows])=>rows.some(old=>{const row=currentByPath.get(old.ref.path);return row?.exists&&row.get('userId')===userId&&row.get('token')===token&&Number(row.get('revision')||0)===Number(old.get('revision')||0);}));
    const activeTokens=new Set(active.map(([token])=>token));
    await db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.get('leaseId')!==leaseId)throw Error('PUSH_LEASE_LOST');for(const[token]of pending)if(!activeTokens.has(token))tx.set(ref.collection('recipients').doc(hash(token)),{status:'revoked',updatedAt:admin.firestore.FieldValue.serverTimestamp()});});
    if(!active.length)continue;
    const lease=await ref.get();if(lease.get('leaseId')!==leaseId||millis(lease.get('leaseExpiresAt'))<=now())throw Error('PUSH_LEASE_LOST');
    const tag='nvu_'+hash(id).slice(0,40),response=await send({tokens:active.map(([token])=>token),notification:{title,body},data:payload,android:{collapseKey:tag,ttl:24*3600000,notification:{tag,channelId:'nvu_notifications'}}});
    if(response.responses.length!==active.length)throw Error('PUSH_RESPONSE_INCOMPLETE');
    await db.runTransaction(async tx=>{
     const lease=await tx.get(ref);if(lease.get('leaseId')!==leaseId)throw Error('PUSH_LEASE_LOST');
     // Bound legacy duplicate cleanup: recipient ledger + deletes stay below 500 writes.
     const invalid=active.flatMap(([token,rows],i)=>!response.responses[i].success&&INVALID.has(response.responses[i].error?.code||'')?rows.map(old=>({old,token})):[]).slice(0,250);
     const live=invalid.length?await tx.getAll(...invalid.map(row=>row.old.ref)):[];
     for(let i=0;i<active.length;i++){const[token]=active[i],result=response.responses[i],code=result.error?.code||'messaging/unknown-error';const status=result.success?'sent':INVALID.has(code)?'invalid':PERMANENT.has(code)?'permanent':'retryable';if(status==='retryable')transient=true;tx.set(ref.collection('recipients').doc(hash(token)),{status,...(result.success?{}:{code}),updatedAt:admin.firestore.FieldValue.serverTimestamp()});}
     invalid.forEach(({old,token},i)=>{const row=live[i];if(row.exists&&row.get('userId')===userId&&row.get('token')===token&&Number(row.get('revision')||0)===Number(old.get('revision')||0))tx.delete(old.ref);});
     tx.set(ref,{leaseExpiresAt:admin.firestore.Timestamp.fromMillis(now()+LEASE)},{merge:true});
    });
   }
   if(transient)throw Error('PUSH_TRANSIENT_RECIPIENT_FAILURE');
   const all=await ref.collection('recipients').get(),successCount=all.docs.filter(s=>s.get('status')==='sent').length,failureCount=all.docs.filter(s=>['invalid','permanent'].includes(s.get('status'))).length;
   await withLease({status:failureCount?'completed_with_failures':'completed',leaseId:null,successCount,failureCount,completedAt:admin.firestore.FieldValue.serverTimestamp()});
  }catch(error){await withLease({status:'retryable',leaseId:null,nextAttemptAt:admin.firestore.Timestamp.fromMillis(now()+10000),lastError:error instanceof Error?error.message.slice(0,100):'PUSH_SEND_FAILED'});throw error;}
 };
}
