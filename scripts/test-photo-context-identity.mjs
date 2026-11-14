import assert from 'node:assert/strict';
import { resolveVehiclePhotoOperationSimulatorId as resolver } from '../src/lib/vehiclePhotoIdentity.ts';
import { resolveVehiclePhotoOperationSimulatorId as bundled } from '../functions/scripts/generated/photo-domain.mjs';
const cases = [
 [{id:'job',vehicleId:'truck',simulatorId:'gto'},{name:'COCAL TRANSPORTE'},'gto','gto'],
 [{id:'job',vehicleId:'truck'},{name:'COCAL TRANSPORTE',simulatorId:'gto'},'gto','gto'],
 [{id:'job',vehicleId:'truck'},{name:'COCAL TRANSPORTE'},'gto',''],
 [{id:'job',vehicleId:'truck'},{name:'COCAL TRANSPORTE'},'',''],
 [{id:'job',vehicleId:'truck',simulatorId:'gto'},{simulatorId:'ets2'},'gto',''],
 [{id:'job',vehicleId:'truck',simulatorId:'ets2'},{simulatorId:'ets2'},'gto',''],
 [{id:'job',vehicleId:'truck',simulatorId:'ets2'},{simulatorId:'ets2'},'all','ets2'],
];
cases.push(
 [{simulatorId:'gto'},{name:'COCAL TRANSPORTE'},'','gto'],
 [{},{name:'COCAL TRANSPORTE'},'',''],
);
for (const [job,company,selected,expectation] of cases) {
 assert.equal(resolver(job,company,selected),expectation);
 assert.equal(bundled(job,company,selected),expectation);
}
assert.equal(resolver({}, {name:'COCAL TRANSPORTE'}, '', [], [], [{name:'Scania 540',simulatorId:'gto'}]), 'gto');
assert.equal(bundled({}, {name:'COCAL TRANSPORTE'}, '', [], [], [{name:'Scania 540',simulatorId:'gto'}]), 'gto');
assert.equal(resolver({simulatorId:'ats'}, null, '', [], [], [{simulatorId:'gto'}]), '');
assert.equal(bundled({simulatorId:'ats'}, null, '', [], [], [{simulatorId:'gto'}]), '');
console.log(JSON.stringify({passed:cases.length+2,failed:0,productionCalls:0}));
