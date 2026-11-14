import fs from 'node:fs';
import path from 'node:path';
import { root } from './common.mjs';

export function loadReleaseAuditBlockers(configuredFile, baseDirectory = root) {
  if (configuredFile === undefined) return [];
  const invalid = reason => { throw Error('QA_AUDIT_POLICY_INVALID: ' + reason); };
  if (typeof configuredFile !== 'string' || !configuredFile.trim()) invalid('arquivo não configurado');
  let policy;
  try { policy = JSON.parse(fs.readFileSync(path.resolve(baseDirectory, configuredFile), 'utf8')); }
  catch { invalid('arquivo ausente ou JSON inválido'); }
  if (policy?.schema !== 1 || !Array.isArray(policy.issues)) invalid('schema ou lista de achados inválidos');
  const seen = new Set();
  for (const issue of policy.issues) {
    if (!issue || typeof issue.id !== 'string' || !/^[A-Z]+-\d{2,}$/.test(issue.id) || seen.has(issue.id)) invalid('identificador ausente, inválido ou duplicado');
    seen.add(issue.id);
    if (!['P0', 'P1', 'P2', 'P3'].includes(issue.severity) || !['open', 'resolved'].includes(issue.status)) invalid('gravidade ou estado inválido: ' + issue.id);
    if (typeof issue.title !== 'string' || !issue.title.trim()) invalid('título ausente: ' + issue.id);
    if (issue.status === 'resolved' && (!Array.isArray(issue.evidence) || !issue.evidence.length || issue.evidence.some(e => typeof e !== 'string' || !e.trim()))) invalid('resolução sem evidência: ' + issue.id);
  }
  return policy.issues.filter(issue => issue.status === 'open' && ['P0', 'P1'].includes(issue.severity));
}
