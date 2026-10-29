// Fixtures for scripts/test-company-landscape-ui.mjs: the session, company, trip and ranking stores and the Firestore
// document of the profile covers. __AVATAR__ and __VEHICLE__ are replaced by the test at build time (esbuild define).
import React,{useSyncExternalStore} from 'react';import {useLocation} from 'react-router-dom';
const noop=()=>{},load=async()=>{},empty=[];let version=0;const listeners=new Set();
const avatar=__AVATAR__,vehicleData=__VEHICLE__;
const company={id:'dc',companyName:'DC Transportes',ownerId:'driver',userId:'driver',simulatorId:'gto',simulatorName:'GTO',status:'active',logoUrl:avatar,companyLogoURL:avatar};
const user={id:'driver',name:'David Canto',email:'driver@example.test',profilePhotoURL:avatar,photoURL:avatar,isOnline:true,status:'active',role:'driver',roles:['driver','admin']};
const companies=[company,{...company,id:'second',companyName:'Outra Empresa',simulatorName:'WBDS',simulatorId:'wbds'}];
const loadCatalog=async()=>companies,loadById=async id=>companies.find(c=>c.id===id);
const memberships=companies.map(c=>({id:'driver_'+c.id,companyId:c.id,userId:'driver',status:'active',roles:['admin','driver']}));
const state={activeCompanyId:'dc',empty:false,rankingUnavailable:false,manager:true,theme:'light'};
window.__scenario=next=>{if('empty' in next)state.empty=next.empty;if('rankingUnavailable' in next)state.rankingUnavailable=next.rankingUnavailable;if('jobState' in next)operational.jobs=next.jobState==='none'?[]:[currentJob,...pastJobs];version++;listeners.forEach(fn=>fn());};
function useFixture(){useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>version);}
export function useSessionStore(){useFixture();const location=useLocation();return {currentUser:user,authInitialized:true,sessionUiReady:true,setCurrentUser:noop,activeRole:location.pathname.startsWith('/driver')?'driver':'admin',switchRole:load,logOutApp:load,setSeniorCompanyId:noop,isSeniorAuthenticated:false};}
export function useCompanyStore(){useFixture();return {companies,allCompanies:companies,activeCompanyId:state.activeCompanyId,setActiveCompanyId:id=>window.__scenario({activeCompanyId:id}),memberships,allCompanyMembers:memberships,driverRequests:empty,requestJoinCompany:load,cancelRequestJoinCompany:load,allCompanyMembersReady:true,companiesLoading:false,companyCatalogLoaded:true,companyCatalogAttempted:true,loadCompanyCatalog:loadCatalog,loadCompanyById:loadById,updateCompany:load,createCompany:load,deleteCompany:load,recruitmentApplications:empty};}
const D=(d,h=12,m=0)=>new Date(Date.UTC(2026,9,d,h,m)).toISOString();
const currentJob={id:'job-current',driverId:'driver',companyId:'dc',contractId:'bls',vehicleId:'scania',trailerId:'bitrem',status:'active',requiredTrips:10,totalTrips:10,totalDeliveries:10,progress:6,startedAt:D(27,10),assignedAt:D(27,10),dueAt:D(31,22)};
const pastJobs=Array.from({length:9},(_,i)=>({id:'job-p'+(i+1),driverId:'driver',companyId:'dc',contractId:'bls',vehicleId:i%2?'iveco':'scania',trailerId:'bitrem',status:'completed',totalDeliveries:10,progress:i===2?5:10,assignedAt:D(24-i*2-4,10),completedAt:D(24-i*2,18),dueAt:D(26-i*2,22)}));
const cities=['Curitiba','Joinville','Londrina','Maringá','Cascavel','Chapecó','Lages','Blumenau','Itajaí','Ponta Grossa','Guarapuava','Foz do Iguaçu'];
const mk=(i,jobId,day,hour)=>({id:'trip-'+i,tripId:'trip-'+i,physicalDocumentId:'trip-'+i,companyId:'dc',driverId:'driver',empresaNome:'DC Transportes',motoristaNome:'David Canto',jobId,contractId:'bls',simulatorId:'gto',simulator:'GTO',status:'completed',recordStatus:'completed',serverValidatedAt:D(day,hour),completedAt:D(day,hour),valorCents:i%5===0?3301400:2859800,currency:'BRL',currencyStatus:'known',origem:cities[i%cities.length],destino:cities[(i+3)%cities.length],veiculoNome:'Scania G',reboqueNome:'Bitrem Graneleiro 4 eixos',contratoNome:'BLS - 150',contratoNumero:'BLS - 150',syncStatus:'SERVER_CONFIRMED'});
const profileTrips=[...Array.from({length:6},(_,i)=>mk(i,'job-current',28-(i>>1),22-3*(i%2)-(i>>1))),...Array.from({length:25},(_,i)=>mk(i+6,i<10?'job-p1':i<20?'job-p2':'job-p3',24-Math.floor(i/2),(i%2?9:17)))];
const operational={simulators:[{id:'gto',name:'GTO'},{id:'wbds',name:'WBDS'}],users:[user],jobs:[currentJob,...pastJobs],contracts:[{id:'bls',name:'BLS - 150',companyId:'dc',simulatorId:'gto',totalDeliveries:10,status:'active',mode:'free',deliveries:[]}],vehicles:[{id:'iveco',name:'Iveco S Way',companyId:'dc'},{id:'scania',name:'Scania G',companyId:'dc'}],trailers:[{id:'bitrem',name:'Bitrem Graneleiro 4 eixos',companyId:'dc'}],sequences:empty,jobsReady:true,contractsReady:true,updateUserOnlineStatus:load,requestNewJobDemand:load};
export function useAutomaticOperations(){return null;}export function useOperationRecovery(){return {};}export function useOptionalAutomaticOperations(){return null;}export function useLocalOperationPending(){return 0;}
export function useOperationalStore(){useFixture();return operational;}export function useActivityStore(){return {jobDemands:empty};}export function useRankingFilterStore(){return {setGlobalPeriodPreset:noop};}
export function useNotificationStore(){return {notifications:empty,markNotificationAsRead:load};}
export function useTripHistory(){useFixture();return {historicoTrips:state.empty?empty:profileTrips,loading:false,error:null,coverage:'complete',historyReady:true,readCoverage:null};}export const removeTripHistoryOptimistically=noop,updateTripHistoryOptimistically=noop;
export function useDriverTrips(){useFixture();return {trips:state.empty?empty:profileTrips,loading:false,historyReady:true,coverage:'complete'};}export const publishDriverTripOptimistically=noop,removeDriverTripOptimistically=noop;
export const OperationRecoveryContext=React.createContext(null);export function useMissingOperationTrip(){return {};}export function SimpleAutomationCompletionBridge(){return null;}
export const authPersistenceReady=Promise.resolve();
export const auth={currentUser:{uid:'driver',getIdToken:async()=>'fixture-token'},authStateReady:load},db={},storage={},functions={};
window.__systemBars=[];export const SystemBarsStyle={Dark:'DARK',Light:'LIGHT'},SystemBarType={StatusBar:'StatusBar',NavigationBar:'NavigationBar'};export const SystemBars={setStyle:async value=>{window.__systemBars.push(value);}};export const isNativeAndroid=()=>true;
export function onAuthStateChanged(auth,next){queueMicrotask(()=>next(auth.currentUser));return noop;}
export const preloadRoute=load,preloadFleetPanel=load,preloadRoleRoutes=load,warmRegisteredRankingPhotos=load,waitForRankingWarmup=load,beginRankingWarmupSession=noop;
export function usePersistentRankingImage(src){return {src,onLoad:noop,onError:noop};}
export function CompactProfileEditorModal(){return null;}export function ProfileModal({isOpen,onClose}){return isOpen?<section role='dialog' aria-label='Editar perfil'><button onClick={onClose}>Fechar perfil</button></section>:null;}export function NotificationCenter(){return null;}
export function useVehiclePhoto(identity){return {src:identity?vehicleData:null,pending:false,onImageLoad:noop,onImageError:noop};}
export function useTripsRealtime(){return {trips:empty,loading:false,serverConfirmed:true,refreshing:false,error:null};}
export const getCachedSimpleAutomationCities=()=>[],loadSimpleAutomationCities=async()=>[],prefetchWorkModeAvailability=noop,assertWorkModeEntryAllowed=load,assertServerNewOperationAllowed=load,ensureOperationIntegrity=load;
export function useProfileRanking(query){return {status:state.rankingUnavailable?'unavailable':'ready',simulatorId:'gto',summary:{position:query.scope==='internal'?2:6,total:query.scope==='internal'?4:19,hasActivity:true,isLeader:false,comparableCurrency:true,activeParticipants:4,current:{id:'driver',name:'David Canto',val:query.periodType==='semana'?153026:673026,currency:'BRL',trips:query.periodType==='semana'?5:31},next:null,leader:null,leaderRatio:null}};}
export default function Secondary(){return <section style={{padding:18,minHeight:350}}><p>Conteúdo preservado da página</p></section>;}
const initial={'users/driver':{profileCoverURL:'https://cover-qa.test/initial-driver',profileCoverRevision:'initial-driver'},'frotas/dc':{profileCoverURL:'https://cover-qa.test/initial-company',profileCoverRevision:'initial-company'},'frotas/second':{profileCoverURL:'',profileCoverRevision:'empty'}};
const canonical=()=>initial;const snapshots=new Set();
export async function getDoc(reference){return {exists:()=>true,data:()=>canonical()[reference.path]||{}};}
export function doc(db,collection,id){return {path:collection+'/'+id};}export function serverTimestamp(){return 'SERVER_TIMESTAMP';}
export function onSnapshot(reference,options,next,error){if(typeof options==='function'){error=next;next=options;}let active=true;const emit=()=>{if(active)next({metadata:{fromCache:false,hasPendingWrites:false},exists:()=>true,data:()=>canonical()[reference.path]||{}});};snapshots.add(emit);queueMicrotask(emit);return()=>{active=false;snapshots.delete(emit);};}
export async function updateDoc(){}
export const uploadService={uploadImage:async()=>'https://cover-qa.test/x'};
export const canonicalTripMigrationService={runBackfill:async()=>{throw Error('Unexpected backfill');}},canonicalTripCommandService={},canonicalTripOperationService={},SyncManager={};
export const applyDriverSuspension=async()=>{},deleteTripWithModeration=async()=>{};
export const isSimpleAutomationNativeAvailable=()=>true;export const SimpleAutomation={getReadOnlyProQueueDiagnostics:async()=>({ownerAuthenticated:true,pendingProTrips:[]})};
export const ProPendingAuthButton=()=>null,ProPendingRetryButton=()=>null,ProAttemptDiagnosticDetails=()=>null,FailedHistoryRegistrationRecovery=()=>null,OperationResultModal=()=>null;
export const copySafeDiagnosticToClipboard=async()=>{};
