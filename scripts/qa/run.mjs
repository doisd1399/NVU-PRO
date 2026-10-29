import fs from 'node:fs';
import path from 'node:path';
import { config, root, sourceFingerprint, atomicJson, escapeHtml, run } from './common.mjs';
import { loadReleaseAuditBlockers } from './audit-policy.mjs';
const profile = process.argv[2] || 'web';
if (!Object.hasOwn(config.profiles, profile)) throw Error('Perfil inválido: quick, web ou release.');
// Validate before locking so a corrupt or missing policy cannot leave a stale lock.
const auditBlockers = loadReleaseAuditBlockers(config.auditBlockersFile);
const resultsRoot = path.join(root, 'qa/results'); fs.mkdirSync(resultsRoot, {recursive:true});
const lock = path.join(resultsRoot, 'running.lock');
try { fs.writeFileSync(lock, JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}), {flag:'wx'}); }
catch { console.error('QA_LOCKED: outra execução está ativa. Confira qa/results/running.lock.'); process.exit(2); }
const id = new Date().toISOString().replace(/[:.]/g,'-');
const dir = path.join(resultsRoot, id);fs.mkdirSync(dir);
const report = { schema:1, runId:id, profile, projectId:config.projectId, appVersion:JSON.parse(fs.readFileSync(path.join(root,'NVU_RELEASE_METADATA.json'))).androidVersion, startedAt:new Date().toISOString(), sourceFingerprint:sourceFingerprint(), status:'RUNNING', releaseApproved:false, steps:[], limitations:['Chromium e Firebase local não medem a latência de produção.','A interação completa com o jogo GTO e permissões do fabricante requer aparelho/jogo disponível.'] };
report.auditBlockers = auditBlockers;
const save = () => {
  atomicJson(path.join(dir,'report.json'), report); atomicJson(path.join(resultsRoot,'latest.json'), report);
  const rows = report.steps.map(s=>`<tr><td>${escapeHtml(s.label)}</td><td>${escapeHtml(s.kind)}</td><td class="${s.status}">${escapeHtml(s.status)}</td><td>${(s.durationMs/1000).toFixed(1)} s</td><td>${escapeHtml(s.summary || '')}</td></tr>`).join('');
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>NVU — Qualidade</title><style>body{font:15px system-ui;margin:30px auto;max-width:1120px;padding:0 20px;color:#142334;background:#f5f8fa}table{border-collapse:collapse;width:100%;background:white}td,th{padding:12px;text-align:left;border-bottom:1px solid #dbe5eb}.PASS{color:#087b52}.FAIL,.BLOCKED{color:#bc243e}small{color:#526372}</style><h1>NVU — Relatório de qualidade</h1><p>Versão ${escapeHtml(report.appVersion)} · perfil ${escapeHtml(profile)} · ${escapeHtml(report.status)}</p><p>Esta bateria distingue verificações Web/Firebase dos ensaios instrumentais no Android. Uma etapa indisponível não é tratada como aprovada.</p><p><strong>Liberação de APK: ${report.releaseApproved?'APROVADA':'NÃO APROVADA'}</strong></p><table><thead><tr><th>Verificação</th><th>Tipo</th><th>Resultado</th><th>Duração</th><th>Detalhes</th></tr></thead><tbody>${rows}</tbody></table><p>Android instrumental: ${report.steps.find(s=>s.id==='android-device')?.status || 'NÃO EXECUTADO NESTE PERFIL'}</p><small>${report.limitations.map(escapeHtml).join('<br>')}<br>Execução: ${escapeHtml(id)}<br>Fonte: ${escapeHtml(report.sourceFingerprint)}</small></html>`;
  const rendered = html.replace('<table>', `<p><strong>Achados graves abertos:</strong> ${auditBlockers.length ? auditBlockers.map(issue => escapeHtml(issue.id)).join(', ') : 'nenhum'}</p><table>`);
  fs.writeFileSync(path.join(dir,'report.html'),rendered);fs.writeFileSync(path.join(resultsRoot,'latest.html'),rendered);
};
let interrupted = false;
process.on('SIGINT',()=>{interrupted=true;}); process.on('SIGTERM',()=>{interrupted=true;});
try {
  save();
  for (const stepId of config.profiles[profile]) {
    if (interrupted) break;
    const step = config.steps[stepId], start = performance.now(), log = path.join(dir,stepId+'.log');
    console.log(`[QA] ${step.label}`);
    const r = await run(step.command || process.execPath, step.args, {log,timeoutMs:step.timeoutMs});
    const output = fs.readFileSync(log,'utf8');
    const status = r.code === 0 && !r.error && !r.timedOut ? 'PASS' : r.code === 2 || r.error === 'ENOENT' ? 'BLOCKED' : 'FAIL';
    report.steps.push({id:stepId,label:step.label,kind:step.kind,required:true,status,durationMs:Math.round(performance.now()-start),exitCode:r.code,timedOut:r.timedOut,log:stepId+'.log',summary:status==='PASS'?'Concluído':(r.error || (r.timedOut?'Tempo limite excedido':output.slice(-1800)))});
    console.log(`[${status}] ${stepId}`);save();
  }
  const unchanged = sourceFingerprint() === report.sourceFingerprint;
  report.finishedAt = new Date().toISOString(); report.sourceUnchanged = unchanged;
  report.status = !interrupted && unchanged && report.steps.length===config.profiles[profile].length && report.steps.every(s=>s.status==='PASS') ? 'PASS' : 'BLOCKED';
  if (profile === 'release' && auditBlockers.length) report.status = 'BLOCKED';
  report.releaseApproved = profile==='release' && report.status==='PASS' && auditBlockers.length===0;
  save(); console.log(`QA_${report.status}: ${path.relative(root,path.join(dir,'report.html'))}`);
  process.exitCode = report.status==='PASS'?0:1;
} catch(error) { report.status='BLOCKED';report.error=String(error);report.finishedAt=new Date().toISOString();save();process.exitCode=1; }
finally { fs.unlinkSync(lock); }
