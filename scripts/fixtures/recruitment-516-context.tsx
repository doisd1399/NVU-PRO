import React, {createContext,useContext,useEffect,useState} from 'react';
import {onSnapshot,collection,doc,query,where} from 'firebase/firestore';
import {auth,db} from '../../src/lib/firebase';
import {manageFleetMembership} from '../../src/services/fleetMembershipService';
const Context=createContext<any>(null);
export const useCompanyStore=()=>useContext(Context);
export const useOperationalStore=()=>useContext(Context);
export const useSessionStore=()=>useContext(Context);
export function QAReadModel({children}:any){
 const [users,setUsers]=useState<any[]>([]),[applications,setApplications]=useState<any[]>([]),[members,setMembers]=useState<any[]>([]);
 useEffect(()=>{const stops=[onSnapshot(collection(db,'users'),s=>setUsers(s.docs.map(d=>({...d.data(),id:d.id})))),onSnapshot(query(collection(db,'recruitment_applications'),where('companyId','==','ui-company516')),s=>setApplications(s.docs.map(d=>({...d.data(),id:d.id})))),onSnapshot(query(collection(db,'companyMembers'),where('companyId','==','ui-company516')),s=>setMembers(s.docs.map(d=>({...d.data(),id:d.id}))))];return()=>stops.forEach(s=>s());},[]);
 const value={currentUser:users.find(u=>u.id===auth.currentUser?.uid),activeCompanyId:'ui-company516',companies:[{id:'ui-company516',companyName:'Empresa QA',simulatorId:'gto'}],users,recruitmentApplications:applications,allCompanyMembers:members,driverRequests:[],jobs:[],contracts:[],
 approveRecruitmentApplication:(applicationId:string,companyId:string)=>manageFleetMembership({action:'approve-application',applicationId,companyId}),
 updateRecruitmentSettings:async()=>{},rejectRecruitmentApplication:async()=>{},deleteRecruitmentApplication:async()=>{}};
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
