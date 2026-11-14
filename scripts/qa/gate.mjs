import fs from 'node:fs';
import path from 'node:path';
import { root, config, sourceFingerprint } from './common.mjs';
import { loadReleaseAuditBlockers } from './audit-policy.mjs';
export function validateGate(report, currentFingerprint, now = Date.now(), auditBlockers = []) {
  if (auditBlockers.length) return 'QA_CRITICAL_AUDIT_OPEN';
  if (report?.schema!==1 || report.profile!=='release' || report.status!=='PASS' || report.releaseApproved!==true || report.sourceUnchanged!==true) return 'QA_RELEASE_NOT_APPROVED';
  if (report.sourceFingerprint!==currentFingerprint) return 'QA_SOURCE_CHANGED';
  const time=Date.parse(report.finishedAt);if(!Number.isFinite(time)||time>now||now-time>24*60*60*1000)return 'QA_REPORT_EXPIRED';
  const expected=config.profiles.release;
  if(!Array.isArray(report.steps)||report.steps.length!==expected.length||new Set(report.steps.map(s=>s.id)).size!==expected.length||expected.some(id=>!report.steps.some(s=>s.id===id&&s.required===true&&s.status==='PASS'&&s.exitCode===0&&!s.timedOut)))return 'QA_REQUIRED_STEP_MISSING';
  return null;
}
if (process.argv[1]===import.meta.filename) {
  let auditBlockers;
  try { auditBlockers = loadReleaseAuditBlockers(config.auditBlockersFile); }
  catch (error) { console.error(String(error)); process.exit(1); }
  if (auditBlockers.length) { console.error('QA_CRITICAL_AUDIT_OPEN: ' + auditBlockers.map(issue => issue.id).join(', ')); process.exit(1); }
  let report;try{report=JSON.parse(fs.readFileSync(path.join(root,'qa/results/latest.json'),'utf8'));}catch{console.error('QA_REPORT_MISSING: execute npm run qa:release.');process.exit(1);}
  const error=validateGate(report,sourceFingerprint(),Date.now(),auditBlockers);if(error){console.error(error+': execute npm run qa:release.');process.exit(1);}console.log('QA_RELEASE_GATE_PASS');
}
