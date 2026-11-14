import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import Module from "node:module";
import path from "node:path";
const root = process.cwd(), require = createRequire(import.meta.url);
const job = { driverId: "driver", companyId: "company", contractId: "contract", totalDeliveries: 10,
  status: "active", progress: 0, operationReconciliationVersion: 4, operationProjectionSource: "new-operation-v4" };
globalThis.__operationReadQA = { job, calls: [], gates: [], hold: false };
const source = `
const qa=globalThis.__operationReadQA;
export const doc=(_db,c,id)=>({c,id});export const collection=(_db,c)=>({c});
export const where=(field,op,value)=>({field,op,value});export const query=(source,...filters)=>({...source,filters});
export async function getDocFromServer(ref){qa.calls.push({kind:'job',ref});if(qa.hold)await new Promise(r=>qa.gates.push(r));return {exists:()=>true,data:()=>({...qa.job})};}
export async function getDocsFromServer(query){qa.calls.push({kind:'history',query});if(qa.hold)await new Promise(r=>qa.gates.push(r));return {docs:[]};}
export const httpsCallable=()=>async()=>({data:{status:'unchanged'}});
export const auth={currentUser:{uid:'driver'}},db={},functions={};
`;
const bundle = await build({ entryPoints: ["src/application/trip/CanonicalTripOperationService.ts"], bundle: true,
  write: false, platform: "node", format: "cjs", plugins: [{ name: "read-test-adapters", setup(plugin) {
    plugin.onResolve({filter:/^firebase\/(firestore|functions)$/}, args=>({path:args.path,namespace:"read-test"}));
    plugin.onResolve({filter:/lib\/firebase$/}, ()=>({path:"firebase",namespace:"read-test"}));
    plugin.onLoad({filter:/.*/,namespace:"read-test"}, ()=>({contents:source,loader:"js"}));
  }}] });
const mod = new Module(path.join(root,"scripts/.operation-read-qa.cjs"));
mod.filename = path.join(root,"scripts/.operation-read-qa.cjs");mod.paths = Module._nodeModulePaths(root);mod._compile(bundle.outputFiles[0].text, mod.filename);
const { CanonicalTripOperationService } = mod.exports, qa=globalThis.__operationReadQA;
const service=new CanonicalTripOperationService();
qa.hold=true;const pending=service.readAuthoritativeOperationState("operation");
await Promise.resolve();
assert.equal(qa.calls.length,2,"job and canonical history start together, before either response");
qa.hold=false;qa.gates.splice(0).forEach(release=>release());const state=await pending;
assert.equal(state.progress,0);assert.equal(qa.calls.filter(call=>call.kind==='history').length,1);
console.log("PASS canonical v4 operation: two parallel reads, one history query");
qa.calls=[];qa.job={...job,operationReconciliationVersion:3,operationProjectionSource:"legacy"};
await service.readAuthoritativeOperationState("legacy-operation");
const history=qa.calls.filter(call=>call.kind==='history');
assert.equal(history.length,12);
assert.equal(new Set(history.map(call=>JSON.stringify(call.query.filters))).size,12);
console.log("PASS legacy aliases remain complete and deduplicated (12 combinations)");
qa.calls=[];qa.job=job;qa.hold=true;
const first=service.ensureOperationIntegrity("same"), second=service.ensureOperationIntegrity("same");
await Promise.resolve();assert.equal(qa.calls.length,2,"concurrent entry/resume audits share one request set");
qa.hold=false;qa.gates.splice(0).forEach(release=>release());await Promise.all([first,second]);
console.log("PASS concurrent operation audit deduplicates its reads");
console.log("OPERATION_READ_PERFORMANCE_PASS (3 checks)");
