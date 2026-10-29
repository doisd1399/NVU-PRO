import { auth, functions } from './firebase';
import { Capacitor } from '@capacitor/core';
import { httpsCallable } from 'firebase/functions';
import { isAuthTeardownActive } from './authLifecycle';
import {reservePushRevision,pushTokenHash,rememberPushDevice,rememberedPushDevice,forgetPushDevice,pendingPushRevocations,queuePushRevocation,acknowledgePushRevocation} from './pushDeviceState';
export type PushContext = { userId?: string | null; companyId?: string | null; activeProfile?: string | null };
let cachedToken: string | null = null;
let registrationPromise: Promise<void> | null = null;
let setupPromise: Promise<void> | null = null;
let lastContext: PushContext = {};
let generation = 0, retryAttempt = 0;
let savedKey = '', nativePending = false, resumeListenersAdded = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
const saves = new Map<string, Promise<void>>();
const key = (context: PushContext, token = cachedToken) => JSON.stringify([context.userId, context.companyId ?? null, context.activeProfile ?? null, token]);
const active = (epoch: number, uid = lastContext.userId) => epoch === generation && !!uid && auth.currentUser?.uid === uid && !isAuthTeardownActive();
const clearRetry = () => { if (retryTimer) clearTimeout(retryTimer); retryTimer = null; };
function scheduleRetry() {
  if (retryTimer || retryAttempt >= 3 || !active(generation)) return;
  const epoch = generation;
  retryTimer = setTimeout(() => { retryTimer = null; if (active(epoch)) void registerDeviceForPush(); }, 1500 * 2 ** retryAttempt++);
  (retryTimer as any).unref?.();
}
async function saveToken(context: PushContext, token: string, epoch: number) {
  const fingerprint = key(context, token), id = JSON.stringify([epoch, fingerprint]);
  if (!active(epoch, context.userId) || savedKey === fingerprint) return;
  const prior = saves.get(id); if (prior) return prior;
  const work = (async () => {
    let minimum=0;
    for(let attempt=0;attempt<2;attempt++){
      if(!active(epoch,context.userId))return;
      const revision=reservePushRevision(minimum);
      const response=await httpsCallable(functions,'registerPushDevice')({token,revision,protocolVersion:2,platform:Capacitor.getPlatform(),companyId:context.companyId??null,activeProfile:context.activeProfile??null});
      if(!active(epoch,context.userId))return;
      const result=response.data as {success?:boolean;stale?:boolean;minimumRevision?:number;tokenHash?:string};
      if(result?.stale&&Number.isSafeInteger(result.minimumRevision)){minimum=result.minimumRevision!;continue;}
      if(!result?.success)throw Error('PUSH_REGISTRATION_NOT_CONFIRMED');
      const tokenHash=result.tokenHash||await pushTokenHash(token);
      if(!active(epoch,context.userId))return;
      rememberPushDevice(context.userId!,tokenHash);savedKey=fingerprint;retryAttempt=0;clearRetry();return;
    }
    throw Error('PUSH_REGISTRATION_SUPERSEDED');
  })();
  saves.set(id, work);
  try { await work; } finally { if (saves.get(id) === work) saves.delete(id); }
}
async function flushRevocations(){
  for(const row of pendingPushRevocations()){
    if(auth.currentUser?.uid!==row.userId||isAuthTeardownActive())continue;
    try{await httpsCallable(functions,'revokePushDevice')({tokenHash:row.tokenHash,revision:row.revision});acknowledgePushRevocation(row);}catch{/* Keep the queued revocation; a newer registration remains independent. */}
  }
}
async function setup() {
  if (setupPromise) return setupPromise;
  const work = (async () => {
    const { PushNotifications: push } = await import('@capacitor/push-notifications');
    await push.removeAllListeners();
    await push.addListener('registration', token => {
      nativePending = false; if (pendingTimer) clearTimeout(pendingTimer); pendingTimer = null;
      if (!active(generation)) return;
      cachedToken = token.value;
      const epoch = generation;
      void saveToken({...lastContext},token.value,epoch).catch(() => { if (active(epoch)) scheduleRetry(); });
    });
    await push.addListener('registrationError', () => { nativePending = false; if (pendingTimer) clearTimeout(pendingTimer); pendingTimer = null; scheduleRetry(); });
    await push.addListener('pushNotificationReceived', notification => {
      if (active(generation)) window.dispatchEvent(new CustomEvent('nvu-push-received',{detail:notification}));
    });
    await push.addListener('pushNotificationActionPerformed', action => {
      if (!isAuthTeardownActive()) window.dispatchEvent(new CustomEvent('nvu-push-opened',{detail:action}));
    });
    if (Capacitor.getPlatform() === 'android') await push.createChannel({id:'nvu_notifications',name:'NVU',description:'Notificações operacionais',importance:4,visibility:1,vibration:true});
    if (!resumeListenersAdded) {
      const resume = () => { if (active(generation)) { retryAttempt=0;clearRetry();void registerDeviceForPush(); } };
      window.addEventListener('online',resume);
      document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resume();});
      resumeListenersAdded=true;
      try { const {App}=await import('@capacitor/app');await App.addListener('appStateChange',state=>{if(state.isActive)resume();}); } catch { /* Online/visibility still recover older bridges. */ }
    }
  })();
  setupPromise=work;
  try { await work; } catch(error) {if(setupPromise===work)setupPromise=null;throw error;}
}
export async function registerDeviceForPush(context?: PushContext): Promise<void> {
  if (!Capacitor.isNativePlatform() || isAuthTeardownActive()) return;
  const next=context?{...lastContext,...context}:lastContext;
  const changed=key(next,null)!==key(lastContext,null);
  if(changed){generation++;savedKey='';retryAttempt=0;clearRetry();}
  lastContext=next;const epoch=generation;
  if(!active(epoch))return;
  if(registrationPromise){await registrationPromise;if(changed&&active(epoch))return registerDeviceForPush();return;}
  const work=(async()=>{
    try {
      await setup();if(!active(epoch))return;
      void flushRevocations();
      const {PushNotifications:push}=await import('@capacitor/push-notifications');
      let permission=await push.checkPermissions();if(!active(epoch))return;
      if(permission.receive==='prompt'||permission.receive==='prompt-with-rationale')permission=await push.requestPermissions();
      if(!active(epoch)||permission.receive!=='granted')return;
      if(cachedToken)await saveToken({...lastContext},cachedToken,epoch);
      if(!active(epoch)||nativePending)return;
      nativePending=true;
      pendingTimer=setTimeout(()=>{nativePending=false;pendingTimer=null;scheduleRetry();},10000);
      (pendingTimer as any).unref?.();
      try{await push.register();}catch(error){nativePending=false;if(pendingTimer)clearTimeout(pendingTimer);pendingTimer=null;throw error;}
    }catch{if(active(epoch)){console.warn('[NVU PUSH] Registro indisponível; nova tentativa limitada será feita.');scheduleRetry();}}
  })();
  registrationPromise=work;
  // Never retain an already settled promise: denial/failure must be recoverable.
  try{await work;}finally{if(registrationPromise===work)registrationPromise=null;}
}
export function clearPushRegistrationContext():Promise<void>{
  const uid=auth.currentUser?.uid||lastContext.userId,token=cachedToken,remembered=rememberedPushDevice();
  let revision:number|null=null;try{if(uid)revision=reservePushRevision();}catch{/* Native deletion still runs if local storage is unavailable. */}
  generation++;lastContext={};cachedToken=null;savedKey='';nativePending=false;
  registrationPromise=null;clearRetry();if(pendingTimer)clearTimeout(pendingTimer);pendingTimer=null;
  try{forgetPushDevice();}catch{/* Logout must proceed. */}
  const revoke=(async()=>{
    if(!uid||!revision)return;
    const tokenHash=remembered?.userId===uid?remembered.tokenHash:token?await pushTokenHash(token):null;
    if(!tokenHash)return;const row={userId:uid,tokenHash,revision};
    try{queuePushRevocation(row);}catch{/* Still attempt the online revocation. */}
    if(auth.currentUser?.uid!==uid)return;
    await httpsCallable(functions,'revokePushDevice')({tokenHash,revision});acknowledgePushRevocation(row);
  })();
  const native=(async()=>{
    if(!Capacitor.isNativePlatform())return;
    const {PushNotifications:push}=await import('@capacitor/push-notifications');
    await Promise.allSettled([push.unregister(),push.removeAllDeliveredNotifications()]);
  })();
  // Keep the old Auth session long enough for revocation without an unbounded UI wait.
  let timeout:ReturnType<typeof setTimeout>;
  return Promise.race([Promise.allSettled([revoke,native]),new Promise<void>(resolve=>{timeout=setTimeout(resolve,2500);})]).then(()=>undefined).finally(()=>clearTimeout(timeout));
}
