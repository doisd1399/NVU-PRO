import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import '../../src/components/driver/DriverWorkspace.css';
import {DriverActivityRow} from '../../src/components/driver/DriverActivityRow';
import {useLocalTripHistory} from '../../src/hooks/useLocalTripHistory';
import {filterAndSortTripHistory,summarizeTripHistory} from '../../src/lib/tripHistoryEngine';
import {mergePendingHistoryTrips} from '../../src/lib/pendingHistoryTrips';
import {OfflineDatabase} from '../../src/services/offline/OfflineDatabase';
import {SyncEngine} from '../../src/services/sync/SyncEngine';
import {CanonicalTripRepository} from '../../src/repositories/CanonicalTripRepository';
import {CanonicalTripCommandService} from '../../src/application/trip/CanonicalTripCommandService';
import {OfflineFirstCanonicalTripGateway} from '../../src/application/trip/persistence/OfflineFirstCanonicalTripGateway';
import {TripRegistrationService} from '../../src/application/trip/TripRegistrationService';
import {persistOfflineReceipt} from '../../src/lib/offlineReceiptStore';
const scope={uid:'driver513',companyId:'company513',jobId:'job513',contractId:'contract513'};
let release!:()=>void,uploadCalls=0;const held=new Promise<void>(resolve=>release=resolve);
const database=new OfflineDatabase();
const engine=new SyncEngine({offlineDatabase:database,getCurrentUser:()=>({uid:scope.uid}),operationStartPending:()=>false,adapter:{push:async trip=>{
 uploadCalls++;await held;
 if(location.search.includes('refused'))throw Object.assign(new Error('server domain refusal'),{code:'functions/invalid-argument',details:{retryable:false}});
 return {confirmed:true,tripId:trip.tripId,data:{...trip,serverValidatedAt:new Date().toISOString()}};
}}});
const repo=new CanonicalTripRepository({database,queue:engine});
const command=new CanonicalTripCommandService(new OfflineFirstCanonicalTripGateway(repo as any),{getCurrentUser:()=>({uid:scope.uid}),isOffline:()=>navigator.onLine===false,sync:engine});
function App(){
 const [error,setError]=useState(''),[selected,setSelected]=useState('');
 const local=useLocalTripHistory(scope.companyId,undefined,scope.uid,engine);
 const trips=filterAndSortTripHistory(mergePendingHistoryTrips([],local),{includePending:true});
 const summary=summarizeTripHistory(trips);
 const save=async()=>{try{
  const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),x=>x.charCodeAt(0));
  const key=await persistOfflineReceipt(new File([png],'comprovante.png',{type:'image/png'}),{imageHash:'print-browser513',companyId:scope.companyId,userId:scope.uid});
  await command.addTripWithinOperationLimit(TripRegistrationService.register({tripId:'print-browser513',idempotencyKey:'print-browser513',jobId:scope.jobId,companyId:scope.companyId,driverId:scope.uid,contractId:scope.contractId,contratoNumero:'Contrato de teste',origem:'PR',destino:'SP',valor:10400,valorCents:1040000,currency:'BRL',recordStatus:'concluida',createdAtLocal:new Date().toISOString(),offlineReceiptKey:key,imageHash:'print-browser513'}),{waitForServerAck:false});
 }catch(e){setError(String(e))}};
 (window as any).__nvu513={engine,database,release,sync:()=>engine.synchronize(),get uploadCalls(){return uploadCalls},trips,summary};
 return <main className="nvu-driver-workspace" style={{maxWidth:440,margin:'20px auto',padding:16}}>
  <h1 style={{fontSize:20,fontWeight:700,marginBottom:12}}>Histórico de viagens</h1>
  <div className="nvu-driver-activity-list">{trips.map(trip=><DriverActivityRow key={trip.id} trip={trip} company={{companyName:'Empresa de teste'}} onDetails={()=>setSelected(`${trip.origem} → ${trip.destino}`)} />)}</div>
  <p data-testid="confirmed-count" style={{margin:'16px 0'}}>Confirmadas: {summary.totalViagens}</p><p>{selected}</p><p role="alert">{error}</p>
  <button type="button" onClick={()=>void save()}>Lançar viagem</button>
  <button type="button" onClick={()=>void engine.synchronize()} style={{marginLeft:14}}>Sincronizar</button>
 </main>;
}
createRoot(document.getElementById('test-root')!).render(<App/>);
