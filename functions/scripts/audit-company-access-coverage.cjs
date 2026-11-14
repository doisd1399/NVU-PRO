// READ-ONLY. Before the operational records are closed to non-members, every active member and owner must have an active
// server-owned company_access row (the rules read it). Lists the ones that do not. Never writes.
// Repair, if any are listed:  node functions/scripts/migrate-membership-security-501.cjs --project <id> --apply
const admin = require('../lib/firebaseAdmin');
const args = process.argv.slice(2);
const projectId = args[args.indexOf('--project') + 1];
if (!args.includes('--project') || !['vtc-frota-log', 'demo-nvu-v36-4-staging'].includes(projectId))
  throw new Error('Informe --project vtc-frota-log ou o projeto demo local.');
if (projectId.startsWith('demo-') && !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Projeto demo exige emulador.');
if (projectId === 'vtc-frota-log' && process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Não misture projeto real e emulador.');
admin.initializeApp({ projectId });
const db = admin.firestore();
async function eachPage(collection, visit) {
  let cursor;
  for (;;) {
    let query = db.collection(collection).orderBy(admin.firestore.FieldPath.documentId()).limit(300);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    for (const row of snapshot.docs) await visit(row);
    if (snapshot.size < 300) return;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
}
(async () => {
  const links = new Map(); // "company/uid" -> how it was found
  await eachPage('frotas', async row => {
    if (row.get('deleted') === true || row.get('isDeleted') === true) return;
    for (const uid of new Set([row.get('ownerId'), row.get('userId')].filter(v => typeof v === 'string' && v))) links.set(`${row.id}/${uid}`, 'owner');
  });
  await eachPage('companyMembers', async row => {
    const uid = row.get('userId'), companyId = row.get('companyId');
    if (typeof uid === 'string' && uid && typeof companyId === 'string' && companyId && (row.get('status') == null || row.get('status') === 'active')) links.set(`${companyId}/${uid}`, links.get(`${companyId}/${uid}`) || 'member');
  });
  const missing = [], revoked = [];
  for (const [key, kind] of links) {
    const [companyId, uid] = key.split('/');
    const access = await db.collection('company_access').doc(companyId).collection('members').doc(uid).get();
    if (access.exists && (access.get('status') === 'removed' || access.get('revokedAt'))) revoked.push({ companyId, uid, kind });
    else if (!access.exists || access.get('status') !== 'active') missing.push({ companyId, uid, kind, status: access.get('status') || null });
  }
  console.log(JSON.stringify({ projectId, links: links.size, withoutActiveAccess: missing.length, revokedButStillListed: revoked.length,
    examples: missing.slice(0, 50), revokedExamples: revoked.slice(0, 20) }, null, 2));
  console.log(missing.length === 0 ? 'COVERAGE_OK: nenhuma lacuna; as regras podem ser publicadas.' : 'COVERAGE_GAPS: repare com a migração 501 antes de publicar as regras.');
  process.exitCode = missing.length ? 2 : 0;
})().catch(error => { console.error(error); process.exit(1); });
