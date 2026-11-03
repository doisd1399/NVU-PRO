
const surface=new URLSearchParams(location.search).get('surface')==='notice'?'notice':'panel';
document.body.dataset.surface=surface;
const get=id=>document.getElementById(id);
let state={},busy=false,context='';
const money=t=>t.amountCents&&t.currency?new Intl.NumberFormat('pt-BR',{style:'currency',currency:t.currency}).format(t.amountCents/100):'Valor a conferir';
const formatDistance=(km,unit='km')=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(unit==='mi'?km/1.609344:km)+' '+unit;
const distance=t=>Number.isFinite(t.distanceKm)&&t.distanceKm>0?formatDistance(t.distanceKm,state.simulatorKey==='ats'?'mi':'km'):'';
const labels={CONFIRMED:'Confirmada na NVU',QUEUED:'Aguardando confirmação',PENDING:'Salva neste computador',REVIEW:'Conferência necessária'};
async function call(action){
 try{get('feedback').textContent='';return await window.overlay.command(action,state.contextKey);}
 catch(error){get('feedback').textContent=String(error.message||'Não foi possível executar a ação.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');return{failed:true};}
}
async function perform(action){if(busy)return;busy=true;render(state);await call(action);busy=false;render(state);}
for(const action of['panel','trips','stop','setup','game','theme'])get(action).onclick=()=>void perform(action);
get('collapse').onclick=()=>void call('collapse');get('pause').onclick=()=>void perform(state.enabled?'pause':'resume');
for(const button of document.querySelectorAll('button'))button.tabIndex=-1;
function showTab(next,clicked=true){for(const value of['overview','activity']){get(value).hidden=value!==next;get(value+'-tab').setAttribute('aria-selected',String(value===next));get(value+'-tab').dataset.clicked=String(clicked&&value===next);}}
get('overview-tab').onclick=()=>showTab('overview');get('activity-tab').onclick=()=>showTab('activity');
// The assistant is intentionally mouse-only. Ctrl+N belongs to the native global shortcut.
document.addEventListener('keydown',event=>{if(surface==='panel'&&!(event.ctrlKey&&!event.altKey&&!event.metaKey&&event.key.toLowerCase()==='n'))event.preventDefault();});
let drag=null;
const header=document.querySelector('.window-header'),card=get('assistant');
header.addEventListener('pointerdown',event=>{if(surface!=='panel'||event.button!==0||event.target.closest('button'))return;const b=card.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:b.left,top:b.top};header.dataset.dragging='true';header.setPointerCapture(event.pointerId);event.preventDefault();});
header.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;card.style.left=Math.round(Math.max(0,Math.min(innerWidth-card.offsetWidth,drag.left+event.clientX-drag.x)))+'px';card.style.top=Math.round(Math.max(0,Math.min(innerHeight-card.offsetHeight,drag.top+event.clientY-drag.y)))+'px';});
async function finishDrag(event){if(!drag||event.pointerId!==drag.id)return;const b=card.getBoundingClientRect();drag=null;header.dataset.dragging='false';header.releasePointerCapture(event.pointerId);try{await window.overlay.move?.({x:Math.round((state.panelLayout?.area.x||0)+b.left),y:Math.round((state.panelLayout?.area.y||0)+b.top)});}catch{get('feedback').textContent='Não foi possível salvar a posição do assistente.';}}
header.addEventListener('pointerup',finishDrag);header.addEventListener('pointercancel',finishDrag);
function renderTrips(rows){
 const fragment=document.createDocumentFragment();
 for(const row of rows||[]){
  const card=document.createElement('article');card.className='trip-row';card.dataset.tripId=row.id;
  const title=document.createElement('h3');title.textContent=`${row.origin||'Origem a conferir'} → ${row.destination||'Destino a conferir'}`;title.title=title.textContent;
  const meta=document.createElement('div');meta.className='trip-meta';const amount=document.createElement('strong');amount.textContent=money(row);const km=document.createElement('span');km.textContent=distance(row);
  const badge=document.createElement('span');badge.className='trip-status';badge.dataset.state=row.state;badge.textContent=labels[row.state]||'Em acompanhamento';
  meta.append(amount,km);card.append(title,meta,badge);fragment.append(card);
 }
 get('trip-list').replaceChildren(fragment);get('empty-trips').hidden=!!rows?.length;
}
function render(s){
 state=s;document.documentElement.classList.toggle('dark',s.theme==='dark');
 if(surface==='notice'){
  const n=s.notice;get('notice-card').hidden=!n;if(!n)return;
  get('notice-card').dataset.kind=n.kind;get('notice-symbol').textContent=n.kind==='success'?'✓':n.kind==='warning'?'!':n.kind==='progress'?'↥':'→';
  get('notice-operation').textContent=s.name||'';get('notice-title').textContent=n.title;get('notice-message').textContent=n.message;
  const route=n.trip||n.route;get('notice-route').hidden=!route?.origin||!route?.destination;get('notice-origin').textContent=route?.origin||'';get('notice-destination').textContent=route?.destination||'';
  get('notice-details').hidden=!n.trip;get('notice-amount').textContent=n.trip?money(n.trip):'';get('notice-distance').textContent=n.trip?distance(n.trip):'';get('notice-badge').textContent=n.trip?labels[n.trip.state]||'':'';return;
 }
 if(context!==s.contextKey){context=s.contextKey;showTab('overview',false);get('feedback').textContent='';}
 const view=s.assistant||{};
 if(!drag){const l=s.panelLayout||{x:12,y:12,width:Math.min(400,innerWidth-24),height:Math.min(560,innerHeight-24)};card.style.left=Math.max(0,Math.min(innerWidth-l.width,l.x))+'px';card.style.top=Math.max(0,Math.min(innerHeight-l.height,l.y))+'px';card.style.width=Math.min(l.width,innerWidth)+'px';card.style.height=Math.min(l.height,innerHeight)+'px';document.body.dataset.density=l.height<490?'tight':l.height<570?'compact':'normal';}
 get('theme').textContent=s.theme==='dark'?'☀':'☾';get('theme').setAttribute('aria-label',s.theme==='dark'?'Alterar para tema claro':'Alterar para tema escuro');get('theme').disabled=busy;
 const hasFreight=!!view.currentFreightId;
 get('current-distance').textContent=!hasFreight?'':Number.isFinite(view.remainingDistanceKm)?'Restam '+formatDistance(view.remainingDistanceKm,s.simulatorKey==='ats'?'mi':'km'):Number.isFinite(view.plannedDistanceKm)?'Rota '+formatDistance(view.plannedDistanceKm,s.simulatorKey==='ats'?'mi':'km'):'Distância indisponível';
 get('name').textContent=s.name||'Selecione uma operação';get('name').title=get('name').textContent;
 get('simulator').textContent=s.simulatorKey?.toUpperCase()||'PRO';get('connection-dot').dataset.connected=String(!!s.connected);
 get('connection').textContent=s.connected?`${s.simulatorKey?.toUpperCase()||'Simulador'} conectado${s.paused?' · pausado no jogo':''}`:'Aguardando conexão com o simulador';
 get('progress').textContent=`${s.progress||0}/${s.total||0} entregas confirmadas`;get('pending').textContent=s.pending?`${s.pending} pendente${s.pending===1?'':'s'}`:'';
 get('progress-bar').max=Math.max(1,s.total||0);get('progress-bar').value=s.progress||0;
 get('journey-state').dataset.stage=view.stage||'inactive';get('stage-icon').textContent=view.stage==='complete'?'✓':['review','waiting'].includes(view.stage)?'!':'→';
 get('stage-title').textContent=view.title||'Seu assistente de viagem';get('message').textContent=view.message||'Ative o PRO para acompanhar suas entregas.';
 get('route').hidden=!hasFreight||!view.origin||!view.destination;get('origin').textContent=view.origin||'';get('destination').textContent=view.destination||'';get('origin').title=view.origin||'';get('destination').title=view.destination||'';
 get('current-distance').title=hasFreight?'Distância restante do GPS ou distância planejada do frete. A distância percorrida é confirmada após a entrega.':'';
 get('pause-label').textContent=s.enabled?'Pausar assistente':s.active?'Retomar assistente':'Ativar PRO';get('pause').disabled=busy||!s.ready;get('stop').disabled=busy||!s.active;
 get('game-label').textContent=`${s.connected?'Voltar ao':'Abrir'} ${s.simulatorKey?.toUpperCase()||'simulador'}`;get('game').disabled=busy||!['ats','ets2'].includes(s.simulatorKey);
 for(const id of['panel','trips','setup'])get(id).disabled=busy||(id==='trips'&&!s.total);
 get('automation-state').textContent=s.enabled?'Acompanhamento ativo':s.active?'Acompanhamento pausado':'Assistente desativado';
 const latest=view.recent?.find(row=>row.state==='CONFIRMED');get('latest-confirmation').hidden=!latest;get('latest-route').textContent=latest?`${latest.origin} → ${latest.destination}`:'';get('latest-amount').textContent=latest?money(latest):'';get('latest-distance').textContent=latest?distance(latest):'';
 renderTrips(view.recent);
}
window.overlay.onUpdate(render);

