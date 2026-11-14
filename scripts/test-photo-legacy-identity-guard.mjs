import assert from 'node:assert/strict';
import { collectPhotoCandidates } from '../functions/scripts/photo-audit-core.mjs';
const url='https://assets.test/vehicle.png';
const photo=(sim='')=>({vehiclePhotosV2:{v:{vehicleId:'v',vehicleName:'Scania 540',...(sim?{simulatorId:sim}:{}),url}}});
// A company name must not become a simulator namespace.
let rows=collectPhotoCandidates('driver',photo(),{vehicles:[{id:'v',companyId:'company',name:'Scania 540'}],companies:[{id:'company',name:'COCAL TRANSPORTE'}]});
assert.equal(rows[0].status,'REJECTED_AMBIGUOUS_SIMULATOR');
// Verified company simulator metadata may resolve a legitimate legacy image.
rows=collectPhotoCandidates('driver',photo(),{vehicles:[{id:'v',companyId:'company',name:'Scania 540'}],companies:[{id:'company',name:'COCAL TRANSPORTE',simulatorId:'gto'}]});
assert.equal(rows[0].simulatorId,'gto');assert.equal(rows[0].status,'CANDIDATE');
// Conflict between operation and company must not auto-publish in either namespace.
rows=collectPhotoCandidates('driver',photo(),{jobs:[{id:'job',driverId:'driver',vehicleId:'v',companyId:'company',simulatorId:'pbs'}],companies:[{id:'company',simulatorId:'gto'}]});
assert.equal(rows[0].status,'REJECTED_AMBIGUOUS_SIMULATOR');
// Explicit original identity wins without guesswork.
rows=collectPhotoCandidates('driver',photo('gto'));
assert.equal(rows[0].simulatorId,'gto');
console.log(JSON.stringify({passed:4,failed:0,productionCalls:0}));
