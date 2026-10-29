import assert from 'node:assert/strict';
import { scanPhotoUsers } from '../functions/scripts/photo-audit-core.mjs';
const row={userId:'owner',simulatorId:'gto',vehicleId:'truck',identityKey:'owner:gto:truck',status:'CANDIDATE',source:'vehiclePhotosV2',url:'https://photos.test/vehicle.webp'};
let writes=0;
const adapter=(verify)=>({
 listUsers:async(after)=>after?[]:[{id:'owner'}],
 collect:()=>[row],
 getProjection:async()=>null,
 verifyImage:async()=>verify,
 createProjection:async()=>{writes++;},
});
const denied=await scanPhotoUsers(adapter({valid:true,cors:[{origin:'https://localhost',allowed:false}]}),{execute:true,checkUrls:true});
assert.equal(denied.migrated,0);assert.equal(denied.rejected,1);assert.equal(writes,0);assert.equal(denied.decisions[0].status,'REJECTED_CORS');
const valid=await scanPhotoUsers(adapter({valid:true,cors:[{origin:'https://localhost',allowed:true},{origin:'capacitor://localhost',allowed:true}]}),{execute:false,checkUrls:true});
assert.equal(valid.wouldMigrate,1);assert.equal(valid.migrated,0);assert.equal(writes,0);
const absent=await scanPhotoUsers(adapter({valid:false,code:'HTTP_404'}),{execute:true,checkUrls:true});
assert.equal(absent.rejected,1);assert.equal(writes,0);
console.log(JSON.stringify({passed:3,failed:0,productionCalls:0,writes}));
