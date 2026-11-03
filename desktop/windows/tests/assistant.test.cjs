
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {Session}=require('../core/session.cjs'),{assistantView,AssistantNotices}=require('../core/assistant.cjs'),{focusGameWindow,focusScript}=require('../core/game-window.cjs');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nvu-assistant-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let time=Date.now(),sequence=0,jobId=randomUUID();const now=()=>time,bootId=randomUUID();
 const scope={driverId:'qa-driver',companyId:'qa-company',jobId:'qa-operation',contractId:'qa-contract',simulatorKey:'ats',operationName:'QA 6 entregas',progress:0,total:6};
 const store=new Session(path.join(dir,'journal.json'),now),file=path.join(dir,'notices.json'),notices=new AssistantNotices(file,now);store.start(scope);
 const heartbeat=(extra={})=>store.heartbeat({version:1,simulatorKey:'ats',bootId,sequence:++sequence,jobId,jobState:'active',pluginVersion:'0.1.2',at:now(),paused:false,origin:'QA origem',destination:'QA destino',...extra});
 const view=(selected=scope,connected=store.connected('ats'))=>assistantView({store,scope:selected,connected,connection:{phase:connected?'connected':'waiting_plugin'},theme:'dark'});
 const update=(selected=scope)=>notices.update({view:view(selected),store,scope:selected,connected:store.connected('ats')});
 const event=()=>({version:1,simulatorKey:'ats',type:'job.delivered',eventId:jobId,capturedAt:now(),origin:'QA origem',destination:'QA destino',amountCents:123450,currency:'USD',distanceKm:242.7});
 const ack=(row,state)=>store.acknowledge(scope.driverId,row.id,{state,tripId:`scs_${scope.driverId}_ats_${row.event.eventId}`,serverValidated:state==='CONFIRMED'});
 return{dir,file,scope,store,notices,now,heartbeat,view,update,event,ack,tick:ms=>time+=ms,next:()=>jobId=randomUUID()};
}
test('Tudo preparado exige frete conectado com rota e vínculo correto, sem bloqueio antigo após novo frete',t=>{
 const f=fixture(t);assert.equal(f.view().freightId,null);assert.equal(f.update(),null);f.heartbeat({origin:''});assert.equal(f.view().freightId,null);
 f.heartbeat();assert.equal(f.view().stage,'ready');assert.match(f.update().title,/Tudo preparado/);assert.equal(f.view(f.scope,false).freightId,null);
 const other={...f.scope,companyId:'qa-other'};f.store.syncScope(other);f.store.start(other);f.heartbeat();assert.equal(f.view(other).freightId,null);assert(!f.update(other)?.title.includes('Tudo preparado'));
 f.next();f.heartbeat();assert.equal(f.store.live.blocked,undefined);assert.equal(f.view(other).stage,'ready');assert.match(f.update(other).title,/Tudo preparado/);
});
test('Captura/envio não anunciam registro; sucesso exige ACK e preserva progresso autoritativo',t=>{
 const f=fixture(t);f.heartbeat();f.update();const row=f.store.ingest(f.event());assert.equal(f.view().freightId,null);assert.equal(f.update().title,'Entrega identificada');
 f.ack(row,'QUEUED');assert.match(f.update().title,/Confirmando/);assert.equal(f.store.live.progress,0);
 f.ack(row,'CONFIRMED');const n=f.update();assert.equal(n.title,'Viagem registrada na NVU');assert.equal(n.trip.amountCents,123450);assert.equal(n.trip.currency,'USD');assert.equal(n.trip.distanceKm,242.7);assert.equal(f.store.live.progress,0);
 f.store.syncScope({...f.scope,progress:1});assert.equal(f.store.live.progress,1);f.tick(12000);f.heartbeat();assert.equal(f.update(),null);f.ack(row,'CONFIRMED');assert.equal(f.update(),null);
 const restarted=new AssistantNotices(f.file,f.now);assert.equal(restarted.update({view:f.view(),store:f.store,scope:f.scope,connected:true}),null);
});
test('Reinício com ACK perdido conserva a viagem e só anuncia sucesso após confirmação',t=>{
 const f=fixture(t);f.heartbeat();f.update();const row=f.store.ingest(f.event());f.ack(row,'QUEUED');f.update();
 const store=new Session(f.store.file,f.now),notices=new AssistantNotices(f.file,f.now),update=()=>notices.update({view:assistantView({store,scope:f.scope,connected:false}),store,scope:f.scope,connected:false});
 assert.match(update().title,/Confirmando/);assert.equal(store.data.events[row.id].state,'QUEUED');store.acknowledge(f.scope.driverId,row.id,{state:'CONFIRMED',tripId:'qa-server-confirmed',serverValidated:true});assert.equal(update().title,'Viagem registrada na NVU');assert.equal(Object.keys(store.data.events).length,1);
});
test('Troca de contexto remove recibos e ACK antigo não aparece em outra operação',t=>{
 const f=fixture(t);f.heartbeat();f.update();const row=f.store.ingest(f.event());f.update();const other={...f.scope,jobId:'qa-other-operation'};f.store.syncScope(other);f.store.start(other);
 const before=f.update(other);assert.equal(before?.trip,undefined);assert.match(before.title,/outra operação/);f.ack(row,'CONFIRMED');const after=f.update(other);assert.equal(after.id,before.id);assert.equal(after.trip,undefined);assert.equal(f.store.data.events[row.id].scope.jobId,f.scope.jobId);
});
test('Entregas consecutivas iguais mantêm cards distintos e removem avisos antigos do mesmo frete',t=>{
 const f=fixture(t);f.heartbeat();f.update();const first=f.store.ingest(f.event());f.ack(first,'CONFIRMED');f.update();f.next();f.heartbeat();f.update();
 const second=f.store.ingest(f.event());f.update();f.ack(second,'QUEUED');f.update();f.ack(second,'CONFIRMED');f.update();
 assert.equal(f.notices.queue.filter(n=>n.trip?.id===second.id).length,1);assert(!f.notices.queue.some(n=>n.freightKey===second.id));f.tick(12000);f.heartbeat();const n=f.update();assert.equal(n.trip.id,second.id);assert.equal(n.title,'Viagem registrada na NVU');assert.equal(Object.keys(f.store.data.events).length,2);
});
test('Cancelamento, pausa e desconexão não são confundidos com entrega',t=>{
 const f=fixture(t);f.heartbeat();f.update();f.heartbeat({jobState:'cancelled',jobId:''});assert.match(f.update().title,/cancelado/);f.store.pause();f.update();assert.equal(f.view().stage,'paused');assert.equal(Object.keys(f.store.data.events).length,0);
 f.store.start(f.scope);f.heartbeat();f.update();f.tick(6000);const n=f.update();assert.match(n.title,/interrompida/);assert(!n.title.includes('registrada'));assert.equal(f.store.live.progress,0);
});
test('Foco usa Win32 só para processos permitidos sem teclas ou comandos arbitrários',async()=>{
 let args;const value=await focusGameWindow('ats',async(...input)=>{args=input;return{stdout:'{"found":true,"focused":true}'};});
 assert.equal(value.focused,true);assert.equal(args[0],'powershell.exe');assert.equal(args[1].at(-2),'-EncodedCommand');
 const script=Buffer.from(args[1].at(-1),'base64').toString('utf16le');assert.match(script,/Get-Process -Name 'amtrucks'/);assert.match(script,/SetForegroundWindow/);assert(!/SendInput|SendKeys|TerminateProcess|AttachThreadInput/.test(script));assert.match(focusScript('ets2'),/eurotrucks2/);
 assert.throws(()=>focusScript("ats'; Remove-Item"),/INVALID/);assert.throws(()=>focusScript('__proto__'),/INVALID/);await assert.rejects(focusGameWindow('ats',async()=>({stdout:'{"found":"true"}'})),/INVALID/);
});
test('Retomada e recuperação substituem avisos transitórios, sem mensagens antigas após o ACK',t=>{
 const f=fixture(t);f.heartbeat();f.update();f.store.pause();assert.equal(f.update().title,'Assistente pausado');f.store.start(f.scope);f.heartbeat();assert.equal(f.update().title,'Assistente retomado');
 f.tick(6000);assert.match(f.update().title,/interrompida/);f.heartbeat();assert.equal(f.update().title,'Conexão restabelecida');
 const row=f.store.ingest(f.event());f.update();f.ack(row,'CONFIRMED');assert.equal(f.update().title,'Viagem registrada na NVU');f.tick(12000);f.heartbeat();assert.equal(f.update(),null);
});


test('Rota atual desaparece no evento local antes do próximo heartbeat e não volta após ACK/reinício',t=>{
 const f=fixture(t);f.heartbeat();assert.equal(f.view().origin,'QA origem');const row=f.store.ingest(f.event());
 for(const state of ['PENDING','QUEUED','CONFIRMED']){if(state!=='PENDING')f.ack(row,state);f.heartbeat();assert.equal(f.view().origin,'');assert.equal(f.view().destination,'');assert.equal(f.view().currentFreightId,null);assert.notEqual(f.view().stage,'ready');}
 const restarted=new Session(f.store.file,f.now);restarted.start(f.scope);const h={...f.store.heartbeats.ats,sequence:999,at:f.now()};restarted.heartbeat(h);const v=assistantView({store:restarted,scope:f.scope,connected:true});assert.equal(v.origin,'');assert.equal(v.recent[0].state,'CONFIRMED');
 f.next();f.heartbeat();assert.equal(f.view().origin,'QA origem');assert.equal(f.view().stage,'ready');
});
test('Heartbeat terminal ou vazio com textos residuais nunca expõe rota ativa',t=>{
 const f=fixture(t);f.heartbeat();for(const jobState of ['delivered','cancelled','idle']){f.heartbeat({jobState});assert.equal(f.view().origin,'');assert.equal(f.view().destination,'');assert.equal(f.view().freightId,null);}
 f.heartbeat({jobId:''});assert.equal(f.view().currentFreightId,null);f.heartbeat();f.tick(6000);assert.equal(f.view().origin,'');
});
test('Distâncias do SDK são opcionais, limitadas, e desaparecem com a entrega ou outro contexto',t=>{
 const f=fixture(t);f.heartbeat({remainingDistanceKm:160.9344,plannedDistanceKm:245});assert.equal(f.view().remainingDistanceKm,160.9344);assert.equal(f.view().plannedDistanceKm,245);
 f.heartbeat({remainingDistanceKm:0});assert.equal(f.view().remainingDistanceKm,0);assert.equal(f.view().plannedDistanceKm,null);
 assert.equal(f.heartbeat({remainingDistanceKm:-1}),false);assert.equal(f.heartbeat({plannedDistanceKm:'120'}),false);assert.equal(f.heartbeat({remainingDistanceKm:50001}),false);
 f.heartbeat({remainingDistanceKm:null,plannedDistanceKm:245});assert.equal(f.view().remainingDistanceKm,null);
 f.store.ingest(f.event());assert.equal(f.view().remainingDistanceKm,null);assert.equal(f.view().plannedDistanceKm,null);
});
