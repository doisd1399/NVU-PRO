import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertFails, initializeTestEnvironment, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
const projectId = 'demo-nvu-v36-4-staging';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Firestore Emulator required');
const environment = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
try {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users', 'legacy-driver'), { role: 'driver', companyId: 'company-legacy' });
    await setDoc(doc(db, 'users', 'legacy-manager'), { role: 'admin', companyId: 'company-legacy' });
    await setDoc(doc(db, 'frotas', 'company-legacy'), { userId: 'legacy-manager', ownerId: 'legacy-manager', companyId: 'company-legacy' });
    await setDoc(doc(db, 'trabalhos', 'legacy-job'), { driverId: 'legacy-driver', companyId: 'company-legacy', contractId: 'legacy-contract', status: 'active', totalDeliveries: 1, progress: 1 });
    await setDoc(doc(db, 'historico_viagens', 'legacy-trip'), { driverId: 'legacy-driver', motoristaId: 'legacy-driver', criadoPor: 'legacy-driver', companyId: 'company-legacy', empresaId: 'company-legacy', contractId: 'legacy-contract', jobId: 'legacy-job', operationId: 'legacy-job', status: 'concluida', serverValidatedAt: new Date(), deleted: false });
  });
  const driver = environment.authenticatedContext('legacy-driver').firestore();
  const outsider = environment.authenticatedContext('outsider').firestore();
  const manager = environment.authenticatedContext('legacy-manager', { senior: true }).firestore();
  const tripRef = doc(driver, 'historico_viagens', 'legacy-trip');
  await assertFails(updateDoc(doc(outsider, 'historico_viagens', 'legacy-trip'), { deleted: true, status: 'DELETED', deletedAt: serverTimestamp(), deletedBy: 'outsider' }));
  await assertSucceeds(updateDoc(tripRef, { deleted: true, status: 'DELETED', deletedAt: serverTimestamp(), deletedBy: 'legacy-driver', updatedAt: serverTimestamp(), serverUpdatedAt: serverTimestamp(), syncVersion: 2 }));
  assert.equal((await getDoc(tripRef)).data()?.deleted, true);
  await assertSucceeds(setDoc(doc(manager, 'trip_deletion_audits', 'legacy-trip-audit'), { tripId: 'legacy-trip', driverId: 'legacy-driver', companyId: 'company-legacy', actorUserId: 'legacy-manager', createdAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(manager, 'notifications', 'legacy-trip-notification'), { userId: 'legacy-driver', companyId: 'company-legacy', actorUserId: 'legacy-manager', type: 'TRIP_DELETED', createdAt: serverTimestamp(), read: false }));
  console.log('PASS: isolated owner tombstone, unauthorized delete denial, manager audit and notification');
} finally { await environment.cleanup(); }
