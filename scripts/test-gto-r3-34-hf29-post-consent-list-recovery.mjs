import fs from 'node:fs';
const servicePath='android/app/src/main/java/com/nvu/operacional/GtoObserverService.java';
const service=fs.readFileSync(servicePath,'utf8');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const gradle=fs.readFileSync('android/app/build.gradle','utf8');
const workflow=fs.readFileSync('.github/workflows/build-android-release.yml','utf8');
const checks=[];
function ck(name,ok){checks.push({name,ok:!!ok}); console.log(`${ok?'PASS':'FAIL'} ${name}`)}
ck('post-consent paused-frame probe survives grace timeout', service.includes('GtoProjectionContinuityPolicy') && service.includes('mayProbeWaitingFreightDuringForegroundLag'));
ck('strict freight pixels may restore foreground through verified bridge', /permissionReturnFromNvu[\s\S]{0,240}hasVerifiedGtoProjectionBridge\(\)/.test(service));
ck('grant clears stale MainActivity foreground latch', /projectionVerifiedGtoBridgeActive = true;[\s\S]{0,520}nvuMainActivityForeground = false;/.test(service));
ck('visual multi-row list is surfaced before OCR finishes', service.includes('"FREIGHT_LIST_VISUAL"') && service.includes('freightVisualCount'));
ck('visual list does not become semantic certification', service.includes('boolean semanticList = isFreightPageSemanticallyCertified') && service.includes('semanticList ? runtimeFreightCount : 0'));
ck('visual list cannot become freight-list lifecycle authority',
  /if \(semanticList\) \{[\s\S]{0,260}onFreightListVisibleAgain\(now\);/.test(service)
    && !service.includes('if (semanticList || strongVisualList) onFreightListVisibleAgain(now);')
    && !service.includes('boolean actionableList = semanticList || visualListConfirmed;'));

ck('selection still requires human-backed source', service.includes('GtoSelectionEvidencePolicy.isHumanBackedSource'));
ck('selection still requires semantic page/row evidence', service.includes('isFreightPageSemanticallyCertified(pageGeneration)') && service.includes('selectedRowSemanticallyCertifiesFreight(evidence)'));
ck('HF29+ workflow concurrency identity',   /group: nvu-r3-34-pc-hf(?:29|[3-9][0-9]|1[0-9]{2})-android-release/.test(workflow) && !workflow.includes('group: nvu-r3-34-pc-hf28-android-release'));

ck('HF29+ release identity', Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0) >= 81);
ck('HF29 test is in release gate', String(pkg.scripts?.['verify:release']||'').includes('test:gto-r3.34-hf29-post-consent-list-recovery'));
const failed=checks.filter(x=>!x.ok);
console.log(`\n${checks.length-failed.length}/${checks.length} HF29 post-consent/list recovery checks passed.`);
if(failed.length) process.exit(1);
