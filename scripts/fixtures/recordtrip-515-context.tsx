const currentUser={id:'qa-print-515',uid:'qa-print-515',name:'Motorista QA',email:'qa515@example.test',status:'active',role:'driver',roles:['driver'],companyId:'qa-company-515'};
const company={id:'qa-company-515',ownerId:'qa-owner-515',userId:'qa-owner-515',companyName:'Empresa QA',name:'Empresa QA',status:'active',simulatorId:'gto'};
const membership={id:'qa-print-515_qa-company-515',userId:currentUser.id,companyId:company.id,status:'active',roles:['driver']};
const state:any={currentUser,activeRole:'driver',isSeniorAuthenticated:false,companies:[company],activeCompanyId:company.id,memberships:[membership],allCompanyMembers:[membership],
 jobs:[{id:'qa-job-515',companyId:company.id,driverId:currentUser.id,contractId:'qa-contract-515',status:'active',progress:0,totalDeliveries:10,vehicleId:'qa-vehicle-515',trailerId:'qa-trailer-515',startedAt:'2026-10-24T12:00:00Z'}],
 contracts:[{id:'qa-contract-515',companyId:company.id,name:'Contrato QA',status:'active',totalDeliveries:10,vehicleId:'qa-vehicle-515',trailerId:'qa-trailer-515',mode:'simple'}],
 vehicles:[{id:'qa-vehicle-515',companyId:company.id,name:'Iveco S Way',model:'Iveco S Way',status:'active'}],trailers:[{id:'qa-trailer-515',companyId:company.id,name:'Rodocaçamba 6 eixos',status:'active'}],simulators:[{id:'gto',code:'GTO',name:'GTO'}],simulatorsLoading:false,users:[currentUser],loading:false,trips:[],notifications:[],activities:[]};
export const useSessionStore=()=>state,useCompanyStore=()=>state,useOperationalStore=()=>state,useActivityStore=()=>state,useRankingFilterStore=()=>state;
