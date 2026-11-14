// Explicitly invoked rollout step. Defaults to a read-only dry run; never run by QA.
const admin = require('../lib/firebaseAdmin');
const args = process.argv.slice(2), project = args.find(v => v.startsWith('--project='))?.slice(10);
if (!project) throw Error('Provide --project=<confirmed-project-id>');
if (process.env.FIRESTORE_EMULATOR_HOST && !project.startsWith('demo-')) throw Error('Emulator/project mismatch');
if (!admin.apps.length) admin.initializeApp({projectId:project});
const { refreshPublicUser } = require('../lib/userProfiles');
const apply = args.includes('--apply'), db = admin.firestore();
(async () => {
 let cursor, scanned = 0;
 do {
  let query = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(100);
  if(cursor) query = query.startAfter(cursor);
  const page = await query.get();
  for(const row of page.docs) { if(apply) await refreshPublicUser(db,row.id); scanned++; }
  cursor = page.size === 100 ? page.docs.at(-1) : null;
 } while(cursor);
 console.log(JSON.stringify({project,mode:apply?'apply':'dry-run',scanned}));
 await db.terminate();
})().catch(e => { console.error(e.message); process.exitCode=1; });
