const admin = require('../lib/firebaseAdmin');
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const projectId = args[args.indexOf('--project') + 1];
if (!args.includes('--project') || !['vtc-frota-log', 'demo-nvu-v36-4-staging'].includes(projectId))
  throw new Error('Informe --project vtc-frota-log ou o projeto demo local.');
if (projectId.startsWith('demo-') && !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Projeto demo exige emulador.');
if (projectId === 'vtc-frota-log' && process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Não misture projeto real e emulador.');
const apply = args.includes('--apply'); // Default is read-only.
admin.initializeApp({ projectId });
const db = admin.firestore();
const { publicCompanyData, refreshCompanyAccess, readCompanyAccess } = require('../lib/companyAccess');
const report = { projectId, apply, publicCompanies: 0, memberships: 0, owners: 0, preservedRevocations: 0, stampedLegacyApprovals: 0 };
async function eachPage(collection, visit) {
  let cursor;
  for (;;) {
    let query = db.collection(collection).orderBy(admin.firestore.FieldPath.documentId()).limit(200);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    for (const row of snapshot.docs) await visit(row);
    if (snapshot.size < 200) return;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
}
(async () => {
  const links = new Map();
  await eachPage('frotas', async row => {
    report.publicCompanies++;
    if (apply) await db.runTransaction(async tx => {
      const current = await tx.get(row.ref);
      tx.set(db.collection('public_companies').doc(row.id), current.exists ? publicCompanyData(current.data()) : {status:'deleted',deleted:true});
    });
    for (const uid of new Set([row.get('ownerId'), row.get('userId')].filter(v => typeof v === 'string' && v))) {
      links.set(`${row.id}/${uid}`, [uid, row.id]); report.owners++;
    }
  });
  await eachPage('companyMembers', async row => {
    const uid = row.get('userId'), companyId = row.get('companyId');
    if (typeof uid === 'string' && uid && typeof companyId === 'string' && companyId) {
      links.set(`${companyId}/${uid}`, [uid, companyId]); report.memberships++;
    }
  });
  for (const [uid, companyId] of links.values()) {
    const ref = db.collection('company_access').doc(companyId).collection('members').doc(uid);
    const existing = await ref.get();
    if (existing.get('revokedAt') || existing.get('status') === 'removed') report.preservedRevocations++;
    if (apply) await refreshCompanyAccess(db, uid, companyId);
  }
  // Only approvals backed by an active canonical relationship are trusted during migration.
  await eachPage('recruitment_applications', async row => {
    const data = row.data();
    if (data.type === 'company_registration' || data.status !== 'approved' || data.accessRevokedAt ||
      data.approvalAuthorityVersion === 1 || typeof data.userId !== 'string' || typeof data.companyId !== 'string') return;
    const eligible = await db.runTransaction(async tx => {
      const current = await tx.get(row.ref), latest = current.data() || {};
      if (latest.status !== 'approved' || latest.accessRevokedAt || latest.approvalAuthorityVersion === 1) return false;
      const access = await readCompanyAccess(db, tx, data.userId, data.companyId);
      if (!access.active) return false;
      if (apply) tx.update(row.ref, { approvalAuthorityVersion: 1, approvalMigratedAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    });
    if (eligible) report.stampedLegacyApprovals++;
  });
  const output = path.resolve('reports/membership-security-501-migration.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report)); // Counts only; never dump user/company documents.
  await admin.deleteApp(admin.app());
})().catch(async error => { console.error(error.message); process.exitCode = 1; await Promise.all(admin.apps.map(app => app.delete())); });
