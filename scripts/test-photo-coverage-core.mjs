import assert from 'node:assert/strict';
import { auditRankingPhotoCoverage, expectedRankingVehiclePhotos } from '../functions/scripts/photo-coverage-core.mjs';
import { collectPhotoCandidates } from '../functions/scripts/photo-audit-core.mjs';

let passed=0;
const test=async (name, fn) => { await fn(); passed++; console.log('PASS',name); };
const users=[{id:'u1',vehiclePhotosV2:{'gto:truck':{vehicleId:'truck',simulatorId:'gto',url:'https://assets.test/1.png'}}},{id:'u2'},{id:'u3'},{id:'u4'}];
const jobs=[
 {id:'j1',driverId:'u1',vehicleId:'truck',simulatorId:'gto',status:'completed',completedAt:1000},
 {id:'j2',driverId:'u1',vehicleId:'bus',simulatorId:'pbs',status:'completed',completedAt:1200},
 {id:'j3',driverId:'u2',vehicleId:'truck',simulatorId:'gto',status:'completed',completedAt:1000},
 {id:'j4',driverId:'u3',vehicleId:'truck',simulatorId:'gto',status:'completed',completedAt:1000},
 {id:'j5',driverId:'u4',vehicleId:'truck',simulatorId:'gto',status:'completed',completedAt:1000},
];
const p=(userId, simulatorId='gto',vehicleId='truck',url='https://assets.test/photo.png')=>({id:`${userId}:${simulatorId}:${vehicleId}`,userId,simulatorId,vehicleId,url});
const collect = user => collectPhotoCandidates(user.id,user);
const verifyImage = async url => ({valid:!url.includes('/bad'),cors:[{allowed:true}]});
const sources={users,jobs,companies:[],simulators:[],projections:[p('u2'),p('u3','gto','truck','https://assets.test/bad.png'),p('u4','ets2','truck')]};
await test('A01 — global census counts across all participants',async()=>{
 const report=await auditRankingPhotoCoverage(sources,{collect,verifyImage});
 assert.equal(report.expectedIdentities,5); assert.equal(report.counts.LEGACY_VERIFIED_NOT_PROJECTED,1);
 assert.equal(report.counts.PROJECTION_VERIFIED,1); assert.equal(report.counts.PROJECTION_IMAGE_DECODE_OR_DOWNLOAD_FAILED,undefined);
 assert.equal(report.counts.PROJECTION_IMAGE_INVALID,1);
 assert.equal(report.counts.DIFFERENT_SIMULATOR_REFERENCE_REVIEW,1);
 assert.equal(report.counts.PHOTO_REFERENCE_MISSING,1);
 assert.equal(report.actionableVerifiedLegacy,1);
});
await test('A02 — distinct simulator identities are not conflated',async()=>{
 const result=expectedRankingVehiclePhotos('u1',jobs,[],[]);
 assert.deepEqual(result.expected.map(r=>r.simulatorId).sort(),['gto','pbs']);
});
await test('A03 — metadata only never claims image valid',async()=>{
 const report=await auditRankingPhotoCoverage(sources,{collect});
 assert.equal(report.verification,'metadata-only');
 assert.equal(report.actionableVerifiedLegacy,0);
 assert.equal(report.counts.LEGACY_UNVERIFIED_NOT_PROJECTED,1);
});
await test('A04 — census report excludes all owner IDs and signed URLs',async()=>{
 const report=await auditRankingPhotoCoverage(sources,{collect,verifyImage});
 const serialized=JSON.stringify(report);
 for (const token of ['https://assets.test','"u1"','"u2"','"u3"','"u4"','vehiclePhotosV2']) assert.equal(serialized.includes(token),false,token);
});
await test('A05 — conflicting legacy source URLs must not be auto-selected',async()=>{
 const rows=await auditRankingPhotoCoverage({users:[{id:'owner'}],jobs:[{id:'j',driverId:'owner',vehicleId:'truck',simulatorId:'gto',status:'completed'}],projections:[]},
 {collect:()=>[{userId:'owner',simulatorId:'gto',vehicleId:'truck',identityKey:'owner:gto:truck',status:'CANDIDATE',url:'https://a.test/a'},{userId:'owner',simulatorId:'gto',vehicleId:'truck',identityKey:'owner:gto:truck',status:'CANDIDATE',url:'https://a.test/b'}]});
 assert.equal(rows.counts.CONFLICT_LEGACY_SOURCES,1);
});
await test('A06 — contradictory operation simulator identity isolated',async()=>{
 const report=await auditRankingPhotoCoverage({users:[{id:'o'}],companies:[{id:'firm',simulatorId:'pbs'}],jobs:[{id:'j',driverId:'o',simulatorId:'gto',companyId:'firm',vehicleId:'t',status:'completed'}]});
 assert.equal(report.counts.CONFLICT_SIMULATOR_CONTEXT,1); assert.equal(report.expectedIdentities,0);
});
await test('A09 — vehicle simulator evidence is accepted only when explicit',async()=>{
 const jobs=[{id:'j',driverId:'owner',vehicleId:'v',companyId:'firm',status:'completed'}];
 const result=expectedRankingVehiclePhotos('owner',jobs,[{id:'firm',name:'COCAL TRANSPORTE'}],[],[{id:'v',name:'Scania 540',simulatorId:'gto'}]);
 assert.equal(result.expected[0].simulatorId,'gto');
 const conflict=expectedRankingVehiclePhotos('owner',[{...jobs[0],simulatorId:'ats'}],[{id:'firm',name:'COCAL TRANSPORTE'}],[],[{id:'v',name:'Scania 540',simulatorId:'gto'}]);
 assert.equal(conflict.expected.length,0); assert.equal(conflict.unresolved[0].code,'CONFLICT_SIMULATOR_CONTEXT');
});
await test('A07 — no write method required or invoked',async()=>{
 const report=await auditRankingPhotoCoverage(sources,{collect}); assert.equal(report.readOnly,true);
});
await test('A10 — users without eligible operation are explicitly counted, not marked photo success',async()=>{
 const report=await auditRankingPhotoCoverage({users:[{id:'nobody'}]});
 assert.equal(report.usersWithoutRelevantOperation,1);
 assert.equal(report.expectedIdentities,0);
 assert.equal(report.counts.NO_RANKING_VEHICLE_OPERATION,1);
});
await test('A08 — local-only cannot be falsely asserted from backend snapshots',async()=>{
 const report=await auditRankingPhotoCoverage({users:[{id:'owner'}],jobs:[{id:'j',driverId:'owner',simulatorId:'gto',vehicleId:'t',status:'completed'}]});
 assert.equal(report.counts.PHOTO_REFERENCE_MISSING,1); assert.equal(JSON.stringify(report).includes('"LOCAL_ONLY"'),false);
});
console.log(JSON.stringify({passed,failed:0,productionCalls:0}));
