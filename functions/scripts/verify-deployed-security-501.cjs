// Read-only verification. No Function invocation, document write or IAM mutation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),admin=require('../lib/firebaseAdmin');
const args=process.argv.slice(2),projectId=args[args.indexOf('--project')+1];
if(!args.includes('--project')||projectId!=='vtc-frota-log'||process.env.FIRESTORE_EMULATOR_HOST)throw new Error('Informe explicitamente --project vtc-frota-log, sem emulador.');
const root=path.resolve(__dirname,'../..'),plan=JSON.parse(fs.readFileSync(path.join(root,'reports/firebase-501-deploy-plan.json'),'utf8'));
const sha=value=>crypto.createHash('sha256').update(value.replace(/\r\n/g,'\n')).digest('hex');
const report={projectId,release:'1.0.501',readOnly:true,checkedAt:new Date().toISOString(),status:'UNVERIFIED',checks:{}};
(async()=>{
 const credential=admin.credential.applicationDefault(),token=await credential.getAccessToken();
 async function api(url,body){const response=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20_000)});if(!response.ok)throw new Error(`Consulta de verificação recusada (${response.status}): ${new URL(url).hostname}`);return response.json();}
 async function rules(service,file){const release=await api(`https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/${service}`);const set=await api(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);const files=set.source?.files||[],source=files.find(v=>path.basename(v.name)===file)||(files.length===1?files[0]:null);const expectedSha256=sha(fs.readFileSync(path.join(root,file),'utf8')),actualSha256=source?sha(source.content):null;return {matches:expectedSha256===actualSha256,expectedSha256,actualSha256,rulesetName:release.rulesetName};}
 const checks=await Promise.allSettled([
  rules('cloud.firestore','firestore.rules'),rules(`firebase.storage/${projectId}.firebasestorage.app`,'storage.rules'),
  api(`https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`),
  api(`https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:getIamPolicy`,{}),
  (async()=>{let functions=[],pageToken='';do{const page=await api(`https://cloudfunctions.googleapis.com/v1/projects/${projectId}/locations/us-central1/functions${pageToken?'?pageToken='+encodeURIComponent(pageToken):''}`);functions.push(...(page.functions||[]));pageToken=page.nextPageToken||'';}while(pageToken);return functions;})()
 ]);
 const result=(i,name)=>{const r=checks[i];if(r.status==='rejected'){report.checks[name]={verified:false,error:r.reason.message};return null;}return r.value;};
 for(const [i,name]of [[0,'firestoreRules'],[1,'storageRules']]){const value=result(i,name);if(value)report.checks[name]=value;}
 const project=result(2,'project'),policy=result(3,'storageIam'),functions=result(4,'functions');
 if(project&&policy){const serviceAgent=`service-${project.projectNumber}@gcp-sa-firebasestorage.iam.gserviceaccount.com`,role='roles/firebaserules.firestoreServiceAgent';report.checks.storageIam={serviceAgent,role,verified:(policy.bindings||[]).some(binding=>binding.role===role&&!binding.condition&&(binding.members||[]).includes(`serviceAccount:${serviceAgent}`))};}
 if(functions){const byName=new Map(functions.map(v=>[v.name.split('/').at(-1),v]));report.checks.functions=plan.functions.map(name=>{const item=byName.get(name);return {name,present:!!item,status:item?.status,runtime:item?.runtime,updateTime:item?.updateTime,versionId:item?.versionId,verified:item?.status==='ACTIVE'&&item?.runtime==='nodejs22'};});}
 report.status=report.checks.firestoreRules?.matches&&report.checks.storageRules?.matches&&report.checks.storageIam?.verified&&Array.isArray(report.checks.functions)&&report.checks.functions.every(v=>v.verified)?'PASS':'UNVERIFIED';
})().catch(error=>{report.error=error.message;}).finally(()=>{fs.mkdirSync(path.join(root,'reports'),{recursive:true});fs.writeFileSync(path.join(root,'reports/firebase-security-501-live.json'),JSON.stringify(report,null,2)+'\n');console.log(`FIREBASE_SECURITY_501_${report.status}`);if(report.status!=='PASS')process.exitCode=1;});
