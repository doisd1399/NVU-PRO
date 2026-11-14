
const fs = require('node:fs');
const { atomic, sameScope, validScope } = require('./session.cjs');
const contextOf = s => validScope(s) ? JSON.stringify([s.driverId,s.companyId,s.jobId,s.contractId,s.simulatorKey]) : '';
function tripSummary(row) {
  const e=row.event;
  return { id:row.id, state:row.state==='CONFIRMED'&&row.tripId?'CONFIRMED':row.state==='CONFIRMED'?'REVIEW':row.state,
    tripId:row.tripId||null,capturedAt:e.capturedAt,origin:String(e.origin||'').slice(0,180),destination:String(e.destination||'').slice(0,180),
    amountCents:Number.isSafeInteger(e.amountCents)&&e.amountCents>0?e.amountCents:null,
    currency:['USD','EUR'].includes(e.currency)?e.currency:null,distanceKm:Number.isFinite(e.distanceKm)&&e.distanceKm>0?e.distanceKm:null };
}
function assistantView({store,scope,connected,connection,theme='light'}) {
  const s=store.live||scope,h=store.heartbeats[s?.simulatorKey];
  const rows=Object.values(store.data.events).filter(r=>sameScope(r.scope,s)).sort((a,b)=>b.event.capturedAt-a.event.capturedAt);
  const bound=!!h?.jobId&&sameScope(store.data.bindings[`${s?.simulatorKey}:${h.jobId}`],s);
  const currentFreight=!!store.live&&connected&&connection?.phase!=='plugin_restart'&&bound&&h.jobState==='active'
    &&!store.live.blocked&&!store.data.events[`${s.simulatorKey}:${h.jobId}`]&&!!h.origin?.trim()&&!!h.destination?.trim();
  const freightReady=currentFreight&&!!store.live.enabled;
  const distanceValue=(key,zero=false)=>currentFreight&&Number.isFinite(h[key])&&h[key]>=(zero?0:0.001)&&h[key]<=50000?h[key]:null;
  const latest=rows.find(r=>r.state!=='CONFIRMED');
  let stage='inactive',title='Seu assistente de viagem',message='Selecione uma operação e ative o PRO para acompanhar suas entregas.';
  if(store.live?.blocked){stage='review';title='Este frete pertence a outra operação';message=store.live.blocked;}
  else if(store.live&&!store.live.enabled){stage='paused';title='Assistente pausado';message='Retome o PRO para acompanhar novas entregas.';}
  else if(store.live&&connection?.phase==='plugin_restart'){stage='waiting';title='Atualize o plugin e reinicie o simulador';message=connection.message||'Feche o jogo e atualize a integração em PRO → Simuladores.';}
  else if(store.live&&!connected){stage='waiting';title='Vamos conectar o simulador';message=connection?.message||'Abra o simulador. O PRO está aguardando a conexão.';}
  else if(store.live&&h?.jobState==='cancelled'){stage='cancelled';title='Frete cancelado no jogo';message='Aguardando o próximo frete. Nenhuma entrega foi registrada pelo cancelamento.';}
  else if(freightReady){stage='ready';title='Tudo preparado. Podemos partir.';message=h.paused?'Frete identificado. O acompanhamento continua quando você voltar ao jogo.':'O PRO acompanha este frete e registra a entrega ao concluir.';}
  else if(latest?.state==='REVIEW'){stage='review';title='Uma viagem precisa de conferência';message='Confira os dados e o comprovante no painel NVU. A viagem está preservada.';}
  else if(latest){stage=latest.state==='QUEUED'?'sending':'saved';title=latest.state==='QUEUED'?'Confirmando sua viagem':'Viagem salva neste computador';message='O envio continua em segundo plano. A confirmação aparecerá aqui.';}
  else if(store.live){stage='waiting_freight';title='Aguardando seu próximo frete';message='Selecione um frete no simulador. A NVU avisa quando estiver preparado.';}
  if(validScope(s)&&s.total>0&&s.progress>=s.total){stage='complete';title='Meta de entregas atingida';message='Finalize a operação pelo painel NVU para concluir o trabalho.';}
  return {theme:theme==='dark'?'dark':'light',context:contextOf(s),stage,title,message,freightId:freightReady?h.jobId:null,
    blocked:store.live?.blocked||'',blockedFreightId:h?.jobId||'',origin:currentFreight?h.origin:'',destination:currentFreight?h.destination:'',
    currentFreightId:currentFreight?h.jobId:null,remainingDistanceKm:distanceValue('remainingDistanceKm',true),plannedDistanceKm:distanceValue('plannedDistanceKm'),
    recent:rows.slice(0,20).map(tripSummary),pending:rows.filter(r=>r.state!=='CONFIRMED').length};
}
class AssistantNotices{
  constructor(file,now=Date.now){
    Object.assign(this,{file,now});this.context='';this.current=null;this.queue=[];this.previous=null;this.states=new Map();this.seen={};
    try{const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.version===1&&data.seen&&typeof data.seen==='object')this.seen=data.seen;}catch{/* Optional presentation cache; journal remains authoritative. */}
  }
  remember(id){
    this.seen[id]=this.now();this.seen=Object.fromEntries(Object.entries(this.seen).sort((a,b)=>b[1]-a[1]).slice(0,3000));
    try{atomic(this.file,{version:1,seen:this.seen});}catch{/* A toast cache cannot interrupt recording. */}
  }
  push(value){
    if(value.once&&this.seen[value.id])return;if(value.once)this.remember(value.id);
    if(value.channel){this.queue=this.queue.filter(n=>n.channel!==value.channel);if(this.current?.channel===value.channel)this.current=null;}
    if(value.trip){
      this.queue=this.queue.filter(n=>n.trip?.id!==value.trip.id&&n.freightKey!==value.trip.id);
      if(this.current?.trip?.id===value.trip.id||this.current?.freightKey===value.trip.id)this.current=null;
    }
    const notice={...value,createdAt:this.now(),context:this.context,duration:value.duration||6500};
    if(!this.current||this.current.expiresAt<=this.now()||notice.priority>this.current.priority)this.current={...notice,expiresAt:this.now()+notice.duration};
    else{this.queue=this.queue.filter(n=>n.id!==notice.id);this.queue.push(notice);this.queue.sort((a,b)=>b.priority-a.priority);this.queue=this.queue.slice(0,8);}
  }
  update({view,store,scope,connected}){
    const selected=store.live||scope,context=contextOf(selected),active=!!store.live,enabled=!!store.live?.enabled,changed=context!==this.context;
    if(changed){this.context=context;this.current=null;this.queue=[];this.previous=null;this.states.clear();}
    if(!context)return null;
    if(!active){this.queue=this.queue.filter(n=>n.channel!=='automation');if(this.current?.channel==='automation')this.current=null;}
    if(!view.freightId){this.queue=this.queue.filter(n=>n.kind!=='ready');if(this.current?.kind==='ready')this.current=null;}
    const rows=Object.values(store.data.events).filter(r=>sameScope(r.scope,selected));
    if(changed)for(const row of rows)if(row.state==='CONFIRMED')this.states.set(row.id,row.state);
    for(const row of rows.sort((a,b)=>a.event.capturedAt-b.event.capturedAt)){
      const old=this.states.get(row.id);this.states.set(row.id,row.state);if(old===row.state)continue;const trip=tripSummary(row);
      if(trip.state==='CONFIRMED')this.push({id:`confirmed:${row.id}`,once:true,kind:'success',title:'Viagem registrada na NVU',message:'Entrega confirmada pelo sistema.',trip,priority:100,duration:11000});
      else if(trip.state==='REVIEW')this.push({id:`review:${row.id}`,once:true,kind:'warning',title:'Vamos conferir esta viagem',message:'Os dados foram preservados. Confira o comprovante no painel NVU.',trip,priority:85,duration:9000});
      else this.push({id:`${trip.state}:${row.id}`,kind:'progress',title:trip.state==='QUEUED'?'Confirmando sua viagem…':'Entrega identificada',message:trip.state==='QUEUED'?'Viagem salva. Aguardando a confirmação do sistema.':'Viagem salva neste computador. O envio continua em segundo plano.',trip,priority:60});
    }
    if(view.blocked)this.push({id:`blocked:${context}:${view.blockedFreightId}`,once:true,channel:'freight',kind:'warning',title:'Este frete pertence a outra operação',message:'Conclua o frete no contexto original ou selecione um novo frete para esta operação.',priority:85,duration:9000});
    if(view.freightId)this.pushOnceReady(view,selected);
    if(this.previous){
      if(active&&enabled&&this.previous.connected&&!connected)this.push({id:`disconnected:${this.now()}`,channel:'connection',kind:'warning',title:'Conexão com o jogo interrompida',message:'Aguardando o simulador. As viagens salvas continuam preservadas.',priority:80});
      if(active&&enabled&&!this.previous.connected&&connected)this.push({id:`reconnected:${this.now()}`,channel:'connection',kind:'info',title:'Conexão restabelecida',message:view.freightId?'O PRO voltou a acompanhar o frete atual.':'O PRO está pronto para acompanhar o próximo frete.',priority:35});
      if(active&&this.previous.enabled!==enabled)this.push({id:`enabled:${this.now()}`,channel:'automation',kind:'info',title:enabled?this.previous.active?'Assistente retomado':'Assistente ativado':'Assistente pausado',message:enabled?'O acompanhamento do frete está ativo.':'Retome o PRO antes de concluir novas entregas.',priority:45});
      if(active&&this.previous.stage!=='cancelled'&&view.stage==='cancelled')this.push({id:`cancelled:${this.now()}`,channel:'freight',kind:'info',title:'Frete cancelado no simulador',message:'Nenhuma entrega foi registrada. Aguardando um novo frete.',priority:55});
      if(view.stage==='complete'&&this.previous.stage!=='complete')this.push({id:`goal:${context}`,once:true,kind:'success',title:'Meta de entregas atingida',message:'Finalize o trabalho no painel NVU para concluir a operação.',priority:90,duration:9500});
    }
    this.previous={active,enabled,connected,stage:view.stage};
    if(this.current&&this.current.expiresAt<=this.now())this.current=null;
    this.queue=this.queue.filter(n=>n.trip?.state==='CONFIRMED'||this.now()-n.createdAt<n.duration);
    if(!this.current&&this.queue.length){const n=this.queue.shift();this.current={...n,expiresAt:this.now()+n.duration};}
    return this.current;
  }
  pushOnceReady(view,scope){
    const id=`ready:${contextOf(scope)}:${view.freightId}`;if(this.seen[id])return;
    this.push({id,once:true,channel:'freight',kind:'ready',title:'Tudo preparado. Podemos partir.',message:'Frete identificado. A NVU acompanha a viagem até a entrega.',freightKey:`${scope.simulatorKey}:${view.freightId}`,route:{origin:view.origin,destination:view.destination},priority:70,duration:8000});
  }
}
module.exports={assistantView,AssistantNotices,contextOf,tripSummary};

