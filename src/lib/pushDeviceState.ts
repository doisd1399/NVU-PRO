const REVISION_KEY='nvu.push.revision.v1',DEVICE_KEY='nvu.push.device.v1',REVOKE_KEY='nvu.push.pending-revocations.v1';
export type PushRevocation={userId:string;tokenHash:string;revision:number};
export function reservePushRevision(minimum=0){const previous=Number(localStorage.getItem(REVISION_KEY))||0;const revision=Math.max(Date.now()*1000,previous+1,minimum);if(!Number.isSafeInteger(revision)||revision<=0)throw Error('PUSH_REVISION_INVALID');localStorage.setItem(REVISION_KEY,String(revision));return revision;}
export async function pushTokenHash(token:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export function rememberPushDevice(userId:string,tokenHash:string){localStorage.setItem(DEVICE_KEY,JSON.stringify({userId,tokenHash}));}
export function rememberedPushDevice():{userId:string;tokenHash:string}|null{try{const row=JSON.parse(localStorage.getItem(DEVICE_KEY)||'null');return row&&typeof row.userId==='string'&&/^[a-f0-9]{64}$/.test(row.tokenHash)?row:null;}catch{return null;}}
export function forgetPushDevice(){localStorage.removeItem(DEVICE_KEY);}
export function pendingPushRevocations():PushRevocation[]{try{const rows=JSON.parse(localStorage.getItem(REVOKE_KEY)||'[]');return Array.isArray(rows)?rows.filter(r=>typeof r?.userId==='string'&&/^[a-f0-9]{64}$/.test(r.tokenHash)&&Number.isSafeInteger(r.revision)&&r.revision>0).slice(-8):[];}catch{return[];}}
export function queuePushRevocation(row:PushRevocation){const rows=pendingPushRevocations().filter(old=>old.userId!==row.userId||old.tokenHash!==row.tokenHash);localStorage.setItem(REVOKE_KEY,JSON.stringify([...rows,row].slice(-8)));}
export function acknowledgePushRevocation(row:PushRevocation){localStorage.setItem(REVOKE_KEY,JSON.stringify(pendingPushRevocations().filter(old=>old.userId!==row.userId||old.tokenHash!==row.tokenHash||old.revision!==row.revision)));}
