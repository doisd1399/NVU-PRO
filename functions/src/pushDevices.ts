import * as admin from './firebaseAdmin';
import * as functions from 'firebase-functions/v1';
import {createHash} from 'node:crypto';
export const pushTokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
function fields(data:Record<string,unknown>,allowed:string[]){if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!allowed.includes(k)))throw new functions.https.HttpsError('invalid-argument','Campos do dispositivo inválidos.');}
function text(value:unknown,max:number,nullable=false):string|null{if(value==null&&nullable)return null;if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new functions.https.HttpsError('invalid-argument','Dados do dispositivo inválidos.');return value.trim();}
function revision(value:unknown){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0)throw new functions.https.HttpsError('invalid-argument','Revisão do dispositivo inválida.');return value;}
export const registerPushDevice=functions.https.onCall(async(data,context)=>{
 const uid=context.auth?.uid;if(!uid)throw new functions.https.HttpsError('unauthenticated','Autenticação obrigatória.');
 fields(data,['token','platform','companyId','activeProfile','protocolVersion','revision']);
 const token=text(data.token,4096)!,hash=pushTokenHash(token),modern=data.protocolVersion===2,rev=modern?revision(data.revision):0;
 const platform=data.platform==null?'unknown':text(data.platform,40),companyId=text(data.companyId,180,true),activeProfile=text(data.activeProfile,32,true);
 const db=admin.firestore(),ownerRef=db.doc('pushTokenOwners/'+hash),deviceRef=db.doc('userDevices/'+uid+'_'+hash);
 return db.runTransaction(async tx=>{
  const owner=await tx.get(ownerRef),prior=owner.data();
  if(!modern&&prior?.protocolVersion===2)return{success:false,obsoleteClient:true};
  if(modern&&Number(prior?.revision||0)>=rev){if(prior?.revision===rev&&prior.userId===uid&&!prior.revoked)return{success:true,tokenHash:hash,idempotent:true};return{success:false,stale:true,minimumRevision:Number(prior?.revision||0)+1};}
  const rows=await tx.get(db.collection('userDevices').where('token','==',token).limit(501));
  if(rows.size>500)throw new functions.https.HttpsError('resource-exhausted','O dispositivo precisa de revisão de vínculos.');
  for(const row of rows.docs)if(row.ref.path!==deviceRef.path)tx.delete(row.ref);
  tx.set(deviceRef,{userId:uid,token,tokenHash:hash,revision:rev,protocolVersion:modern?2:1,platform,companyId,activeProfile,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
  tx.set(ownerRef,{userId:uid,tokenHash:hash,deviceId:deviceRef.id,revision:rev,protocolVersion:modern?2:1,revoked:false,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
  return{success:true,tokenHash:hash};
 });
});
export const revokePushDevice=functions.https.onCall(async(data,context)=>{
 const uid=context.auth?.uid;if(!uid)throw new functions.https.HttpsError('unauthenticated','Autenticação obrigatória.');
 fields(data,['tokenHash','revision']);const hash=text(data.tokenHash,64)!;if(!/^[a-f0-9]{64}$/.test(hash))throw new functions.https.HttpsError('invalid-argument','Identificador do dispositivo inválido.');
 const rev=revision(data.revision),db=admin.firestore(),ownerRef=db.doc('pushTokenOwners/'+hash);
 return db.runTransaction(async tx=>{
  const owner=await tx.get(ownerRef),prior=owner.data();
  if(prior&&(prior.userId!==uid||Number(prior.revision||0)>=rev))return{success:true,skipped:true};
  const deviceRef=prior?.deviceId?db.doc('userDevices/'+prior.deviceId):null,device=deviceRef?await tx.get(deviceRef):null;
  const legacy=!prior?await tx.get(db.collection('userDevices').where('userId','==',uid).limit(501)):null;
  if(legacy&&legacy.size>500)throw new functions.https.HttpsError('resource-exhausted','O dispositivo precisa de revisão de vínculos.');
  if(device?.exists&&device.get('userId')===uid&&device.get('tokenHash')===hash)tx.delete(deviceRef!);
  legacy?.docs.filter(row=>typeof row.get('token')==='string'&&pushTokenHash(row.get('token'))===hash).forEach(row=>tx.delete(row.ref));
  tx.set(ownerRef,{userId:uid,tokenHash:hash,revision:rev,protocolVersion:2,revoked:true,deviceId:null,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
  return{success:true};
 });
});
